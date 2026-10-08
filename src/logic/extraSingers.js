/**
 * More microphones on one device (the microphone panel's advanced part).
 *
 * Every extra microphone is a singer of its own in the party: its own input
 * device, pitch detector and delay measurement, and its own connection, joined
 * under its own name with its own guest id. The server
 * scores it like anyone else's phone, and the page's account never gets its
 * points (`extra` on the join).
 *
 * One input cannot be split into voices afterwards (two people singing the same
 * melody into one microphone stay one singer; measured 2026-10-08): separate
 * microphones are what makes separate scores.
 */
import { initMicInput, micErrorKind } from './MicrophoneInput';
import { createBleedController, FALLBACK_DELAY } from './bleedController';
import { keepWebSocket, sendPartyJoin, sendPartyLeave, sendPingReply, sendPlayerNote } from './WebsocketHandling';
import { randomId } from './sessionId';

export const MAX_EXTRA_MICS = 3;
export const NAME_MAX = 24;
const STORE_KEY = 'singpro_extra_mics';

/** the slots as stored: [{ id, name, deviceId, color, guestId }] (bad entries dropped) */
export function loadExtraMics(storage = globalThis.localStorage) {
  try {
    const list = JSON.parse(storage?.getItem(STORE_KEY) || '[]');
    if (!Array.isArray(list)) return [];
    return list.filter(s => s && typeof s.id === 'string' && typeof s.name === 'string').slice(0, MAX_EXTRA_MICS)
      .map(s => ({
        id: s.id,
        name: s.name.slice(0, NAME_MAX),
        deviceId: typeof s.deviceId === 'string' && s.deviceId ? s.deviceId : null,
        color: typeof s.color === 'number' ? s.color : null,
        guestId: typeof s.guestId === 'string' && s.guestId ? s.guestId : `mic-${randomId()}`,
      }));
  } catch {
    return [];
  }
}

export function saveExtraMics(list, storage = globalThis.localStorage) {
  try { storage?.setItem(STORE_KEY, JSON.stringify(list)); } catch { /* private mode: for this page only */ }
}

/**
 * A new slot: the first free "Mic N" name (`label(n)` makes it, n from 2: the
 * page's own microphone is the first), the first colour nobody here wears.
 */
export function newExtraMic(list, { label = n => `Mic ${n}`, taken = [], palette = [], usedColors = [] } = {}) {
  const names = new Set([...taken, ...list.map(s => s.name)].map(n => n.trim().toLowerCase()));
  let n = 2;
  while (names.has(label(n).toLowerCase())) n++;
  const colors = new Set([...usedColors, ...list.map(s => s.color)]);
  return {
    id: randomId(),
    name: label(n),
    deviceId: null,
    color: palette.find(c => !colors.has(c)) ?? palette[0] ?? null,
    guestId: `mic-${randomId()}`,
  };
}

/** Why a slot's name cannot be used: 'empty', 'taken' (another singer here, or another slot), else null */
export function nameProblem(name, slotId, list, taken = []) {
  const n = (name ?? '').trim().toLowerCase();
  if (!n) return 'empty';
  if (taken.some(t => t.trim().toLowerCase() === n)) return 'taken';
  if (list.some(s => s.id !== slotId && s.name.trim().toLowerCase() === n)) return 'taken';
  return null;
}

/**
 * The music this microphone hears from the speakers, for measuring its delay
 * (bleedController.js): the song's instrumental, once the page has its stems.
 * `current` is the song the controller measures now; returns the new one.
 */
export function syncBleedSong(bleed, current, songId, stems) {
  if (!bleed || !songId || songId === 'none') return current;
  if (current !== songId) bleed.startSong();
  if (stems?.loaded && stems.songId === songId && bleed.state().reference === 'none') {
    if (stems.buffers) bleed.setReference(stems.buffers.karaoke);
    else bleed.setReferenceUrl(stems.urls?.karaoke);
  }
  return songId;
}

/**
 * One extra microphone as a singer. The connection opens at once and stays (the
 * seat and its score live with it); the microphone opens and closes with the
 * page's own (openMic / closeMic: the page's standby decides when).
 *   slot         { name, deviceId, color, guestId }
 *   songTime()   the song time the page scores at (the host's clock)
 *   isSongPlaying()
 *   onState(s)   { phase: 'off' | 'starting' | 'on', error: null | 'taken' | mic error kind, stats }
 * initMic / keep: for tests.
 */
export function createExtraSinger({ slot, partyId, songTime, isSongPlaying, onState = () => {}, gpu = false,
  initMic = initMicInput, keep = keepWebSocket }) {
  let ws = null;
  let mic = null;
  let bleed = null;
  let bleedSong = null;
  let opening = null;
  let closed = false;
  let state = { phase: 'off', error: null, stats: null };
  const set = (patch) => { state = { ...state, ...patch }; onState(state); };

  const socket = keep({
    onOpen: (sock) => {
      ws = sock;
      sock.onmessage = (e) => {
        if (typeof e.data !== 'string') return; // everyone's notes: the page's own socket draws them
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'ping:request') sendPingReply(sock, { serverTs: m.data?.serverTs });
        else if (m.type === 'error' && m.data?.code === 'name_taken') set({ error: 'taken' });
      };
      sendPartyJoin(sock, { partyId, username: slot.name, isShowingVideo: false, color: slot.color, guestId: slot.guestId, extra: true });
    },
    onDown: () => { ws = null; },
  });

  const onPitch = (msg) => {
    const { freq, fric, pos, error } = msg.data;
    if (error || !isSongPlaying()) return;
    const t = songTime();
    // the speakers reach this microphone late too: its own measured delay
    if (bleed && pos !== undefined) bleed.pushStamp(pos, t);
    const delay = bleed ? bleed.nextDelay() : FALLBACK_DELAY;
    if (ws) sendPlayerNote(ws, { freq, videoTime: t - delay, fric });
  };

  return {
    get state() { return state; },
    /** opens the microphone (does nothing while open or opening) */
    openMic() {
      if (closed || mic || opening) return opening;
      set({ phase: 'starting', error: state.error === 'taken' ? 'taken' : null });
      opening = initMic({ deviceId: slot.deviceId || undefined, gpu })
        .then((m) => {
          opening = null;
          if (closed) { m.stopMicInput(); return; }
          mic = m;
          bleed = createBleedController();
          bleedSong = null;
          m.setOnAudio((samples, pos) => bleed?.pushAudio(samples, pos));
          m.setOnProcessing(onPitch);
          m.setActive(isSongPlaying());
          set({ phase: 'on', stats: m.stats });
        })
        .catch((e) => {
          opening = null;
          set({ phase: 'off', error: micErrorKind(e), stats: null });
        });
      return opening;
    },
    closeMic() {
      mic?.stopMicInput();
      mic = null;
      bleed?.dispose();
      bleed = null;
      if (state.phase !== 'off') set({ phase: 'off', stats: null });
    },
    /** song playing or paused: the pipeline runs or idles, like the page's own */
    setActive(on) { mic?.setActive(on); },
    /** the song the page plays and its stems: the delay is measured against them */
    syncSong(songId, stems) { bleedSong = syncBleedSong(bleed, bleedSong, songId, stems); },
    /** for good (slot removed, page left): the seat goes with it */
    close() {
      closed = true;
      this.closeMic();
      if (ws) { try { sendPartyLeave(ws); } catch { /* */ } }
      socket.close();
    },
  };
}
