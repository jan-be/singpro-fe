import { test, expect, chromium } from '@playwright/test';
import { chromeLaunchArgs } from './fixtures.js';
import { startBotSinger } from './wsSinger.js';

/**
 * Stress test: many simultaneous singers in one party.
 *
 *   REAL_SINGERS    real Chrome contexts, each running the full pipeline
 *                   (fake mic → AudioWorklet → ONNX pitch worker → WebSocket).
 *                   The first one hosts. Default 12.
 *   BOT_SINGERS     extra synthetic singers speaking the WebSocket protocol
 *                   from Node (see wsSinger.js). Cheap, so they push the real
 *                   browsers' note rendering far beyond what one machine can
 *                   run in Chrome. Default 0.
 *   STRESS_SECONDS  how long everyone sings once all have joined. Default 30.
 *   MIN_FPS         host frame-rate threshold for the assertion. Default 20.
 *
 * Every real browser gets an in-page monitor (frame rate, long tasks, JS heap,
 * WebSocket traffic incl. which singers' notes arrived). The test prints a
 * per-client table and asserts the party stayed healthy: no disconnects or
 * server errors, everyone on the scoreboard, every singer's notes reached the
 * host, host frame rate above MIN_FPS, server latency sane.
 *
 * Requires: backend on :3000 (Vite proxies /api). Examples:
 *   npm run test:stress
 *   REAL_SINGERS=4 BOT_SINGERS=40 STRESS_SECONDS=60 npm run test:stress
 */
const REAL_SINGERS = Math.max(1, Number(process.env.REAL_SINGERS ?? process.env.SINGERS ?? 12));
const BOT_SINGERS = Math.max(0, Number(process.env.BOT_SINGERS ?? 0));
const STRESS_SECONDS = Number(process.env.STRESS_SECONDS ?? 30);
const MIN_FPS = Number(process.env.MIN_FPS ?? 20);
// Chrome DevTools-style CPU slowdown applied to every real browser (1 = none).
// 4 ≈ a mid-range phone, 6 ≈ a low-end / several-years-old one.
const CPU_THROTTLE = Number(process.env.CPU_THROTTLE ?? 1);
const BASE = 'http://localhost:3001';

// Injected before any app code: wraps WebSocket and samples frames / long tasks / heap.
const MONITOR_SCRIPT = `(() => {
  const S = window.__stress = {
    sockets: 0, open: 0, closes: 0, errors: [], sent: {}, sentNotes: 0,
    received: {}, receivedBatches: 0, receivedNotes: 0, receivedFrom: {},
    scoreboard: {}, lanes: null, laneNames: {}, lastLatencies: null, lastPingAck: null, lastVideoTime: null, hostPlaying: false,
    frames: 0, slowFrames: 0, longTasks: 0, longTaskMs: 0, startedAt: performance.now(), heapStart: null, heapNow: null,
  };
  const Native = window.WebSocket;
  const Wrapped = function (url, protocols) {
    const ws = protocols === undefined ? new Native(url) : new Native(url, protocols);
    // Only the party socket counts (Vite's HMR socket also goes through here).
    // React StrictMode opens+closes it once extra in dev, so we track what is
    // open now and closes since the measurement window started.
    const isParty = String(url).includes('/api/ws');
    if (isParty) { S.sockets++; S.open++; }
    const send = ws.send.bind(ws);
    ws.send = (d) => {
      if (typeof d === 'string') {
        try {
          const m = JSON.parse(d);
          S.sent[m.type] = (S.sent[m.type] || 0) + 1;
          if (m.type === 'video:time') { S.lastVideoTime = m.data.videoTime; S.hostPlaying = !!m.data.isPlaying; }
        } catch {}
      } else {
        S.sentNotes++;
      }
      return send(d);
    };
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data === 'string') {
        try {
          const m = JSON.parse(ev.data);
          S.received[m.type] = (S.received[m.type] || 0) + 1;
          if (m.type === 'party:lanes') { // past 8 singers the server picks who is on screen
            S.lanes = m.data;
            for (const u of [...(m.data.pinned || []), ...(m.data.spotlight || [])]) S.laneNames[u] = 1;
          }
          if (m.type === 'party:scores_updated') { // the whole board, or one singer appearing / leaving
            if (!m.data.partial) S.scoreboard = {};
            for (const u of m.data.removed || []) delete S.scoreboard[u];
            for (const p of m.data.players || []) S.scoreboard[p.username] = p;
          }
          if (m.type === 'party:latency_updated') S.lastLatencies = m.data.latencies;
          if (m.type === 'ping:ack') S.lastPingAck = m.data.latencyMs;
          if (m.type === 'video:time') { S.lastVideoTime = m.data.videoTime; S.hostPlaying = !!m.data.isPlaying; }
          if (m.type === 'error') S.errors.push(m.data && m.data.message);
        } catch {}
      } else if (ev.data instanceof ArrayBuffer) {
        const v = new DataView(ev.data);
        if (v.byteLength < 2) return;
        const kind = v.getUint8(0);
        if (kind !== 2 && kind !== 3) return; // notes batch; 3 carries a score (2 bytes) after each note
        const count = v.getUint8(1);
        S.receivedBatches++; S.receivedNotes += count;
        let o = 2; const dec = new TextDecoder();
        for (let i = 0; i < count; i++) {
          const n = v.getUint8(o); o++;
          const name = dec.decode(new Uint8Array(ev.data, o, n)); o += n + (kind === 3 ? 10 : 8);
          S.receivedFrom[name] = (S.receivedFrom[name] || 0) + 1;
        }
      }
    });
    ws.addEventListener('close', () => { if (isParty) { S.open--; S.closes++; } });
    return ws;
  };
  Wrapped.prototype = Native.prototype;
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Wrapped[k] = Native[k];
  window.WebSocket = Wrapped;

  let last = performance.now();
  const tick = (now) => { S.frames++; if (now - last > 100) S.slowFrames++; last = now; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) { S.longTasks++; S.longTaskMs += e.duration; } })
      .observe({ entryTypes: ['longtask'] });
  } catch {}
  S.reset = () => {
    S.frames = 0; S.slowFrames = 0; S.longTasks = 0; S.longTaskMs = 0; S.startedAt = performance.now();
    S.sentNotes = 0; S.receivedBatches = 0; S.receivedNotes = 0; S.receivedFrom = {}; S.closes = 0; S.errors = [];
    S.heapStart = performance.memory ? performance.memory.usedJSHeapSize : null;
  };
  S.snapshot = () => {
    S.heapNow = performance.memory ? performance.memory.usedJSHeapSize : null;
    const { reset, snapshot, ...rest } = S;
    return { ...rest, seconds: (performance.now() - S.startedAt) / 1000 };
  };
})();`;

