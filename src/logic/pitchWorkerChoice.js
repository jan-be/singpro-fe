// pitchWorkerChoice.js — which WASM pitch worker to start: PitchWorkerMinimal.js
// (our minimal ONNX Runtime build), and only where that cannot start the stock
// runtimes: PitchWorker.js (ONNX Runtime 1.29), or PitchWorkerCompat.js (1.18)
// where 1.29 cannot start. The stock two stay as a safety net until the
// minimal one has proven itself on old iPhones and iPads; each is downloaded
// only when it is tried.
//
// A browser whose 1.29 worker ran out of memory is remembered (by its user
// agent) and goes straight to 1.18 next time: Safari before iOS 18 does not
// give shared WebAssembly memory back, so every failed attempt makes the next
// one fail sooner. An updated browser has another user agent and tries 1.29
// again. Other failures (a network hiccup, an old tab whose files are gone
// after a deploy) also try 1.18 once, but are not remembered.

export const COMPAT_KEY = 'singpro_pitch_compat';

const isMemoryError = (e) => /out of memory/i.test(e?.message ?? '');

/**
 * @param {object} o
 * @param {() => Promise<{worker, provider}>} [o.startMinimal]  the minimal-runtime worker, tried first
 * @param {() => Promise<{worker, provider}>} o.startMain    the 1.29 worker
 * @param {() => Promise<{worker, provider}>} o.startCompat  the 1.18 worker
 * @param {Storage} [o.storage]
 * @param {string} [o.userAgent]
 * @returns {Promise<{worker, provider}>}
 */
export async function startWasmPitchWorker({ startMinimal, ...stock }) {
  if (!startMinimal) return startStockPitchWorker(stock);
  try {
    return await startMinimal();
  } catch (e) {
    console.warn('[pitch] the minimal ONNX Runtime could not start, trying the stock one:', e.message);
    try { return await startStockPitchWorker(stock); } catch { throw e; } // none works: report the first failure
  }
}

async function startStockPitchWorker({ startMain, startCompat, storage = globalThis.localStorage, userAgent = globalThis.navigator?.userAgent ?? '' }) {
  let remembered = false;
  try { remembered = storage?.getItem(COMPAT_KEY) === userAgent; } catch { /* */ }
  if (remembered) return startCompat();

  try {
    return await startMain();
  } catch (e) {
    console.warn('[pitch] ONNX Runtime 1.29 could not start, trying 1.18:', e.message);
    let result;
    try { result = await startCompat(); } catch { throw e; } // neither works: report the first failure
    if (isMemoryError(e)) {
      try { storage?.setItem(COMPAT_KEY, userAgent); } catch { /* */ }
    }
    return result;
  }
}
