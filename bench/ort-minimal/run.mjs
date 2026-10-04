// Runs the comparison page in Chrome, Firefox and WebKit (Playwright) and
// prints, per browser and runtime: worker init time (new Worker() until the
// session is ready, downloads included), the first inference, the mean,
// median and p90 inference over the windows, and how far each runtime's raw
// outputs are from the stock runtime's in the same browser (and from the
// first browser's, for the same runtime).
//   bun bench/ort-minimal/serve.mjs &   then   bun bench/ort-minimal/run.mjs
// env: BASE (http://localhost:3006), BROWSERS (chrome,firefox,webkit),
//      WINDOWS (all of the audio), ROUNDS (2), OUT (results.json),
//      PLAYWRIGHT_BROWSERS_PATH for Playwright's Firefox/WebKit builds
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from '@playwright/test';
import { pickPitch } from '../../src/logic/pitchModel.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || 'http://localhost:3006';
const BROWSERS = (process.env.BROWSERS || 'chrome,firefox,webkit').split(',');
const WINDOWS = process.env.WINDOWS ? Number(process.env.WINDOWS) : undefined;
const ROUNDS = Number(process.env.ROUNDS || 2);
const OUT = process.env.OUT || path.join(here, 'results.json');
const launchers = {
  chrome: () => chromium.launch({ channel: 'chrome' }),
  firefox: () => firefox.launch(),
  webkit: () => webkit.launch(),
};

const f32 = (b64) => { const b = Buffer.from(b64, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
function diff(a, b, frames) {
  const out = {};
  for (const k of ['pitch', 'conf']) {
    const x = a[k], y = b[k];
    let max = 0, sum = 0, same = 0;
    for (let i = 0; i < x.length; i++) {
      const d = Math.abs(x[i] - y[i]);
      if (d > max) max = d;
      sum += d;
      if (Object.is(x[i], y[i])) same++;
    }
    out[k] = { maxAbs: max, meanAbs: sum / x.length, identical: `${same}/${x.length}` };
  }
  // the app's own decision on each window (last frame, confidence and range)
  let picks = 0;
  for (let w = 0; w < a.pitch.length / frames; w++) {
    const s = w * frames, e = s + frames;
    if (pickPitch(a.pitch.subarray(s, e), a.conf.subarray(s, e)) !== pickPitch(b.pitch.subarray(s, e), b.conf.subarray(s, e))) picks++;
  }
  out.pickedPitchDiffers = picks;
  return out;
}

const results = { base: BASE, rounds: ROUNDS, browsers: {} };
const outputs = {}; // runtime -> first browser's outputs
for (const name of BROWSERS) {
  let browser;
  try { browser = await launchers[name](); } catch (e) { console.log(`${name}: cannot launch (${e.message.split('\n')[0]})`); continue; }
  const page = await browser.newPage();
  const logs = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.text().slice(0, 300)); });
  page.on('pageerror', e => logs.push('PAGEERROR ' + e.message.slice(0, 300)));
  await page.goto(BASE);
  await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  const info = await page.evaluate(() => window.__info);
  const runtimes = ['stock', ...info.variants];
  const r = results.browsers[name] = { version: browser.version(), runs: {}, diffs: {}, logs };
  console.log(`\n${name} ${browser.version()} — ${WINDOWS ?? info.maxWindows} windows × ${ROUNDS} rounds`);
  const out = {};
  for (let round = 0; round < ROUNDS; round++) {
    // alternate the order so neither runtime always runs on a cooler/warmer machine
    for (const rt of round % 2 ? [...runtimes].reverse() : runtimes) {
      const res = await page.evaluate((a) => window.__run(a), { rt, n: WINDOWS });
      if (res.error) { console.log(`  ${rt.padEnd(10)} ERROR ${res.error}`); (r.runs[rt] ??= []).push({ error: res.error }); continue; }
      const { pitch, conf, ...t } = res;
      (r.runs[rt] ??= []).push(t);
      out[rt] ??= { pitch: f32(pitch), conf: f32(conf), frames: res.frames };
      console.log(`  ${rt.padEnd(10)} init ${t.initMs.toFixed(0).padStart(5)} ms (import ${t.importMs.toFixed(0)}, session ${t.sessionMs.toFixed(0)})`
        + ` | first run ${t.firstRunMs.toFixed(1)} ms | mean ${t.meanMs.toFixed(3)} median ${t.medianMs.toFixed(2)} p90 ${t.p90Ms.toFixed(2)} ms`);
    }
  }
  for (const rt of info.variants) {
    if (!out.stock || !out[rt]) continue;
    r.diffs[`${rt} vs stock`] = diff(out[rt], out.stock, out[rt].frames);
    console.log(`  ${rt} vs stock: ${JSON.stringify(r.diffs[`${rt} vs stock`])}`);
  }
  for (const rt of runtimes) {
    if (!out[rt]) continue;
    if (!outputs[rt]) { outputs[rt] = { browser: name, ...out[rt] }; continue; }
    r.diffs[`${rt} vs ${outputs[rt].browser}`] = diff(out[rt], outputs[rt], out[rt].frames);
    console.log(`  ${rt} vs ${rt} in ${outputs[rt].browser}: ${JSON.stringify(r.diffs[`${rt} vs ${outputs[rt].browser}`])}`);
  }
  if (logs.length) console.log('  console:', [...new Set(logs)].slice(0, 5).join(' | '));
  await browser.close();
}
fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