const mb = (bytes) => (bytes == null ? '-' : (bytes / 1048576).toFixed(0));

async function waitForPartyId(page, timeoutMs = 20_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const id = await page.evaluate(() => {
      try { return JSON.parse(sessionStorage.getItem('singpro_party') || 'null')?.partyId ?? null; } catch { return null; }
    });
    if (id) return id;
    await page.waitForTimeout(250);
  }
  throw new Error('host never got a party id');
}

/** Note sending is gated on the video playing; autoplay usually does it, else click the player. */
async function ensurePlaying(host) {
  const playing = () => host.evaluate(() => window.__stress.hostPlaying);
  for (let i = 0; i < 20 && !(await playing()); i++) await host.waitForTimeout(500);
  if (await playing()) return true;
  try {
    await host.frameLocator('iframe[src*="youtube"]').locator('button.ytp-large-play-button').click({ timeout: 3000 });
  } catch { /* no play button (already playing / not loaded) */ }
  for (let i = 0; i < 20 && !(await playing()); i++) await host.waitForTimeout(500);
  return playing();
}

const sentNotes = (page) => page.evaluate(() => window.__stress.sentNotes);

// The microphone lives in the top-right mic panel (MicPanel.jsx): a toggle
// showing a crossed-out mic while off opens it, and the panel's "Join singing"
// button carries the open mic. Both are found by their icon paths so the UI
// language does not matter.
const MIC_OFF_ICON = 'svg path[d^="M9 9v3a3 3 0 0 0 5.12 2.12"]';
const MIC_ICON = 'svg path[d^="M12 1a3 3 0 0 0-3 3v8"]';

/** Open the mic panel and click "Join singing". False if the mic is already on. */
async function clickJoinSinging(page) {
  const toggle = page.locator(`button[aria-expanded]:has(${MIC_OFF_ICON})`);
  if (!await toggle.isVisible().catch(() => false)) return false;
  await toggle.click();
  const join = page.locator(`button:has(${MIC_ICON})`).first();
  await join.click({ timeout: 3000 });
  await page.locator('button[aria-expanded="true"]').click().catch(() => {}); // close the panel again
  return true;
}

/** Make sure a client sings and prove it took: notes must start flowing (one retry). */
async function ensureSinging(page, name) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (await sentNotes(page) > 0) return true;
    await clickJoinSinging(page).catch(() => {});
    for (let i = 0; i < 20; i++) {
      if (await sentNotes(page) > 0) return true;
      await page.waitForTimeout(500);
    }
  }
  console.log(`  WARNING: ${name} is not sending notes`);
  return false;
}

