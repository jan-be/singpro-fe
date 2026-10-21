import { useSyncExternalStore } from 'react';
import type { TickData } from './LyricsParser';
import type { getAndSetHitNotesByPlayer } from './MicInputToTick';
import type { AvatarPaths } from './avatar';

/** Where the song is in a frame (LyricsParser's getTickData). */
export type LiveTickData = TickData;
/** The second part's, in a duet (getP2TickData); null otherwise. */
export type LiveP2TickData = TickData | null;
/** Every player's recent notes: username -> their notes (MicInputToTick). */
export type LiveNotes = ReturnType<typeof getAndSetHitNotesByPlayer>;

/** One frame of the singing view. */
export interface LiveFrame {
  /** {} before the first frame of a song */
  tickData: Partial<LiveTickData>;
  p2TickData: LiveP2TickData;
  idle: boolean;
}

/** Past the lane count: whom the server puts on the big screen (party:lanes). */
export interface LiveLanes {
  pinned: string[];
  spotlight: string[];
}

/** Your own rank in a crowd that does not fit on screen (player:standing). */
export interface LiveStanding {
  rank: number;
  total: number;
  score: number;
}

/**
 * Per-frame state of the singing view: the current lyric line + cursor tick
 * (`frame`) and every player's recent notes (`notes`).
 *
 * It lives outside React state on purpose. The animation loop updates it at
 * display rate, and only the components that draw it (Lyrics, MusicBars)
 * subscribe, so the rest of the party page — queue, scoreboard, player bar —
 * is not reconciled 60 times a second. Notes are mutated in place by the
 * pitch pipeline and read by MusicBars on its next frame; they never trigger
 * a render by themselves.
 */
const EMPTY_FRAME: LiveFrame = { tickData: {}, p2TickData: null, idle: false };

/** The live store (createLiveStore): the party page writes it, Lyrics and MusicBars read it per frame. */
export interface LiveStore {
  frame: LiveFrame;
  notes: LiveNotes;
  scores: Record<string, number>;
  lanes: LiveLanes | null;
  standing: LiveStanding | null;
  avatars: AvatarPaths;
  setFrame(tickData: LiveTickData, p2TickData?: LiveP2TickData, idle?: boolean): void;
  resetNotes(): void;
  resetScores(): void;
  resetLanes(): void;
  subscribe(listener: () => void): () => void;
  getFrame: () => LiveFrame;
}

export function createLiveStore(): LiveStore {
  const listeners = new Set<() => void>();
  const store: LiveStore = {
    frame: EMPTY_FRAME,
    notes: {},
    // Each singer's score as it rode along with their latest note (username ->
    // score). Newer than the JSON scoreboard in React state, which only comes
    // on join, leave and song events; MusicBars reads both per frame.
    scores: {},
    // Past the lane count the server picks who the big screen shows
    // (party:lanes): { pinned: [username], spotlight: [username] }, else null.
    // standing is your own rank in that crowd: { rank, total, score }.
    lanes: null,
    standing: null,
    // Profile pictures (username -> API path, null for none: logic/avatar.js),
    // set by the party page as players come and change them. The highway draws
    // them from here with avatarSprite.js (avatarSrc(path) -> getAvatarSprite).
    avatars: {},
    // idle: the same moment again (the video stands still), sent now and then
    // so what changed meanwhile shows; painters need not count it as a frame
    setFrame(tickData, p2TickData = null, idle = false) {
      store.frame = { tickData, p2TickData, idle };
      for (const l of listeners) l();
    },
    resetNotes() { store.notes = {}; },
    resetScores() { store.scores = {}; },
    resetLanes() { store.lanes = null; store.standing = null; },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getFrame: () => store.frame,
  };
  return store;
}

/** Re-renders the caller on every frame. For Lyrics and MusicBars only. */
export function useLiveFrame(store: LiveStore): LiveFrame {
  return useSyncExternalStore(store.subscribe, store.getFrame, store.getFrame);
}

/** Re-renders the caller only when `select(frame)` returns a different value. */
export function useLiveValue<T>(store: LiveStore, select: (frame: LiveFrame) => T): T {
  const get = () => select(store.frame);
  return useSyncExternalStore(store.subscribe, get, get);
}
