import { test, expect } from '@playwright/test';

/**
 * Basic navigation tests.
 * These require the backend to be running for API data.
 */
test.describe('Homepage', () => {
  let backendAvailable = false;

  test.beforeAll(async () => {
    try {
      const res = await fetch('http://localhost:3001/api/songs');
      backendAvailable = res.ok;
    } catch {
      backendAvailable = false;
    }
  });

  test('loads and displays the app', async ({ page }) => {
    test.skip(!backendAvailable, 'Backend not running — start singpro-be on :3000');

    // Start listening for API responses BEFORE navigating
    const responsePromise = page.waitForResponse(
      resp => resp.url().includes('/api/') && resp.status() === 200,
      { timeout: 10_000 }
    );
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
  });

  test('navigates to a song page', async ({ page }) => {
    test.skip(!backendAvailable, 'Backend not running — start singpro-be on :3000');

    await page.goto('/');
    // Wait for the page to be fully loaded with content
    const firstSong = page.locator('a[href*="/sing/"]').first();
    await expect(firstSong).toBeVisible({ timeout: 10_000 });
    await firstSong.click();
    await expect(page).toHaveURL(/\/sing\//);
  });
});