test.describe('Stress: many simultaneous singers', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'launches its own Chrome with a fake microphone');
  test.setTimeout(90_000 + REAL_SINGERS * 10_000 + STRESS_SECONDS * 2_000);

  let browser;
  let song = null;

  test.beforeAll(async () => {
    try {
      const res = await fetch(`${BASE}/api/songs/browse?limit=1`);
      if (res.ok) song = (await res.json()).data?.[0] ?? null;
    } catch { song = null; }
    browser = await chromium.launch({
      channel: 'chrome',
      args: [...chromeLaunchArgs(), '--autoplay-policy=no-user-gesture-required'],
    });
  });

  test.afterAll(async () => {
    await browser?.close();
  });

  test(`${REAL_SINGERS} browsers + ${BOT_SINGERS} bots sing together for ${STRESS_SECONDS}s${CPU_THROTTLE > 1 ? ` at CPU x${CPU_THROTTLE}` : ''}`, async () => {
    test.skip(!song, 'Backend not running or no songs — start singpro-be on :3000');

    const contexts = [];
    const clients = []; // { name, page }
    const bots = [];
    const newBrowserSinger = async (name) => {
      const context = await browser.newContext({ permissions: ['microphone'] });
      await context.addInitScript(MONITOR_SCRIPT);
      // The app starts a host's microphone only on a click, or when it remembers
      // the mic being on from the previous song (joiners start singing either
      // way). Remembering it for everyone makes each client sing from the first
      // frame -- the same path a returning singer takes -- instead of waiting
      // for the click fallback in ensureSinging, which would take long enough
      // for the song to end before the measurement starts.
      await context.addInitScript(() => { try { localStorage.setItem('singpro_mic_on', '1'); } catch { /* */ } });
      const page = await context.newPage();
      page.on('pageerror', e => console.log(`  [${name}] page error: ${e.message}`));
      if (CPU_THROTTLE > 1) {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
      }
      contexts.push(context);
      clients.push({ name, page });
      return page;
    };

    try {
      // --- Host creates the party and starts singing ---
      const host = await newBrowserSinger('Host');
      await host.goto(`${BASE}/sing/${song.songId}`);
      const partyId = await waitForPartyId(host);
      console.log(`  Party ${partyId}: ${song.artist} - ${song.title}`);
      const hostPlayed = await ensurePlaying(host);
      if (!hostPlayed) console.log('  WARNING: host video did not start — real singers will not send notes');
      if (hostPlayed) await ensureSinging(host, 'Host');

      // --- Real joiners (parallel, lightly staggered); they auto-join singing ---
      const joinerNames = Array.from({ length: REAL_SINGERS - 1 }, (_, i) => `Singer${String(i + 1).padStart(2, '0')}`);
      await Promise.all(joinerNames.map(async (name, i) => {
        await new Promise(r => setTimeout(r, i * 300));
        const page = await newBrowserSinger(name);
        await page.goto(`${BASE}/join/${partyId}`);
        await page.getByRole('textbox').first().fill(name);
        await page.locator('form').getByRole('button').first().click();
        await expect(page).toHaveURL(/\/sing\//, { timeout: 20_000 });
      }));

      // --- Synthetic singers ---
      const botNames = Array.from({ length: BOT_SINGERS }, (_, i) => `Bot${String(i + 1).padStart(2, '0')}`);
      for (const name of botNames) {
        const bot = startBotSinger({ url: `ws://localhost:3001/api/ws`, partyId, username: name });
        bots.push(bot);
        await bot.ready;
      }
      console.log(`  ${clients.length} browsers + ${bots.length} bots joined`);

      // --- Warm-up: wait until every real singer's pitch pipeline is producing notes ---
      if (hostPlayed) {
        const t0 = Date.now();
        let silent = clients;
        while (silent.length && Date.now() - t0 < 30_000) {
          await host.waitForTimeout(1000);
          const counts = await Promise.all(clients.map(c => sentNotes(c.page)));
          silent = clients.filter((_, i) => counts[i] === 0);
        }
        for (const c of silent) await ensureSinging(c.page, c.name);
        console.log(`  all singing after ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      } else {
        await host.waitForTimeout(5000);
      }
      await Promise.all(clients.map(c => c.page.evaluate(() => window.__stress.reset())));
      const videoAtStart = await host.evaluate(() => window.__stress.lastVideoTime ?? 0);
      const t0 = Date.now();
      while (Date.now() - t0 < STRESS_SECONDS * 1000) {
        await host.waitForTimeout(Math.min(5000, STRESS_SECONDS * 1000 - (Date.now() - t0)) || 1);
        const s = await host.evaluate(() => window.__stress.snapshot());
        const fps = (s.frames / s.seconds).toFixed(0);
        console.log(`  t=${s.seconds.toFixed(0)}s host: ${fps} fps, ${s.longTasks} long tasks, notes in ${s.receivedNotes} / out ${s.sentNotes}, heap ${mb(s.heapNow)} MB, video ${s.lastVideoTime?.toFixed(1) ?? '-'}s`);
      }

      // --- Collect ---
      const snaps = await Promise.all(clients.map(async c => ({ ...c, s: await c.page.evaluate(() => window.__stress.snapshot()) })));
      console.table(snaps.map(({ name, s }) => ({
        client: name,
        'fps': +(s.frames / s.seconds).toFixed(1),
        'slow frames': s.slowFrames,
        'long tasks': s.longTasks,
        'long task ms': Math.round(s.longTaskMs),
        'notes out': s.sentNotes,
        'notes in': s.receivedNotes,
        'from N singers': Object.keys(s.receivedFrom).length,
        'heap MB': `${mb(s.heapStart)}→${mb(s.heapNow)}`,
        'latency ms': s.lastPingAck == null ? '-' : Math.round(s.lastPingAck),
        'socket open': s.open, 'closes': s.closes,
      })));
      if (bots.length) {
        const sent = bots.reduce((a, b) => a + b.stats.sentNotes, 0);
        const closed = bots.filter(b => b.stats.closed).length;
        console.log(`  bots: ${bots.length}, notes out ${sent}, closed ${closed}, errors ${bots.flatMap(b => b.stats.errors).length}`);
      }

      const hostSnap = snaps[0].s;
      const totalNotesPerSec = hostSnap.receivedNotes / hostSnap.seconds;
      console.log(`  host received ${totalNotesPerSec.toFixed(0)} notes/s from ${Object.keys(hostSnap.receivedFrom).length} singers`);
      // A saturated machine starves the host's YouTube player of data (it sits
      // buffering, not paused), and while it buffers every mic pipeline idles,
      // so nobody sends notes. Fail on that first: "host received notes from
      // Singer01: 0" would blame the wrong thing. What saturates a machine is
      // real contexts times singers -- a dozen contexts joining at once, or a
      // few of them each digesting a hundred singers' notes; one context copes
      // with a hundred bots on a desktop (measured on a Ryzen 5 7500F).
      const videoAdvanced = (hostSnap.lastVideoTime ?? 0) - videoAtStart;
      if (hostPlayed) {
        expect(videoAdvanced, `host video kept playing (advanced ${videoAdvanced.toFixed(1)}s in ${STRESS_SECONDS}s; less means the test machine `
          + `is saturated -- too many Chrome contexts for this CPU and this many singers -- and the results are not representative. `
          + `Use fewer REAL_SINGERS and more BOT_SINGERS)`)
          .toBeGreaterThanOrEqual(STRESS_SECONDS * 0.5);
      }

      // --- Assertions: the party stayed healthy ---
      for (const { name, s } of snaps) {
        expect(s.open, `${name} has exactly one party socket open`).toBe(1);
        expect(s.closes, `${name} never disconnected during the run`).toBe(0);
        expect(s.errors, `${name} got no server errors`).toEqual([]);
      }
      for (const b of bots) {
        expect(b.stats.closed, `${b.stats.username} stayed connected`).toBe(false);
        expect(b.stats.errors, `${b.stats.username} got no errors`).toEqual([]);
      }

      const expectedSingers = [...(hostPlayed ? joinerNames : []), ...botNames];
      if (hostSnap.lanes?.pinned) {
        // A crowd: the server relays only the singers on screen (8 lanes, one
        // rotating per lyric line), so the host hears from those alone
        console.log(`  lanes: pinned ${hostSnap.lanes.pinned.join(', ')} | spotlight ${hostSnap.lanes.spotlight.join(', ')}`);
        const heard = Object.keys(hostSnap.receivedFrom);
        for (const name of heard) expect(hostSnap.laneNames[name] ?? 0, `${name}'s notes reached the host only while on a lane`).toBe(1);
        expect(heard.length, 'a full set of lanes reached the host').toBeGreaterThanOrEqual(Math.min(8, expectedSingers.length));
      } else {
        for (const name of expectedSingers) {
          expect(hostSnap.receivedFrom[name] ?? 0, `host received notes from ${name}`).toBeGreaterThan(0);
        }
      }
      if (hostPlayed) {
        for (const { name, s } of snaps) {
          expect(s.sentNotes, `${name} sent notes`).toBeGreaterThan(0);
        }
      }

      const scoreboard = new Set(Object.keys(hostSnap.scoreboard ?? {}));
      for (const name of ['Host', ...expectedSingers]) {
        expect(scoreboard.has(name), `${name} is on the host's scoreboard`).toBe(true);
      }

      expect(hostSnap.frames / hostSnap.seconds, 'host frame rate').toBeGreaterThanOrEqual(MIN_FPS);
      if (hostSnap.lastPingAck != null) expect(hostSnap.lastPingAck, 'host latency (ms)').toBeLessThan(500);
    } finally {
      for (const b of bots) b.close();
      await Promise.all(contexts.map(c => c.close().catch(() => {})));
    }
  });
});
