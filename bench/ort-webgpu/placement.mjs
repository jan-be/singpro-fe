// Which nodes the WebGPU provider keeps on the CPU (verbose ORT log).
// node bench/ort-webgpu/placement.mjs [build=webgpu|jspi] [model=/model.onnx]   (Git Bash: MSYS_NO_PATHCONV=1)
import { chromium } from '@playwright/test';
const build = process.argv[2] || 'webgpu';
const model = process.argv[3] || '/model.onnx';
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
await page.goto(`http://localhost:3005/?build=${build}&sev=0&log=verbose`);
await page.waitForFunction(() => window.__ready, null, { timeout: 120000 });
try {
  await page.evaluate((m) => window.__api.create('p', 'webgpu', { model: m }), model);
  await page.evaluate(() => window.__api.release('p'));
} catch (e) { console.log('ERROR', e.message.split('\n')[0]); }
const lines = logs.join('\n').split('\n').filter(l => /VerifyEachNodeIsAssignedToAnEp/.test(l)).map(l => l.replace(/\x1b\[[0-9;]*m/g, '').replace(/^.*VerifyEachNodeIsAssignedToAnEp\]\s?/, ''));
console.log(`${build} ${model}:`);
console.log(lines.length ? lines.join('\n') : '(no placement warnings: every node on the preferred provider)');
await browser.close();
