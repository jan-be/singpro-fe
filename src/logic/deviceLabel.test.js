import { describe, it, expect } from 'vitest';
import { deviceLabel } from './deviceLabel.js';

describe('deviceLabel', () => {
  it('names the browser and the system for the usual phones and laptops', () => {
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36')).toBe('Chrome · Android');
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')).toBe('Safari · iPhone');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0')).toBe('Edge · Windows');
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36')).toBe('Chrome · Mac');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0')).toBe('Firefox · Windows');
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 9; AFTKA Build/PS7285) AppleWebKit/537.36 (KHTML, like Gecko) Silk/122.4.1 like Chrome/122.0.6261.128 Safari/537.36')).toBe('Silk · Android');
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36')).toBe('Samsung Internet · Android');
  });

  it('calls out headless browsers and scripts, and shrugs at nothing', () => {
    expect(deviceLabel('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/128.0.0.0 Safari/537.36')).toBe('Headless Chrome');
    expect(deviceLabel('Bun/1.4.2')).toBe('script (Bun/1.4.2)');
    expect(deviceLabel('curl/8.4.0')).toBe('script (curl/8.4.0)');
    expect(deviceLabel('python-requests/2.32.3')).toBe('script (python-requests/2.32.3)');
    expect(deviceLabel(null)).toBe('');
    expect(deviceLabel('')).toBe('');
  });
});
