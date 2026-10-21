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
import { createSingingGate } from './singingGate';
import { keepWebSocket, sendPartyJoin, sendPartyLeave, sendPingReply, sendPlayerNote } from './WebsocketHandling';
import { randomId } from './sessionId';
import type { MicErrorKind, MicInput, MicStats, ProcessedPitch } from './MicrophoneInput';
import type { BleedController } from './bleedController';
import type { GateLyrics } from './singingGate';
import type { KeepWebSocketOptions, KeptWebSocket, PartySocket } from './WebsocketHandling';

export const NAME_MAX = 24;
const STORE_KEY = 'singspree_extra_mics';

/** One extra microphone of this device, as stored */
export interface ExtraMicSlot {
  id: string;
  name: string;
  /** null: the default microphone */
  deviceId: string | null;
  color: number | null;
  /** the guest id it scores under */
  guestId: string;
}

/** What deviceKey and freeDevices read of an input (enumerateDevices) */
export type InputDevice = Pick<MediaDeviceInfo, 'deviceId' | 'groupId' | 'label'>;

/** Why a slot's name cannot be used (nameProblem) */
export type NameProblem = 'empty' | 'taken';

/** The page's stems as syncBleedSong reads them */
export interface BleedStems {
  loaded?: boolean;
  songId?: string | null;
  buffers?: { karaoke?: AudioBuffer | null } | null;
  urls?: { karaoke?: string | null } | null;
}

/** The part of a running microphone (initMicInput) an extra singer uses */
export type ExtraMic = Pick<MicInput, 'stats' | 'setOnAudio' | 'setOnProcessing' | 'setActive' | 'stopMicInput'>;

/** An extra singer's state for the mic panel */
export interface ExtraSingerState {
  phase: 'off' | 'starting' | 'on';
  /** 'taken': the name is someone else's; 'closed': the party takes nobody new; else why the microphone failed */
  error: null | 'taken' | 'closed' | MicErrorKind;
  stats: MicStats | null;
}

/** An extra microphone as a singer (createExtraSinger) */
export interface ExtraSinger {
  readonly state: ExtraSingerState;
  /** opens the microphone (does nothing while open or opening) */
  openMic(): Promise<void> | null;
  closeMic(): void;
  /** song playing or paused: the pipeline runs or idles, like the page's own */
  setActive(on: boolean): void;
  /** the song the page plays and its stems: the delay is measured against them */
  syncSong(songId: string | null | undefined, stems: BleedStems | null | undefined): void;
  /** for good (slot removed, page left): the seat goes with it */
  close(): void;
}

