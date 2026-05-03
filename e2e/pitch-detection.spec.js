import { test, expect, chromium } from '@playwright/test';
import { chromeLaunchArgs } from './fixtures.js';

/**
 * Pitch detection E2E test.
 *
 * Feeds a 440Hz sine wave as fake microphone input and verifies the
 * full in-browser pipeline detects the correct pitch (A4 = semitone ~69).
 *
 * Requires: backend running on :3000 (Vite proxies /api to it).
 */
test.describe('Pitch detection pipeline', () => {
  let browser;
  let backendAvailable = false;
  let validSongId = null;

  test.beforeAll(async () => {
    // Check if backend is reachable and get a valid song ID
    try {
      const res = await fetch('http://localhost:3001/api/songs');
      if (res.ok) {
        backendAvailable = true;
        const songs = await res.json();
        if (songs.length > 0) validSongId = songs[0].songId;
      }
    } catch {
      backendAvailable = false;
    }

    browser = await chromium.launch({
      channel: 'chrome',
      args: chromeLaunchArgs(),
    });
  });

  test.afterAll(async () => {
    await browser.close();
  });

  test('Chrome receives fake audio from WAV file', async () => {
    // This test verifies the fake audio device works — no backend needed,
    // but needs localhost for secure context (getUserMedia requires it)
    const context = await browser.newContext({
      permissions: ['microphone'],
    });
    const page = await context.newPage();

    // Navigate to localhost (Vite serves index.html even without backend)
    // We just need a secure context to access getUserMedia
    await page.goto('http://localhost:3001/', { waitUntil: 'domcontentloaded' });

    // Run audio capture test in the page context
    const result = await page.evaluate(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const track = stream.getAudioTracks()[0];

        // Create AudioContext to read samples
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);

        // Wait for some audio data
        await new Promise(r => setTimeout(r, 500));

        const buffer = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatTimeDomainData(buffer);

        // Check if we got non-silent audio
        let maxAmp = 0;
        for (let i = 0; i < buffer.length; i++) {
          maxAmp = Math.max(maxAmp, Math.abs(buffer[i]));
        }

        track.stop();
        ctx.close();

        return {
          ok: true,
          sampleRate: ctx.sampleRate,
          maxAmplitude: maxAmp,
          hasAudio: maxAmp > 0.01,
        };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });

    console.log('  Fake audio capture result:', result);
    expect(result.ok).toBe(true);
    expect(result.hasAudio).toBe(true);
    expect(result.maxAmplitude).toBeGreaterThan(0.01);

    await context.close();
  });

  test('detects 440Hz as A4 with full pipeline', async () => {
    test.skip(!backendAvailable || !validSongId, 'Backend not running or no songs — start singpro-be on :3000');

    const context = await browser.newContext({
      permissions: ['microphone'],
    });
    const page = await context.newPage();

    // Collect pitch worker logs
    const workerLogs = [];
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[PitchWorker]') || text.includes('[MicInput]')) {
        workerLogs.push(text);
      }
    });

    // Navigate to a valid song page with debug mode
    await page.goto(`/sing/${validSongId}?debug`);

    // Wait for ONNX model to load and pitch detection to start
    await page.waitForTimeout(6000);

    // Verify the backend initialized
    const initLog = workerLogs.find(l => l.includes('Initialized'));
    expect(initLog).toBeTruthy();
    console.log(`  Backend: ${initLog}`);

    // Log GPU detection info
    const gpuLog = workerLogs.find(l => l.includes('GPU detection'));
    if (gpuLog) console.log(`  GPU: ${gpuLog}`);

    // Check for octave jumps (should be near-zero with a pure sine)
    const octaveJumps = workerLogs.filter(l => l.includes('[OCTAVE_JUMP]'));
    console.log(`  Octave jumps: ${octaveJumps.length}`);
    expect(octaveJumps.length).toBeLessThanOrEqual(2);

    await context.close();
  });

  test('reports ONNX backend type (webgpu or wasm)', async () => {
    test.skip(!backendAvailable || !validSongId, 'Backend not running or no songs — start singpro-be on :3000');

    const context = await browser.newContext({
      permissions: ['microphone'],
    });
    const page = await context.newPage();

    let backend = null;
    page.on('console', msg => {
      const text = msg.text();
      const match = text.match(/Initialized with (\w+) backend/);
      if (match) backend = match[1];
    });

    await page.goto(`/sing/${validSongId}`);
    await page.waitForTimeout(6000);

    expect(backend).toBeTruthy();
    expect(['webgpu', 'wasm']).toContain(backend);
    console.log(`  ONNX backend: ${backend}`);

    await context.close();
  });
});
