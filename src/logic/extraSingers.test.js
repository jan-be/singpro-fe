import { describe, expect, test, vi } from 'vitest';
import { createExtraSinger, deviceKey, freeDevices, loadExtraMics, nameProblem, newExtraMic, saveExtraMics } from './extraSingers';
import { readTextFile } from './LyricsParser';

vi.mock('./bleedController', () => ({
  FALLBACK_DELAY: 0.14,
  createBleedController: () => ({ pushAudio() {}, pushStamp() {}, nextDelay: () => 0.1, startSong() {}, state: () => ({ reference: 'none' }), dispose() {} }),
}));

const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

describe('extra microphone slots', () => {
  test('stored and read back; bad entries dropped, as many as there are', () => {
    const s = memory();
    const list = [
      { id: 'a', name: 'Mic 2', deviceId: 'dev1', color: 120, guestId: 'mic-a' },
      { id: 'b', name: 'Mic 3', deviceId: '', color: 'red' },
      { nope: true }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' },
    ];
    saveExtraMics(list, s);
    const back = loadExtraMics(s);
    expect(back.map(x => x.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(back[0]).toEqual(list[0]);
    expect(back[1]).toMatchObject({ deviceId: null, color: null });
    expect(back[1].guestId).toMatch(/^mic-/); // each microphone scores under a guest id of its own
    expect(loadExtraMics({ getItem: () => 'not json' })).toEqual([]);
  });

  test('a new slot takes the first free name and a colour nobody wears', () => {
    const first = newExtraMic([], { taken: ['Ann', 'mic 2'], palette: [10, 20, 30], usedColors: [10] });
    expect(first.name).toBe('Mic 3');
    expect(first.color).toBe(20);
    const second = newExtraMic([first], { palette: [10, 20, 30], usedColors: [10], label: n => `Micro ${n}` });
    expect(second.name).toBe('Micro 2');
    expect(second.color).toBe(30);
    expect(second.guestId).not.toBe(first.guestId);
  });

  test('every microphone once: what one uses is not offered to the others', () => {
    // Chrome: the default microphone a second time under 'default' (and 'communications')
    const devices = [
      { deviceId: 'default', groupId: 'g1', label: 'Default - USB Mic (Blue)' },
      { deviceId: 'communications', groupId: 'g2', label: 'Communications - Headset (Jabra)' },
      { deviceId: 'blue', groupId: 'g1', label: 'USB Mic (Blue)' },
      { deviceId: 'jabra', groupId: 'g2', label: 'Headset (Jabra)' },
      { deviceId: 'cam', groupId: 'g3', label: 'Webcam' },
    ];
    expect(deviceKey(null, devices)).toBe('blue');
    expect(deviceKey('default', devices)).toBe('blue');
    expect(deviceKey('communications', devices)).toBe('jabra');
    expect(deviceKey('cam', devices)).toBe('cam');
    // the page's own microphone on the default (the blue one), another on the webcam: the jabra is left
    const forNew = freeDevices(devices, [null, 'cam']);
    expect(forNew.free.map(d => d.deviceId)).toEqual(['jabra']);
    expect(forNew.defaultFree).toBe(false);
    // the webcam's own row still offers the webcam
    expect(freeDevices(devices, [null], 'cam').free.map(d => d.deviceId)).toEqual(['jabra', 'cam']);
    // Firefox: no alias entries, the default is the first input
    const ff = [{ deviceId: 'a', groupId: 'x', label: 'A' }, { deviceId: 'b', groupId: 'y', label: 'B' }];
    expect(freeDevices(ff, [null]).free.map(d => d.deviceId)).toEqual(['b']);
    expect(newExtraMic([], { device: 'b' }).deviceId).toBe('b');
  });

  test('names: empty, or taken by someone in the party or another slot', () => {
    const list = [{ id: 'a', name: 'Mic 2' }, { id: 'b', name: 'Mic 3' }];
    expect(nameProblem('  ', 'a', list)).toBe('empty');
    expect(nameProblem('bob', 'a', list, ['Bob'])).toBe('taken');
    expect(nameProblem('Mic 3', 'a', list)).toBe('taken');
    expect(nameProblem('Mic 2', 'a', list)).toBeNull(); // its own name
  });
});

describe('an extra microphone as a singer', () => {
  const setup = ({ playing = true, fail = null } = {}) => {
    const sock = { sent: [], sendObj(o) { this.sent.push(o); }, send(d) { this.sent.push(typeof d === 'string' ? JSON.parse(d) : { binary: d }); } };
    const keep = vi.fn(({ onOpen }) => { onOpen(sock, { reconnect: false }); return { close: vi.fn() }; });
    let onProcessing = null;
    const mic = { stats: {}, setOnAudio() {}, setOnProcessing(fn) { onProcessing = fn; }, setActive: vi.fn(), stopMicInput: vi.fn() };
    const initMic = vi.fn(async () => { if (fail) throw fail; return mic; });
    const states = [];
    const singer = createExtraSinger({
      slot: { name: 'Mic 2', deviceId: 'dev2', color: 200, guestId: 'mic-x' }, partyId: 'ABCD',
      songTime: () => 12.5, isSongPlaying: () => playing, onState: st => states.push(st), initMic, keep,
    });
    return { singer, sock, keep, mic, initMic, states, pitch: (data) => onProcessing({ data }) };
  };

  test('joins as its own extra seat and sends its notes at the song time, less its delay', async () => {
    const { singer, sock, initMic, mic, states, pitch } = setup();
    expect(sock.sent[0]).toEqual({ type: 'party:join', data: expect.objectContaining({ partyId: 'ABCD', username: 'Mic 2', color: 200, guestId: 'mic-x', extra: true }) });
    await singer.openMic();
    expect(initMic).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'dev2' }));
    expect(mic.setActive).toHaveBeenCalledWith(true);
    expect(states.at(-1)).toMatchObject({ phase: 'on', error: null });
    pitch({ freq: 220, fric: 0, pos: 3 });
    const note = sock.sent.at(-1).binary;
    const view = new DataView(note.buffer ?? note);
    expect(view.getFloat32(1, true)).toBeCloseTo(220);
    expect(view.getFloat32(5, true)).toBeCloseTo(12.4); // 12.5 - 0.1
    singer.close();
    expect(mic.stopMicInput).toHaveBeenCalled();
    expect(sock.sent.at(-1)).toEqual({ type: 'party:leave', data: {} });
  });

  test('nothing is sent while the song is paused; a refused name and a failed microphone are reported', async () => {
    const paused = setup({ playing: false });
    await paused.singer.openMic();
    const before = paused.sock.sent.length;
    paused.pitch({ freq: 220, fric: 0, pos: 3 });
    expect(paused.sock.sent.length).toBe(before);
    paused.sock.onmessage({ data: JSON.stringify({ type: 'error', data: { code: 'name_taken' } }) });
    expect(paused.states.at(-1).error).toBe('taken');
    paused.sock.onmessage({ data: JSON.stringify({ type: 'error', data: { code: 'joining_closed' } }) });
    expect(paused.states.at(-1).error).toBe('closed');
    paused.sock.onmessage({ data: JSON.stringify({ type: 'ping:request', data: { serverTs: 5 } }) });
    expect(paused.sock.sent.at(-1)).toEqual({ type: 'ping:reply', data: { serverTs: 5 } });

    const broken = setup({ fail: Object.assign(new Error('no'), { name: 'NotAllowedError' }) });
    await broken.singer.openMic();
    expect(broken.states.at(-1)).toMatchObject({ phase: 'off', error: 'denied' });
  });

  test('talking near it, not singing along the chart, goes out without its pitch (singingGate.js)', async () => {
    // lines of four half-second notes, two seconds of rest between them
    const rows = ['#BPM:150', '#GAP:0'];
    for (let l = 0; l < 12; l++) { for (let i = 0; i < 4; i++) rows.push(`: ${l * 40 + i * 5} 4 ${10 + i} la `); rows.push(`- ${l * 40 + 20}`); }
    const ld = await readTextFile([...rows, 'E'].join('\n'));
    let now = 0;
    const sock = { sent: [], sendObj() {}, send(d) { this.sent.push(d); } };
    let onProcessing = null;
    const mic = { stats: {}, setOnAudio() {}, setOnProcessing(fn) { onProcessing = fn; }, setActive() {}, stopMicInput() {} };
    const singer = createExtraSinger({
      slot: { name: 'Mic 2', deviceId: 'd', color: 1, guestId: 'g' }, partyId: 'ABCD', songTime: () => now, chart: () => ld,
      isSongPlaying: () => true, initMic: async () => mic, keep: ({ onOpen }) => { onOpen(sock, {}); return { close() {} }; },
    });
    await singer.openMic();
    // syllables of 0.2 s every 0.3 s, gliding down, whatever the song does
    for (now = 0; now < 40; now += 0.03) {
      const phase = (now % 0.3) / 0.2;
      const hz = phase < 1 ? 190 * 2 ** (-3 * phase / 12) : 0;
      onProcessing({ data: { freq: hz, fric: 0, pos: now, hzFirst: hz && hz * 2 ** (0.6 / 12), hzLast: hz } });
    }
    const sent = sock.sent.filter(d => typeof d !== 'string').map(d => new DataView(d.buffer ?? d));
    const late = sent.filter(v => v.getFloat32(5, true) > 10);
    expect(late.length).toBeGreaterThan(500);
    expect(late.every(v => v.getFloat32(1, true) === 0)).toBe(true);
    singer.close();
  });
});
