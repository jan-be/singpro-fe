// Drives the benchmark page in real Chrome (headed, so the real GPU is used)
// and reads main-thread CPU time through CDP Performance metrics.
// node bench/ort-webgpu/run.mjs (needs bench/ort-webgpu/serve.mjs running)
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || 'http://localhost:3005';
const RUNS = Number(process.env.RUNS || 600);
const RT_SECONDS = Number(process.env.RT_SECONDS || 6);
const HEADLESS = process.env.HEADLESS === '1';
const SEV = process.env.SEV ?? '2';
const LOG = process.env.LOG ?? 'warning';

const browser = await chromium.launch({
  channel: 'chrome',
  headless: HEADLESS,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
});

const results = { runs: RUNS, headless: HEADLESS, chrome: browser.version(), logs: {} };

async function withPage(build, steps) {
  const page = await browser.newPage();
  const logs = [];
  page.on('console', m => logs.push(m.text()));
  page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
  await page.goto(`${BASE}/?build=${build}&sev=${SEV}&log=${LOG}`);
  await page.waitForFunction(() => window.__ready, null, { timeout: 120000 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const api = {
    hasGpu: () => page.evaluate(() => window.__api.hasGpu),
    gpu: () => page.evaluate(() => window.__api.gpu()),
    create: ep => page.evaluate(ep => window.__api.create(ep), ep),
    run: async (ep, runs) => {
      const m0 = await metrics();
      const r = await page.evaluate(([ep, runs]) => window.__api.run(ep, runs), [ep, runs]);
      const m1 = await metrics();
      r.cpuTaskMsPerRun = (m1.TaskDuration - m0.TaskDuration) * 1000 / runs;
      r.cpuScriptMsPerRun = (m1.ScriptDuration - m0.ScriptDuration) * 1000 / runs;
      return r;
    },
    realtime: (ep, seconds) => page.evaluate(([ep, s]) => window.__api.realtime(ep, s), [ep, seconds]),
    release: ep => page.evaluate(ep => window.__api.release(ep), ep),
    worker: (ep, runs) => page.evaluate(([ep, runs]) => window.__api.worker(ep, runs), [ep, runs]),
  };
  try {
    await steps(api);
  } catch (e) {
    console.error(`[${build}] failed:`, e.message);
    results[build + '_error'] = e.message;
  }
  results.logs[build] = logs.filter(l => !/^\s*$/.test(l)).slice(0, 80);
  await page.close();
}

const fmt = (r) => r ? `${r.median.toFixed(2)} med / ${r.mean.toFixed(2)} mean / ${r.p90.toFixed(2)} p90 / ${r.p99.toFixed(2)} p99 / ${r.max.toFixed(1)} max` : 'n/a';

// 1. plain wasm build (what production ships today)
await withPage('plain', async (api) => {
  const c = await api.create('wasm');
  const r = await api.run('wasm', RUNS);
  const rt = await api.realtime('wasm', RT_SECONDS);
  await api.release('wasm');
  const w = await api.worker('wasm', RUNS);
  results.wasmPlain = { create: c, loop: r, realtime: rt, worker: w };
  console.log(`wasm (plain build)   create ${c.createMs.toFixed(0)} ms, warmup ${c.warmupMs.toFixed(1)} ms`);
  console.log(`  main thread  ms/run: ${fmt(r)} | CPU task ${r.cpuTaskMsPerRun.toFixed(2)} ms/run`);
  console.log(`  realtime 67/s: ${rt.completed} done, ${rt.dropped} dropped of ${rt.ticks} | ${fmt(rt)}`);
  console.log(`  worker       ms/run: ${w.error ? 'ERROR ' + w.error : fmt(w)}`);
});

// 2. webgpu build: its wasm EP, then the webgpu EP
await withPage('webgpu', async (api) => {
  results.hasGpu = await api.hasGpu();
  results.gpu = await api.gpu();
  console.log('navigator.gpu:', results.hasGpu, JSON.stringify(results.gpu));

  const cw = await api.create('wasm');
  const rw = await api.run('wasm', RUNS);
  await api.release('wasm');
  results.wasmJsep = { create: cw, loop: rw };
  console.log(`wasm (webgpu build)  create ${cw.createMs.toFixed(0)} ms, warmup ${cw.warmupMs.toFixed(1)} ms`);
  console.log(`  main thread  ms/run: ${fmt(rw)} | CPU task ${rw.cpuTaskMsPerRun.toFixed(2)} ms/run`);

  const cg = await api.create('webgpu');
  const rg = await api.run('webgpu', RUNS);
  const rtg = await api.realtime('webgpu', RT_SECONDS);
  await api.release('webgpu');
  const wg = await api.worker('webgpu', RUNS);
  results.webgpu = { create: cg, loop: rg, realtime: rtg, worker: wg };
  console.log(`webgpu               create ${cg.createMs.toFixed(0)} ms, warmup ${cg.warmupMs.toFixed(1)} ms`);
  console.log(`  main thread  ms/run: ${fmt(rg)} | CPU task ${rg.cpuTaskMsPerRun.toFixed(2)} ms/run`);
  console.log(`  realtime 67/s: ${rtg.completed} done, ${rtg.dropped} dropped of ${rtg.ticks} | ${fmt(rtg)}`);
  console.log(`  worker       ms/run: ${wg.error ? 'ERROR ' + wg.error : fmt(wg)} (navigator.gpu in worker: ${wg.hasGpu})`);

  // numerical agreement between the two providers on the same inputs
  let maxPitchDiff = 0, maxConfDiff = 0, frames = 0;
  for (let i = 0; i < Math.min(rw.sample.length, rg.sample.length); i++) {
    for (let k = 0; k < rw.sample[i].pitch.length; k++) {
      frames++;
      maxPitchDiff = Math.max(maxPitchDiff, Math.abs(rw.sample[i].pitch[k] - rg.sample[i].pitch[k]));
      maxConfDiff = Math.max(maxConfDiff, Math.abs(rw.sample[i].conf[k] - rg.sample[i].conf[k]));
    }
  }
  results.agreement = { frames, maxPitchDiff, maxConfDiff };
  console.log(`agreement over ${frames} frames: max |Δpitch| ${maxPitchDiff.toFixed(3)} Hz, max |Δconf| ${maxConfDiff.toFixed(4)}`);
});

for (const [build, logs] of Object.entries(results.logs)) {
  const interesting = logs.filter(l => /placed|assigned|fallback|not supported|unsupported|CPU|WebGPU|webgpu|error|Error|warn/i.test(l));
  if (interesting.length) { console.log(`--- console (${build}) ---`); for (const l of interesting.slice(0, 40)) console.log(l.slice(0, 400)); }
}

fs.writeFileSync(path.join(here, 'results.json'), JSON.stringify(results, null, 2));
await browser.close();
