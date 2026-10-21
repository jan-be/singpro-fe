// Drives the benchmark page in real Chrome (headed, so the real GPU is used)
// and reads main-thread CPU time through CDP Performance metrics.
// node bench/ort-webgpu/run.ts   (needs bench/ort-webgpu/serve.ts running)
// env: RUNS (default 400), RT_SECONDS (6), MODEL_GPU (/model-gpu.onnx), OUT (results.json)
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BenchOptions, BenchSession, LoopResult, RealtimeResult, Summary } from './bench';

/** A loop on the page, with the main thread's CPU time per run */
type LoopRun = LoopResult & { cpuTaskMsPerRun: number };

/** The options sent into the page (sessionOptions stay out: what they can hold, a Blob, does not cross page.evaluate) */
type PageOptions = Omit<BenchOptions, 'sessionOptions'>;

/** One measured setup (api.variant), or the error it ended in */
interface Variant {
  build: string;
  ep: string;
  opts: PageOptions;
  slots?: number;
  create?: Pick<BenchSession, 'createMs' | 'warmupMs' | 'first'>;
  loop?: LoopRun;
  realtime?: RealtimeResult;
  worker?: BenchWorkerResult;
  error?: string;
}

/** The page's __api, driven from here */
interface Driver {
  gpu(): ReturnType<Window['__api']['gpu']>;
  create(name: string, ep: string, opts: PageOptions, slots?: number): ReturnType<Window['__api']['create']>;
  run(name: string, runs: number): Promise<LoopRun>;
  realtime(name: string, seconds: number): Promise<RealtimeResult>;
  release(name: string): Promise<void>;
  readbackFloor(runs: number): Promise<Summary>;
  worker(ep: string, opts: PageOptions, runs: number): Promise<BenchWorkerResult>;
  variant(label: string, ep: string, opts: PageOptions, how?: { realtime?: boolean; slots?: number; worker?: boolean }): Promise<Variant | null>;
}

/** How far two setups' outputs are apart (agree) */
type Agreement = { frames: number; maxPitchDiff: number; maxConfDiff: number } | null;

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || 'http://localhost:3005';
const RUNS = Number(process.env.RUNS || 400);
const RT_SECONDS = Number(process.env.RT_SECONDS || 6);
const OUT = process.env.OUT || path.join(here, 'results.json');
const MODEL_GPU = process.env.MODEL_GPU || '/model-gpu.onnx';

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const results: {
  runs: number; chrome: string; variants: Record<string, Variant>; logs: Record<string, string[]>;
  readbackFloor?: Summary; agreement?: Record<string, Agreement>;
} = { runs: RUNS, chrome: browser.version(), variants: {}, logs: {} };
const fmt = (r: Summary | undefined) => r ? `${r.median.toFixed(2)} med / ${r.p90.toFixed(2)} p90 / ${r.p99.toFixed(2)} p99` : 'n/a';
/** A thrown error's message (Playwright's are Errors) */
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const rt = (r: RealtimeResult) => `${r.completed} done, ${r.dropped} dropped of ${r.ticks} (${r.slots} session${r.slots > 1 ? 's' : ''}) | ${fmt(r)}`;

