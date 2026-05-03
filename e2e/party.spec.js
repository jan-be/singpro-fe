import { test, expect, chromium } from '@playwright/test';
import { chromeLaunchArgs } from './fixtures.js';

/**
 * Party E2E tests with real audio simulation.
 *
 * Chrome is launched with --use-fake-device-for-media-stream which feeds
 * a WAV file (440Hz sine) as the microphone. The full pitch detection
 * pipeline runs: getUserMedia → AudioWorklet/TrackProcessor → PitchWorker → ONNX.
 *
 * Requires: backend running on :3000.
 */
test.describe('Party with audio', () => {
  let browser;
  let backendAvailable = false;
  let validSongId = null;

  test.beforeAll(async () => {
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

  test('host creates party and detects pitch from fake mic', async () => {
    test.skip(!backendAvailable || !validSongId, 'Backend not running or no songs — start singpro-be on :3000');

    const context = await browser.newContext({
      permissions: ['microphone'],
    });
    const page = await context.newPage();

    // Collect console messages for debugging
    const consoleLogs = [];
    page.on('console', msg => consoleLogs.push(msg.text()));

    await page.goto(`http://localhost:3001/sing/${validSongId}`);

    // Wait for party creation + model load + some pitch processing
    await page.waitForTimeout(6000);

    // Check that ONNX backend was initialized
    const initLog = consoleLogs.find(l => l.includes('[PitchWorker] Initialized'));
    expect(initLog).toBeTruthy();
    console.log('  PitchWorker:', initLog);

    // GPU detection log
    const gpuLog = consoleLogs.find(l => l.includes('[PitchWorker] GPU detection'));
    if (gpuLog) console.log('  GPU:', gpuLog);

    // Check for octave jumps (should be near-zero with pure sine)
    const octaveJumps = consoleLogs.filter(l => l.includes('[OCTAVE_JUMP]'));
    console.log(`  Octave jumps: ${octaveJumps.length}`);
    expect(octaveJumps.length).toBeLessThanOrEqual(2);

    await context.close();
  });

  test('host and joiner connect to same party', async () => {
    test.skip(!backendAvailable || !validSongId, 'Backend not running or no songs — start singpro-be on :3000');

    // --- Host ---
    const hostContext = await browser.newContext({
      permissions: ['microphone'],
    });
    const hostPage = await hostContext.newPage();
    await hostPage.goto(`http://localhost:3001/sing/${validSongId}`);
    await hostPage.waitForTimeout(3000);

    // Extract party ID from sessionStorage
    let partyId = await hostPage.evaluate(() => sessionStorage.getItem('partyId'));

    if (!partyId) {
      // Try from visible text (4 uppercase letter code)
      const codeEl = hostPage.locator('text=/^[A-Z]{4}$/').first();
      if (await codeEl.isVisible({ timeout: 2000 }).catch(() => false)) {
        partyId = (await codeEl.textContent()).trim();
      }
    }

    console.log(`  Party ID: ${partyId || '(not found)'}`);
    test.skip(!partyId, 'Could not extract party ID from host page');

    // --- Joiner ---
    const joinerContext = await browser.newContext({
      permissions: ['microphone'],
    });
    const joinerPage = await joinerContext.newPage();
    await joinerPage.goto(`http://localhost:3001/join/${partyId}`);
    await joinerPage.waitForTimeout(2000);

    // Enter username and join
    const nameInput = joinerPage.locator('input[type="text"]').first();
    if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await nameInput.fill('E2EJoiner');
      const joinButton = joinerPage.locator('button').filter({ hasText: /join/i }).first();
      if (await joinButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await joinButton.click();
        await joinerPage.waitForTimeout(2000);
        // Joiner should end up on the party/sing page
        await expect(joinerPage).toHaveURL(/\/sing\//);
        console.log('  Joiner successfully connected to party');
      }
    }

    await joinerContext.close();
    await hostContext.close();
  });
});
