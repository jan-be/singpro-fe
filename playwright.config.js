import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_FIXTURE = path.resolve(__dirname, 'e2e', 'fixtures', 'a4-440hz.wav');

/**
 * Playwright E2E config for singpro.
 *
 * Runs against the Vite dev server (auto-started) with API proxied to the backend.
 * Uses system Chrome locally; adds WebKit for CI (requires supported OS).
 *
 * Chrome is launched with fake media device flags so getUserMedia() returns
 * audio from a WAV file instead of a real microphone. This lets tests exercise
 * the full pitch detection pipeline (AudioWorklet → PitchWorker → ONNX).
 *
 * Usage:
 *   npm run test:e2e          — headless
 *   npm run test:e2e:headed   — see the browser
 *   npm run test:e2e:ui       — interactive UI mode
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 30_000,

  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    video: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        // Use system Chrome (Playwright's bundled Chromium doesn't support Ubuntu 26.04)
        channel: 'chrome',
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            `--use-file-for-fake-audio-capture=${AUDIO_FIXTURE}`,
          ],
        },
      },
    },
    {
      name: 'webkit',
      use: {
        ...devices['iPhone 15'],
      },
    },
    {
      name: 'webkit-desktop',
      use: {
        ...devices['Desktop Safari'],
      },
    },
  ],

  // Auto-start the Vite dev server before running tests
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
