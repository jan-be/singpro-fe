import { describe, it, expect, vi } from 'vitest';
import { startWasmPitchWorker, COMPAT_KEY } from './pitchWorkerChoice';

const memoryStorage = () => {
  const map = new Map();
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
};
const OOM = new Error('no available backend found. ERR: [wasm] RangeError: Out of memory');
const ok = (provider) => vi.fn(async () => ({ worker: {}, provider }));
const fail = (err) => vi.fn(async () => { throw err; });

describe('startWasmPitchWorker', () => {
  it('uses ONNX Runtime 1.29 when it starts', async () => {
    const startMain = ok('wasm'), startCompat = ok('wasm-1.18'), storage = memoryStorage();
    const r = await startWasmPitchWorker({ startMain, startCompat, storage, userAgent: 'UA' });
    expect(r.provider).toBe('wasm');
    expect(startCompat).not.toHaveBeenCalled();
    expect(storage.map.size).toBe(0);
  });

  it('falls back to 1.18 when 1.29 runs out of memory, and remembers it for this browser', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = memoryStorage();
    const r = await startWasmPitchWorker({ startMain: fail(OOM), startCompat: ok('wasm-1.18'), storage, userAgent: 'Safari 16' });
    expect(r.provider).toBe('wasm-1.18');
    expect(storage.getItem(COMPAT_KEY)).toBe('Safari 16');

    // Next time 1.29 is not tried at all
    const startMain = ok('wasm');
    const again = await startWasmPitchWorker({ startMain, startCompat: ok('wasm-1.18'), storage, userAgent: 'Safari 16' });
    expect(again.provider).toBe('wasm-1.18');
    expect(startMain).not.toHaveBeenCalled();
  });

  it('tries 1.29 again once the browser has changed (an update)', async () => {
    const storage = memoryStorage();
    storage.setItem(COMPAT_KEY, 'Safari 16');
    const startMain = ok('wasm');
    const r = await startWasmPitchWorker({ startMain, startCompat: ok('wasm-1.18'), storage, userAgent: 'Safari 18' });
    expect(r.provider).toBe('wasm');
    expect(startMain).toHaveBeenCalledOnce();
  });

  it('tries 1.18 on other failures too, but does not remember them', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = memoryStorage();
    const r = await startWasmPitchWorker({ startMain: fail(new Error('pitch worker failed to load')), startCompat: ok('wasm-1.18'), storage, userAgent: 'UA' });
    expect(r.provider).toBe('wasm-1.18');
    expect(storage.map.size).toBe(0);
  });

  it('reports the first error when neither starts', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = memoryStorage();
    await expect(startWasmPitchWorker({ startMain: fail(OOM), startCompat: fail(new Error('compat broke')), storage, userAgent: 'UA' }))
      .rejects.toBe(OOM);
    expect(storage.map.size).toBe(0);
  });

  it('starts the minimal runtime first and leaves the stock ones alone when it starts', async () => {
    const startMain = ok('wasm'), startCompat = ok('wasm-1.18'), storage = memoryStorage();
    const r = await startWasmPitchWorker({ startMinimal: ok('wasm-min'), startMain, startCompat, storage, userAgent: 'UA' });
    expect(r.provider).toBe('wasm-min');
    expect(startMain).not.toHaveBeenCalled();
    expect(startCompat).not.toHaveBeenCalled();
  });

  it('falls back to the stock runtimes when the minimal one fails, with their own memory rule', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = memoryStorage();
    const r = await startWasmPitchWorker({ startMinimal: fail(new Error('WebAssembly SIMD is not supported')), startMain: fail(OOM), startCompat: ok('wasm-1.18'), storage, userAgent: 'Safari 16' });
    expect(r.provider).toBe('wasm-1.18');
    expect(storage.getItem(COMPAT_KEY)).toBe('Safari 16');

    // A remembered browser still tries the minimal runtime first, then 1.18 without 1.29
    const startMinimal = fail(new Error('again')), startMain = ok('wasm');
    const again = await startWasmPitchWorker({ startMinimal, startMain, startCompat: ok('wasm-1.18'), storage, userAgent: 'Safari 16' });
    expect(again.provider).toBe('wasm-1.18');
    expect(startMinimal).toHaveBeenCalledOnce();
    expect(startMain).not.toHaveBeenCalled();
  });

  it('reports the minimal runtime\'s error when nothing starts', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = new Error('minimal broke');
    await expect(startWasmPitchWorker({ startMinimal: fail(first), startMain: fail(OOM), startCompat: fail(new Error('compat broke')), storage: memoryStorage(), userAgent: 'UA' }))
      .rejects.toBe(first);
  });

  it('works without storage (private mode)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    const r = await startWasmPitchWorker({ startMain: fail(OOM), startCompat: ok('wasm-1.18'), storage: throwing, userAgent: 'UA' });
    expect(r.provider).toBe('wasm-1.18');
  });
});
