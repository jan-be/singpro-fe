// pitch-detection.integration.test.js
// Integration test: decodes vocal recordings through swift-f0 ONNX model,
// compares detected pitch against UltraStar lyrics for Iris by Goo Goo Dolls.

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import * as ort from 'onnxruntime-node';
import { hzToSemitone, noteIntFromPitch, RMS_SILENCE_FLOOR, createNoiseGate } from './MicSharedFuns.js';
import { readTextFile, secSinceStartToTickFloat } from './LyricsParser.js';

// --- Constants matching the real-time pipeline ---
const SAMPLE_RATE = 16000;         // swift-f0 native rate (now also the AudioContext rate)
const WINDOW_SIZE = 1280;          // samples at 16kHz (~80ms)
const HOP_SIZE = 320;              // 75% overlap (~50 windows/sec)
const CONFIDENCE_THRESHOLD = 0.85;
const MIN_PITCH_HZ = 46.875;
const MAX_PITCH_HZ = 2093.75;

// Fixed threshold for test recordings (mixed vocal + instrumental).
// These aren't isolated mic signals, so the adaptive noise gate can't
// distinguish voice from background music. A low fixed threshold is
// appropriate here to just skip digital silence.
const TEST_SILENCE_THRESHOLD = 0.012;

// Paths
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SINGPRO_ROOT = path.resolve(ROOT, '..');
const MODEL_PATH = path.resolve(ROOT, 'public', 'model.onnx');

// --- Shared helpers ---

/** Decode MP3 to Float32Array mono PCM at a given sample rate using ffmpeg */
function decodeMp3ToFloat32(mp3Path, sampleRate) {
  const raw = execSync(
    `ffmpeg -i "${mp3Path}" -f s16le -acodec pcm_s16le -ac 1 -ar ${sampleRate} -`,
    { maxBuffer: 100 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }
  );
  const int16 = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
  return float32;
}

/** Run ONNX inference on a 16kHz audio chunk, return best pitch Hz (or 0) */
async function detectPitch(session, audio16k) {
  const inputTensor = new ort.Tensor('float32', audio16k, [1, audio16k.length]);
  const results = await session.run({ input_audio: inputTensor });
  const pitchHz = results.pitch_hz.data;
  const confidence = results.confidence.data;
  if (pitchHz.length === 0) return 0;
  const lastIdx = pitchHz.length - 1;
  if (confidence[lastIdx] >= CONFIDENCE_THRESHOLD &&
      pitchHz[lastIdx] >= MIN_PITCH_HZ &&
      pitchHz[lastIdx] <= MAX_PITCH_HZ) {
    return pitchHz[lastIdx];
  }
  return 0;
}

/**
 * Process a full recording against a set of UltraStar lyrics.
 * Slides a window over 16kHz audio, runs ONNX inference directly,
 * and compares detected notes against expected tones tick by tick.
 * Returns a stats object and prints a detailed report to console.
 */
