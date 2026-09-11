import { useSyncExternalStore } from 'react';

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
const EMPTY_FRAME = { tickData: {}, p2TickData: null };

export function createLiveStore() {
  const listeners = new Set();
  const store = {
    frame: EMPTY_FRAME,
    notes: {},
    setFrame(tickData, p2TickData = null) {
      store.frame = { tickData, p2TickData };
      for (const l of listeners) l();
    },
    resetNotes() { store.notes = {}; },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getFrame: () => store.frame,
  };
  return store;
}

/** Re-renders the caller on every frame. For Lyrics and MusicBars only. */
export function useLiveFrame(store) {
  return useSyncExternalStore(store.subscribe, store.getFrame, store.getFrame);
}

/** Re-renders the caller only when `select(frame)` returns a different value. */
export function useLiveValue(store, select) {
  const get = () => select(store.frame);
  return useSyncExternalStore(store.subscribe, get, get);
}
