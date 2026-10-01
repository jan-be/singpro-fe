// pitchWorkerChoice.js — which WASM pitch worker to start: PitchWorker.js
// (ONNX Runtime 1.29), or PitchWorkerCompat.js (1.18) where 1.29 cannot start.
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
 * @param {() => Promise<{worker, provider}>} o.startMain    the 1.29 worker
 * @param {() => Promise<{worker, provider}>} o.startCompat  the 1.18 worker
 * @param {Storage} [o.storage]
 * @param {string} [o.userAgent]
 * @returns {Promise<{worker, provider}>}
 */
export async function startWasmPitchWorker({ startMain, startCompat, storage = globalThis.localStorage, userAgent = globalThis.navigator?.userAgent ?? '' }) {
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