/** the slots as stored: [{ id, name, deviceId, color, guestId }] (bad entries dropped) */
export function loadExtraMics(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): ExtraMicSlot[] {
  try {
    const list: unknown = JSON.parse(storage?.getItem(STORE_KEY) || '[]');
    if (!Array.isArray(list)) return [];
    return list.filter(s => s && typeof s.id === 'string' && typeof s.name === 'string')
      .map((s): ExtraMicSlot => ({
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

export function saveExtraMics(list: readonly ExtraMicSlot[], storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try { storage?.setItem(STORE_KEY, JSON.stringify(list)); } catch { /* private mode: for this page only */ }
}

// Chrome lists the default and the communications microphone a second time under these ids
const ALIASES = new Set(['default', 'communications']);

/**
 * The microphone a choice means: a real device's id for Chrome's "Default"
 * alias (null or 'default': the device it stands for, same group and label;
 * else the first input, as in Firefox), the id itself otherwise.
 *   devices: enumerateDevices() inputs
 */
export function deviceKey(deviceId: string | null | undefined, devices: readonly InputDevice[]): string {
  const id = deviceId || 'default';
  if (!ALIASES.has(id)) return id;
  const alias = devices.find(d => d.deviceId === id);
  const real = devices.filter(d => !ALIASES.has(d.deviceId));
  const meant = alias && real.find(d => d.groupId === alias.groupId && d.label && alias.label.endsWith(d.label));
  return (meant ?? real[0])?.deviceId ?? id;
}

/**
 * What one microphone may still choose: the real devices nobody else on this
 * page uses (`used`: the other choices, ids or null for the default), its own
 * choice included (`own`: its id, null for the default, undefined for a new
 * one); and whether "Default microphone" is still free.
 */
export function freeDevices<D extends InputDevice>(devices: readonly D[], used: readonly (string | null)[], own?: string | null): { free: D[], defaultFree: boolean } {
  const taken = new Set(used.map(id => deviceKey(id, devices)));
  const ownKey = own === undefined ? null : deviceKey(own, devices);
  const free = devices.filter(d => !ALIASES.has(d.deviceId) && (!taken.has(d.deviceId) || d.deviceId === ownKey));
  const defaultKey = deviceKey(null, devices);
  return { free, defaultFree: !taken.has(defaultKey) || defaultKey === ownKey };
}

/**
 * A new slot: the first free "Mic N" name (`label(n)` makes it, n from 2: the
 * page's own microphone is the first), the first colour nobody here wears, the
 * first microphone nobody here uses (`device`).
 */
export function newExtraMic(list: readonly Pick<ExtraMicSlot, 'name' | 'color'>[], { label = n => `Mic ${n}`, taken = [], palette = [], usedColors = [], device = null }: {
  label?: (n: number) => string, taken?: readonly string[], palette?: readonly number[], usedColors?: readonly (number | null)[], device?: string | null,
} = {}): ExtraMicSlot {
  const names = new Set([...taken, ...list.map(s => s.name)].map(n => n.trim().toLowerCase()));
  let n = 2;
  while (names.has(label(n).toLowerCase())) n++;
  const colors = new Set([...usedColors, ...list.map(s => s.color)]);
  return {
    id: randomId(),
    name: label(n),
    deviceId: device,
    color: palette.find(c => !colors.has(c)) ?? palette[0] ?? null,
    guestId: `mic-${randomId()}`,
  };
}

/** Why a slot's name cannot be used: 'empty', 'taken' (another singer here, or another slot), else null */
export function nameProblem(name: string | null | undefined, slotId: string | null | undefined, list: readonly Pick<ExtraMicSlot, 'id' | 'name'>[], taken: readonly string[] = []): NameProblem | null {
  const n = (name ?? '').trim().toLowerCase();
  if (!n) return 'empty';
  if (taken.some(t => t.trim().toLowerCase() === n)) return 'taken';
  if (list.some(s => s.id !== slotId && s.name.trim().toLowerCase() === n)) return 'taken';
  return null;
}

/**
 * The music this microphone hears from the speakers, for measuring its delay
 * (bleedController.ts): the song's instrumental, once the page has its stems.
 * `current` is the song the controller measures now; returns the new one.
 */
export function syncBleedSong(bleed: BleedController | null | undefined, current: string | null, songId: string | null | undefined, stems: BleedStems | null | undefined): string | null {
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
 *   chart()      the chart sung (lyricData), for telling singing from talking (singingGate.ts)
 *   isSongPlaying()
 *   held()       the song time is not the party's yet (the host's page on its way to its spot): no notes
 *   onState(s)   { phase: 'off' | 'starting' | 'on', error: null | 'taken' | 'closed' | mic error kind, stats }
 * initMic / keep: for tests.
 */
export function createExtraSinger({ slot, partyId, songTime, chart = () => null, isSongPlaying, held = () => false, onState = () => {}, gpu = false,
  initMic = initMicInput, keep = keepWebSocket }: {
  slot: Pick<ExtraMicSlot, 'name' | 'deviceId' | 'color' | 'guestId'>,
  partyId: string,
  songTime: () => number,
  chart?: () => GateLyrics | null | undefined,
  isSongPlaying: () => boolean,
  held?: () => boolean,
  onState?: (state: ExtraSingerState) => void,
  gpu?: boolean,
  initMic?: (options: { deviceId?: string, gpu?: boolean }) => Promise<ExtraMic>,
  keep?: (options: KeepWebSocketOptions) => KeptWebSocket,
}): ExtraSinger {
  let ws: PartySocket | null = null;
  let mic: ExtraMic | null = null;
  let bleed: BleedController | null = null;
  let bleedSong: string | null = null;
  let opening: Promise<void> | null = null;
  let closed = false;
  let state: ExtraSingerState = { phase: 'off', error: null, stats: null };
  const set = (patch: Partial<ExtraSingerState>) => { state = { ...state, ...patch }; onState(state); };
  // talk near this microphone goes on without its pitch, like the page's own
  const gate = createSingingGate();

  const socket = keep({
    onOpen: (sock) => {
      ws = sock;
      sock.onmessage = (e) => {
        if (typeof e.data !== 'string') return; // everyone's notes: the page's own socket draws them
        let m: { type?: string, data?: { serverTs?: number, code?: string } };
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'ping:request') sendPingReply(sock, { serverTs: m.data?.serverTs as number });
        else if (m.type === 'error' && m.data?.code === 'name_taken') set({ error: 'taken' });
        // the party takes no new people and the server could not tell this page is in it (a page from before this one)
        else if (m.type === 'error' && m.data?.code === 'joining_closed') set({ error: 'closed' });
      };
      sendPartyJoin(sock, { partyId, username: slot.name, isShowingVideo: false, color: slot.color, guestId: slot.guestId, extra: true });
    },
    onDown: () => { ws = null; },
  });

  const onPitch = (msg: { data: ProcessedPitch & { error?: unknown } }) => {
    const { freq, fric, pos, error } = msg.data;
    if (error || !isSongPlaying() || held()) return;
    const t = songTime();
    // the speakers reach this microphone late too: its own measured delay
    if (bleed && pos !== undefined) bleed.pushStamp(pos, t);
    const delay = bleed ? bleed.nextDelay() : FALLBACK_DELAY;
    for (const n of gate.push(chart(), { t: t - delay, freq, fric, hzFirst: msg.data.hzFirst, hzLast: msg.data.hzLast })) {
      if (ws) sendPlayerNote(ws, { freq: n.freq, videoTime: n.t, fric: n.fric });
    }
  };

  return {
    get state() { return state; },
    /** opens the microphone (does nothing while open or opening) */
    openMic() {
      if (closed || mic || opening) return opening;
      set({ phase: 'starting', error: state.error === 'taken' || state.error === 'closed' ? state.error : null });
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
        .catch((e: unknown) => {
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
    setActive(on: boolean) { mic?.setActive(on); },
    /** the song the page plays and its stems: the delay is measured against them */
    syncSong(songId: string | null | undefined, stems: BleedStems | null | undefined) { bleedSong = syncBleedSong(bleed, bleedSong, songId, stems); },
    /** for good (slot removed, page left): the seat goes with it */
    close() {
      closed = true;
      this.closeMic();
      if (ws) { try { sendPartyLeave(ws); } catch { /* */ } }
      socket.close();
    },
  };
}