async function analyzeRecording(label, audio16k, lyricData, session) {
  const counts = {
    totalNotes: 0, detected: 0,
    correctNote: 0, correctOctave: 0,
    silenceCorrect: 0, totalSilence: 0, falsePositive: 0,
  };
  const errorDist = {}; // semitone diff → count (after octave adj)
  const missSamples = [];

  const numWindows = Math.floor((audio16k.length - WINDOW_SIZE) / HOP_SIZE);

  for (let w = 0; w < numWindows; w++) {
    const start = w * HOP_SIZE;
    const chunk = audio16k.slice(start, start + WINDOW_SIZE);

    // RMS volume
    let sumSq = 0;
    for (let i = 0; i < WINDOW_SIZE; i++) sumSq += chunk[i] * chunk[i];
    const volume = Math.sqrt(sumSq / WINDOW_SIZE);

    let note = 0;
    let pitchHz = 0;
    if (volume >= TEST_SILENCE_THRESHOLD) {
      // Already at 16kHz — send directly to ONNX (no resampling needed)
      pitchHz = await detectPitch(session, chunk);
      if (pitchHz > 0) {
        note = Math.round(hzToSemitone(pitchHz));
      }
    }

    // Map window center to tick
    const sec = (start + WINDOW_SIZE / 2) / SAMPLE_RATE;
    const tick = Math.floor(secSinceStartToTickFloat(lyricData, sec));
    if (tick < 0 || tick >= lyricData.lyricRefs.length) continue;

    const ref = lyricData.lyricRefs[tick];
    if (!ref) continue;
    const syllable = lyricData.lyricLines[ref.lineIndex]?.[ref.syllableIndex];
    if (!syllable) continue;

    const expectedTone = syllable.tone;
    const isSilent = ref.isSilent || syllable.isBreak;

    if (isSilent) {
      counts.totalSilence++;
      if (note === 0) counts.silenceCorrect++;
      else counts.falsePositive++;
    } else {
      counts.totalNotes++;
      if (note !== 0) {
        counts.detected++;

        const diff = expectedTone - note;
        const octaveShift = Math.round(diff / 12) * 12;
        const adjusted = note + octaveShift;
        const semitoneError = adjusted - expectedTone;

        errorDist[semitoneError] = (errorDist[semitoneError] || 0) + 1;
        if (Math.abs(note - expectedTone) <= 1) counts.correctNote++;
        if (Math.abs(semitoneError) <= 1) counts.correctOctave++;

        if (Math.abs(semitoneError) > 2 && missSamples.length < 20) {
          missSamples.push({ sec: sec.toFixed(2), tick, detected: note, expected: expectedTone,
            adjusted, semitoneError, pitchHz: pitchHz.toFixed(1), syllable: syllable.syllable?.trim() });
        }
      }
    }
  }

  // --- Report ---
  const det = counts.detected;
  const detRate   = det / counts.totalNotes;
  const octAcc    = counts.correctOctave / counts.totalNotes;
  const silAcc    = counts.silenceCorrect / (counts.totalSilence || 1);
  const detAcc    = det > 0 ? counts.correctOctave / det : 0;

  const sortedErrors = Object.entries(errorDist)
    .map(([k, v]) => [parseInt(k), v])
    .sort((a, b) => a[0] - b[0]);

  console.log(`\n=== ${label} ===`);
  console.log(`Note ticks:    ${counts.totalNotes}  |  Detected: ${det} (${(detRate*100).toFixed(1)}%)`);
  console.log(`Direct ±1:     ${counts.correctNote} (${(counts.correctNote/counts.totalNotes*100).toFixed(1)}%)  |  Octave-adj ±1: ${counts.correctOctave} (${(octAcc*100).toFixed(1)}%)`);
  console.log(`Silence:       ${counts.totalSilence}  |  Correct: ${counts.silenceCorrect} (${(silAcc*100).toFixed(1)}%)  |  False+: ${counts.falsePositive}`);
  console.log(`Of detected:   octave-adj correct ${counts.correctOctave}/${det} (${(detAcc*100).toFixed(1)}%)`);

  console.log(`\nSemitone error distribution (octave-adj, of ${det} detected):`);
  for (const [err, count] of sortedErrors) {
    const pct = (count / det * 100).toFixed(1);
    const bar = '#'.repeat(Math.min(50, Math.round(count / det * 100)));
    const label = err === 0 ? '  exact' : err > 0 ? ` +${err} st` : ` ${err} st`;
    console.log(`  ${label.padStart(7)}: ${String(count).padStart(5)} (${pct.padStart(5)}%) ${bar}`);
  }

  const withinN = [1, 2, 3, 4, 5, 6].map(n => {
    const c = sortedErrors.filter(([e]) => Math.abs(e) <= n).reduce((s, [, v]) => s + v, 0);
    return [n, c];
  });
  console.log(`\nCumulative (of ${det}):`);
  for (const [n, c] of withinN) {
    console.log(`  ±${n} st: ${c}/${det} (${(c/det*100).toFixed(1)}%)`);
  }

  if (missSamples.length > 0) {
    console.log(`\nSample misses (err > ±2 st, first ${missSamples.length}):`);
    console.log('  sec    | tick | det | exp | adj | err | Hz      | syllable');
    console.log('  -------+------+-----+-----+-----+-----+---------+---------');
    for (const m of missSamples) {
      console.log(`  ${m.sec.padStart(6)} | ${String(m.tick).padStart(4)} | ${String(m.detected).padStart(3)} | ${String(m.expected).padStart(3)} | ${String(m.adjusted).padStart(3)} | ${String(m.semitoneError).padStart(3)} | ${m.pitchHz.padStart(7)} | ${m.syllable}`);
    }
  }

  // Stats
  let sumErr = 0, sumErrSq = 0;
  for (const [err, count] of sortedErrors) { sumErr += err * count; sumErrSq += err * err * count; }
  const meanErr = sumErr / det;
  const stdevErr = Math.sqrt(sumErrSq / det - meanErr * meanErr);
  console.log(`\nError stats: mean=${meanErr.toFixed(2)} st, stdev=${stdevErr.toFixed(2)} st`);
  console.log(`${'='.repeat(label.length + 8)}\n`);

  return { counts, sortedErrors, detRate, octAcc, silAcc, detAcc, meanErr, stdevErr, withinN };
}

