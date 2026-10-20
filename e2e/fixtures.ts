import { test as base, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Extended test fixture that launches Chrome with fake media devices.
 * Feeds a WAV file as the microphone input — the real pitch detection
 * pipeline (AudioWorklet → PitchWorker → ONNX) processes actual audio.
 */
export const test = base.extend({
  /**
   * Browser context with fake mic feeding a 440Hz sine wave.
   * Usage: test('...', async ({ micContext }) => { ... })
   */
  micContext: async ({ browser }, use) => {
    const audioFile = path.resolve(__dirname, 'fixtures', 'a4-440hz.wav');
    const context = await browser.newContext({
      permissions: ['microphone'],
    });
    // Chrome args for fake media are set at browser level (see launchOptions below)
    await use(context);
    await context.close();
  },
});

/**
 * Launch options for Chrome with fake audio device.
 * Pass a WAV file path to use as microphone input.
 */
export function chromeLaunchArgs(audioFilePath) {
  const resolved = audioFilePath
    ? path.resolve(__dirname, audioFilePath)
    : path.resolve(__dirname, 'fixtures', 'a4-440hz.wav');

  return [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream', // auto-grant mic permission
    `--use-file-for-fake-audio-capture=${resolved}`,
  ];
}

export { expect };
