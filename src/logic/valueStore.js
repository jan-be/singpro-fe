import { useSyncExternalStore } from 'react';

/**
 * One value that a component deep in the tree follows by itself, so the page
 * that receives it does not re-render all of its children to pass it down.
 * The same idea as liveStore.js, for a value that changes now and then.
 */
export function createValueStore(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Re-renders the caller whenever the store's value changes. */
export function useStoreValue(store) {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