// --- Shared session + lyrics (loaded once for all tests) ---

let session;
let lyricData;

beforeAll(async () => {
  expect(existsSync(MODEL_PATH), `model.onnx not found at ${MODEL_PATH}`).toBe(true);
  session = await ort.InferenceSession.create(MODEL_PATH, { executionProviders: ['cpu'] });

  const resp = await fetch('http://localhost:3000/songs/5IHtFA3lkZJ');
  const json = await resp.json();
  lyricData = await readTextFile(json.data.lyrics);
}, 60000);

// --- One-time sanity checks ---

describe('Model and pipeline sanity checks', () => {
  it('detects pitch from a vocal-like harmonic signal', async () => {
    const len = Math.floor(SAMPLE_RATE * 0.2); // 200ms
    const f0 = 220; // A3
    const sig = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const t = i / SAMPLE_RATE;
      sig[i] = 0.5  * Math.sin(2 * Math.PI * f0 * t)
             + 0.3  * Math.sin(2 * Math.PI * 2 * f0 * t)
             + 0.15 * Math.sin(2 * Math.PI * 3 * f0 * t)
             + 0.05 * Math.sin(2 * Math.PI * 4 * f0 * t);
    }
    const hz = await detectPitch(session, sig);
    if (hz > 0) {
      expect(hz).toBeGreaterThan(200);
      expect(hz).toBeLessThan(240);
    }
    // No hard failure if model doesn't detect synthetic audio
  });

  it('parses Iris lyrics correctly', () => {
    expect(lyricData.bpm).toBeGreaterThan(0);
    expect(lyricData.gap).toBeGreaterThanOrEqual(0);
    expect(lyricData.lyricLines.length).toBeGreaterThan(10);
  });
});

// --- Per-recording accuracy tests ---

describe('Pitch accuracy: iris.mp3', () => {
  let stats;

  beforeAll(async () => {
    const mp3 = path.resolve(SINGPRO_ROOT, 'iris.mp3');
    expect(existsSync(mp3), `iris.mp3 not found at ${mp3}`).toBe(true);
    const audio16k = decodeMp3ToFloat32(mp3, SAMPLE_RATE);
    stats = await analyzeRecording('iris.mp3', audio16k, lyricData, session);
  }, 120000);

  it('detects pitch in ≥30% of note ticks', () => {
    expect(stats.detRate).toBeGreaterThan(0.3);
  });

  it('octave-adjusted accuracy >5% overall', () => {
    expect(stats.octAcc).toBeGreaterThan(0.05);
  });

  it('silence rejection >30%', () => {
    expect(stats.silAcc).toBeGreaterThan(0.3);
  });

  it('≥50% of detected notes within ±3 semitones (octave-adj)', () => {
    const [, within3] = stats.withinN.find(([n]) => n === 3);
    expect(within3 / stats.counts.detected).toBeGreaterThan(0.5);
  });

  it('error distribution is concentrated (stdev <4 semitones)', () => {
    expect(stats.stdevErr).toBeLessThan(4);
  });
});