async function withPage(build: string, steps: (api: Driver) => Promise<void>) {
  const page = await browser.newPage();
  const logs: string[] = [];
  page.on('console', m => logs.push(m.text()));
  page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
  await page.goto(`${BASE}/?build=${build}&sev=2&log=warning`);
  try {
    await page.waitForFunction(() => window.__ready, null, { timeout: 120000 });
  } catch (e) {
    console.log(`[${build}] page did not become ready: ${messageOf(e).split('\n')[0]}`);
    results.logs[build] = logs.slice(0, 20);
    await page.close();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const api: Driver = {
    gpu: () => page.evaluate(() => window.__api.gpu()),
    create: (name, ep, opts, slots = 1) => page.evaluate(([n, e, o, s]) => window.__api.create(n, e, o, s), [name, ep, opts, slots] as const),
    run: async (name, runs) => {
      const m0 = await metrics();
      const r = await page.evaluate(([n, k]) => window.__api.run(n, k), [name, runs] as const);
      const m1 = await metrics();
      return { ...r, cpuTaskMsPerRun: (m1.TaskDuration - m0.TaskDuration) * 1000 / runs };
    },
    realtime: (name, seconds) => page.evaluate(([n, s]) => window.__api.realtime(n, s), [name, seconds] as const),
    release: (name) => page.evaluate(n => window.__api.release(n), name),
    readbackFloor: (runs) => page.evaluate(k => window.__api.readbackFloor(k), runs),
    worker: (ep, opts, runs) => page.evaluate(([e, o, k]) => window.__api.worker(e, o, k), [ep, opts, runs] as const),
    variant: async (label, ep, opts, { realtime = false, slots = 1, worker = false } = {}) => {
      try {
        const c = await api.create(label, ep, opts, slots);
        const r = await api.run(label, RUNS);
        const v: Variant = { build, ep, opts, slots, create: c, loop: r };
        let line = `${label.padEnd(40)} total ${fmt(r)} | run() ${fmt(r.run)} | readback ${fmt(r.read)} | CPU ${r.cpuTaskMsPerRun.toFixed(2)} ms/run | create ${c.createMs.toFixed(0)} ms, warmup ${c.warmupMs.toFixed(0)} ms`;
        if (realtime) { v.realtime = await api.realtime(label, RT_SECONDS); line += `\n${''.padEnd(40)} real-time 67/s: ${rt(v.realtime)}`; }
        await api.release(label);
        if (worker) {
          const w = await api.worker(ep, opts, RUNS);
          v.worker = w;
          line += `\n${''.padEnd(40)} in a worker: ${w.error === undefined ? fmt(w) : 'ERROR ' + w.error}`;
        }
        results.variants[label] = v;
        console.log(line);
        return v;
      } catch (e) {
        console.log(`${label.padEnd(40)} FAILED: ${messageOf(e).split('\n')[0].slice(0, 300)}`);
        results.variants[label] = { build, ep, opts, error: messageOf(e) };
        await api.release(label).catch(() => {});
        return null;
      }
    },
  };
  try { await steps(api); } catch (e) { console.error(`[${build}] failed:`, messageOf(e)); }
  results.logs[build] = [...new Set(logs.filter(l => /error|Error|fail|not supported|fallback/i.test(l)))].slice(0, 20);
  await page.close();
}

const agree = (a: Variant | null, b: Variant | null): Agreement => {
  if (!a?.loop?.sample || !b?.loop?.sample) return null;
  let dp = 0, dc = 0, n = 0;
  for (let i = 0; i < Math.min(a.loop.sample.length, b.loop.sample.length); i++)
    for (let k = 0; k < a.loop.sample[i].pitch.length; k++) {
      n++;
      dp = Math.max(dp, Math.abs(a.loop.sample[i].pitch[k] - b.loop.sample[i].pitch[k]));
      dc = Math.max(dc, Math.abs(a.loop.sample[i].conf[k] - b.loop.sample[i].conf[k]));
    }
  return { frames: n, maxPitchDiff: dp, maxConfDiff: dc };
};

// (null: the page did not come up)
let ref: Variant | null = null, wasmGpuModel: Variant | null = null, jsepRaw: Variant | null = null, nativeRaw: Variant | null = null;
await withPage('plain', async (api) => {
  ref = await api.variant('wasm | original model', 'wasm', { model: '/model.onnx' }, { realtime: true, worker: true });
  wasmGpuModel = await api.variant('wasm | gpu model', 'wasm', { model: MODEL_GPU });
});
await withPage('webgpu', async (api) => {
  console.log('gpu:', JSON.stringify(await api.gpu()));
  await api.create('floor', 'webgpu', { model: MODEL_GPU, gpuIO: true });
  results.readbackFloor = await api.readbackFloor(300);
  await api.release('floor');
  console.log(`${'readback floor (24 bytes, no inference)'.padEnd(40)} total ${fmt(results.readbackFloor)}`);
  await api.variant('webgpu(jsep) | original model', 'webgpu', { model: '/model.onnx' });
  await api.variant('webgpu(jsep) | gpu model', 'webgpu', { model: MODEL_GPU });
  jsepRaw = await api.variant('webgpu(jsep) | gpu model, gpu IO', 'webgpu', { model: MODEL_GPU, gpuIO: 'raw' }, { realtime: true, worker: true });
});
await withPage('jspi', async (api) => {
  nativeRaw = await api.variant('webgpu(native) | gpu model, gpu IO', 'webgpu', { model: MODEL_GPU, gpuIO: 'raw' }, { realtime: true, worker: true });
  await api.variant('webgpu(native) | gpu IO, 2 sessions', 'webgpu', { model: MODEL_GPU, gpuIO: 'raw' }, { realtime: true, slots: 2 });
});
results.agreement = { wasm_gpuModel: agree(ref, wasmGpuModel), jsep: agree(ref, jsepRaw), native: agree(ref, nativeRaw) };
console.log('agreement with wasm/original:', JSON.stringify(results.agreement));
for (const [build, logs] of Object.entries(results.logs)) if (logs.length) { console.log(`--- console (${build}) ---`); for (const l of logs) console.log(l.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 300)); }
fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
await browser.close();
