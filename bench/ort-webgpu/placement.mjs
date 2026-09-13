// Which nodes of swift-f0 the WebGPU provider keeps on the CPU (verbose ORT log).
// node bench/ort-webgpu/placement.mjs (needs bench/ort-webgpu/serve.mjs running)
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
const logs = [];
page.on('console', m => logs.push(m.text()));
await page.goto('http://localhost:3005/?build=webgpu&sev=0&log=verbose');
await page.waitForFunction(() => window.__ready, null, { timeout: 120000 });
await page.evaluate(() => window.__api.create('webgpu'));
await page.evaluate(() => window.__api.release('webgpu'));
const lines = logs.join('\n').split('\n').filter(l => /VerifyEachNodeIsAssignedToAnEp/.test(l)).map(l => l.replace(/\x1b\[[0-9;]*m/g, '').replace(/^.*VerifyEachNodeIsAssignedToAnEp\]\s?/, ''));
console.log(lines.join('\n'));
await browser.close();