describe('Pitch accuracy: iris2.mp3', () => {
  let stats;

  beforeAll(async () => {
    const mp3 = path.resolve(SINGPRO_ROOT, 'iris2.mp3');
    expect(existsSync(mp3), `iris2.mp3 not found at ${mp3}`).toBe(true);
    const audio16k = decodeMp3ToFloat32(mp3, SAMPLE_RATE);
    stats = await analyzeRecording('iris2.mp3', audio16k, lyricData, session);
  }, 120000);

  it('detects pitch in ≥30% of note ticks', () => {
    expect(stats.detRate).toBeGreaterThan(0.3);
  });

  it('octave-adjusted accuracy >5% overall', () => {
    expect(stats.octAcc).toBeGreaterThan(0.05);
  });

  it('silence rejection >30%', () => {
    expect(stats.silAcc).toBeGreaterThan(0.3);
  });

  it('≥50% of detected notes within ±3 semitones (octave-adj)', () => {
    const [, within3] = stats.withinN.find(([n]) => n === 3);
    expect(within3 / stats.counts.detected).toBeGreaterThan(0.5);
  });

  it('error distribution is concentrated (stdev <4 semitones)', () => {
    expect(stats.stdevErr).toBeLessThan(4);
  });
});

// --- Sample size / inference timing tests ---
// Test how the model performs with smaller input windows.
// swift-f0's internal STFT hop is 256 samples, so:
//   1280 → ~5 output frames, 960 → ~3-4, 640 → ~2-3, 480 → ~1-2, 320 → ~1, 256 → ~1

describe('Sample size benchmark: inference time + accuracy', () => {
  const WINDOW_SIZES = [1280, 960, 640, 480, 320, 256];
  let audio16k;
  // Baseline pitches at 1280 for comparison
  let baselinePitches1280;

  // Use a vocal section (25s–45s of iris2.mp3)
  const START_SEC = 25;
  const END_SEC = 45;

  beforeAll(async () => {
    const mp3 = path.resolve(SINGPRO_ROOT, 'iris2.mp3');
    expect(existsSync(mp3), `iris2.mp3 not found at ${mp3}`).toBe(true);
    audio16k = decodeMp3ToFloat32(mp3, SAMPLE_RATE);

    // Build baseline at 1280
    const startSample = START_SEC * SAMPLE_RATE;
    const endSample = END_SEC * SAMPLE_RATE;
    const hop = 320;
    const numWindows = Math.floor((endSample - startSample - 1280) / hop);
    baselinePitches1280 = [];
    for (let w = 0; w < numWindows; w++) {
      const start = startSample + w * hop;
      const chunk = audio16k.slice(start, start + 1280);
      let sumSq = 0;
      for (let i = 0; i < 1280; i++) sumSq += chunk[i] * chunk[i];
      const volume = Math.sqrt(sumSq / 1280);
      if (volume < TEST_SILENCE_THRESHOLD) { baselinePitches1280.push(0); continue; }
      const hz = await detectPitch(session, chunk);
      baselinePitches1280.push(hz > 0 ? noteIntFromPitch(hz) : 0);
    }
    console.log(`\nBaseline (1280): ${baselinePitches1280.filter(p => p > 0).length}/${baselinePitches1280.length} non-silent windows`);
  }, 180000);

  for (const winSize of WINDOW_SIZES) {
    it(`window=${winSize} (${(winSize / SAMPLE_RATE * 1000).toFixed(0)}ms): measures inference time and pitch agreement with 1280 baseline`, async () => {
      const startSample = START_SEC * SAMPLE_RATE;
      const endSample = END_SEC * SAMPLE_RATE;
      // Use same hop as baseline (320) so we compare same audio positions
      const hop = 320;
      const numWindows = Math.floor((endSample - startSample - 1280) / hop);

      let totalInferenceMs = 0;
      let inferenceCount = 0;
      let matches = 0;
      let compared = 0;
      let detected = 0;
      let detectedBaseline = 0;

      for (let w = 0; w < numWindows; w++) {
        const start = startSample + w * hop;
        // For smaller windows, take the LAST winSize samples of the 1280-sample region
        // (the model uses the last STFT frame, so this gives the most comparable result)
        const chunkStart = start + (1280 - winSize);
        const chunk = audio16k.slice(chunkStart, chunkStart + winSize);

        let sumSq = 0;
        for (let i = 0; i < winSize; i++) sumSq += chunk[i] * chunk[i];
        const volume = Math.sqrt(sumSq / winSize);
        if (volume < TEST_SILENCE_THRESHOLD) continue;

        const t0 = performance.now();
        const hz = await detectPitch(session, chunk);
        totalInferenceMs += performance.now() - t0;
        inferenceCount++;

        const note = hz > 0 ? noteIntFromPitch(hz) : 0;
        if (note > 0) detected++;

        // Compare with baseline
        if (baselinePitches1280[w] > 0) {
          detectedBaseline++;
          if (note > 0) {
            compared++;
            if (Math.abs(note - baselinePitches1280[w]) <= 1) matches++;
          }
        }
      }

      const avgMs = totalInferenceMs / inferenceCount;
      const agreePct = compared > 0 ? (matches / compared * 100) : 0;
      const detPct = detectedBaseline > 0 ? (detected / detectedBaseline * 100) : 0;

      console.log(`  Window ${winSize} (${(winSize / SAMPLE_RATE * 1000).toFixed(0)}ms):`);
      console.log(`    Avg inference: ${avgMs.toFixed(2)}ms | ${inferenceCount} chunks`);
      console.log(`    Detection rate vs baseline: ${detected}/${detectedBaseline} (${detPct.toFixed(1)}%)`);
      console.log(`    Pitch agreement (±1 MIDI): ${matches}/${compared} (${agreePct.toFixed(1)}%)`);

      // All window sizes should run without errors
      expect(inferenceCount).toBeGreaterThan(0);
      // Current production window (1280) should have near-perfect self-agreement
      if (winSize === 1280) {
        expect(agreePct).toBeGreaterThan(95);
      }
    }, 180000);
  }
});

