import { useSyncExternalStore } from 'react';

/**
 * One value that a component deep in the tree follows by itself, so the page
 * that receives it does not re-render all of its children to pass it down.
 * The same idea as liveStore.ts, for a value that changes now and then.
 */
/** A value with listeners (createValueStore) */
export interface ValueStore<T> {
  get(): T;
  set(next: T): void;
  /** returns the unsubscribe */
  subscribe(listener: () => void): () => void;
}

export function createValueStore<T>(initial: T): ValueStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
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
export function useStoreValue<T>(store: ValueStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
