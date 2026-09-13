// pitchGpuFlag.js — opt-in GPU pitch detection (ORT's WebGPU provider), there
// to measure it on real devices: `?gpu=1` on any page turns it on for this
// browser, `?gpu=0` turns it off. The choice lives in localStorage so it
// survives the join → party navigation. Without WebGPU the WASM worker is
// used regardless (see MicrophoneInput.js).

const KEY = 'singpro_pitch_gpu';

/** Call once at startup: a ?gpu= parameter updates the stored choice. */
export function syncPitchGpuFlagFromUrl() {
  try {
    const v = new URLSearchParams(window.location.search).get('gpu');
    if (v === null) return;
    if (v === '0' || v === 'false' || v === 'off') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, '1');
  } catch { /* */ }
}

export function isPitchGpuEnabled() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