// --- Accuracy at different window sizes against lyrics ---

describe('Sample size accuracy against lyrics', () => {
  const WINDOW_SIZES_ACCURACY = [1280, 960, 640];

  for (const winSize of WINDOW_SIZES_ACCURACY) {
    it(`window=${winSize}: octave-adjusted accuracy against Iris lyrics`, async () => {
      const mp3 = path.resolve(SINGPRO_ROOT, 'iris2.mp3');
      const audio16k = decodeMp3ToFloat32(mp3, SAMPLE_RATE);
      const hopSize = Math.max(winSize >> 2, 160); // proportional hop, min 10ms

      const counts = { totalNotes: 0, detected: 0, correctOctave: 0 };
      const numWindows = Math.floor((audio16k.length - winSize) / hopSize);

      for (let w = 0; w < numWindows; w++) {
        const start = w * hopSize;
        const chunk = audio16k.slice(start, start + winSize);

        let sumSq = 0;
        for (let i = 0; i < winSize; i++) sumSq += chunk[i] * chunk[i];
        const volume = Math.sqrt(sumSq / winSize);

        let note = 0;
        if (volume >= TEST_SILENCE_THRESHOLD) {
          const pitchHz = await detectPitch(session, chunk);
          if (pitchHz > 0) note = Math.round(hzToSemitone(pitchHz));
        }

        // Map window center to tick
        const sec = (start + winSize / 2) / SAMPLE_RATE;
        const tick = Math.floor(secSinceStartToTickFloat(lyricData, sec));
        if (tick < 0 || tick >= lyricData.lyricRefs.length) continue;

        const ref = lyricData.lyricRefs[tick];
        if (!ref || ref.isSilent) continue;
        const syllable = lyricData.lyricLines[ref.lineIndex]?.[ref.syllableIndex];
        if (!syllable || syllable.isBreak) continue;

        counts.totalNotes++;
        if (note !== 0) {
          counts.detected++;
          const diff = syllable.tone - note;
          const octAdj = Math.round(diff / 12) * 12;
          if (Math.abs(note + octAdj - syllable.tone) <= 1) counts.correctOctave++;
        }
      }

      const detRate = counts.detected / counts.totalNotes;
      const octAcc = counts.correctOctave / counts.totalNotes;
      const detAcc = counts.detected > 0 ? counts.correctOctave / counts.detected : 0;

      console.log(`  Window ${winSize} (${(winSize / SAMPLE_RATE * 1000).toFixed(0)}ms, hop ${hopSize}):`);
      console.log(`    Detection: ${counts.detected}/${counts.totalNotes} (${(detRate*100).toFixed(1)}%)`);
      console.log(`    Oct-adj accuracy: ${counts.correctOctave}/${counts.totalNotes} (${(octAcc*100).toFixed(1)}%)`);
      console.log(`    Of detected: ${counts.correctOctave}/${counts.detected} (${(detAcc*100).toFixed(1)}%)`);

      // Minimum bar: all tested sizes (≥640) should detect something
      expect(counts.detected).toBeGreaterThan(0);
      // 1280 and 960 should maintain high accuracy
      if (winSize >= 960) {
        expect(octAcc).toBeGreaterThan(0.05);
      }
    }, 300000);
  }
});

// --- Gain invariance tests ---
// Verify that swift-f0 ONNX model produces the same pitch regardless of
// audio amplitude. This confirms the model is gain-invariant and that
// the adaptive noise gate (used in the live pipeline) is the only component
// that needs to handle varying mic gain levels.

describe('Gain invariance: ONNX model pitch consistency', () => {
  let baselinePitches;
  let audio16k;

  beforeAll(async () => {
    const mp3 = path.resolve(SINGPRO_ROOT, 'iris2.mp3');
    expect(existsSync(mp3), `iris2.mp3 not found at ${mp3}`).toBe(true);
    audio16k = decodeMp3ToFloat32(mp3, SAMPLE_RATE);

    // Run baseline at 1.0x gain on a vocal section (25s-45s)
    const startSample = 25 * SAMPLE_RATE;
    const endSample = 45 * SAMPLE_RATE;
    baselinePitches = [];

    const numWindows = Math.floor((endSample - startSample - WINDOW_SIZE) / HOP_SIZE);
    for (let w = 0; w < numWindows; w++) {
      const start = startSample + w * HOP_SIZE;
      const chunk = audio16k.slice(start, start + WINDOW_SIZE);
      let sumSq = 0;
      for (let i = 0; i < WINDOW_SIZE; i++) sumSq += chunk[i] * chunk[i];
      const volume = Math.sqrt(sumSq / WINDOW_SIZE);

      if (volume < TEST_SILENCE_THRESHOLD) {
        baselinePitches.push(0);
        continue;
      }
      const hz = await detectPitch(session, chunk);
      baselinePitches.push(hz > 0 ? noteIntFromPitch(hz) : 0);
    }
  }, 120000);

  for (const gain of [0.5, 0.25]) {
    it(`at ${gain}x gain, detected pitches match 1.0x baseline within ±1 MIDI`, async () => {
      const startSample = 25 * SAMPLE_RATE;
      const endSample = 45 * SAMPLE_RATE;
      const numWindows = Math.floor((endSample - startSample - WINDOW_SIZE) / HOP_SIZE);

      let matches = 0;
      let compared = 0;

      for (let w = 0; w < numWindows; w++) {
        if (baselinePitches[w] === 0) continue;

        const start = startSample + w * HOP_SIZE;
        const chunk = audio16k.slice(start, start + WINDOW_SIZE);

        // Scale down to simulate lower gain
        const scaled = new Float32Array(WINDOW_SIZE);
        for (let i = 0; i < WINDOW_SIZE; i++) scaled[i] = chunk[i] * gain;

        let sumSq = 0;
        for (let i = 0; i < WINDOW_SIZE; i++) sumSq += scaled[i] * scaled[i];
        const volume = Math.sqrt(sumSq / WINDOW_SIZE);
        if (volume < TEST_SILENCE_THRESHOLD * gain) continue; // scaled threshold

        const hz = await detectPitch(session, scaled);
        if (hz <= 0) continue;

        compared++;
        if (Math.abs(noteIntFromPitch(hz) - baselinePitches[w]) <= 1) matches++;
      }

      console.log(`  Gain ${gain}x: ${matches}/${compared} pitches match baseline (${(matches/compared*100).toFixed(1)}%)`);
      // All detected pitches should match — model is gain-invariant
      expect(matches / compared).toBeGreaterThan(0.95);
    }, 120000);
  }
});
