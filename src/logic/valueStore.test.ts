import { describe, it, expect, vi } from 'vitest';
import { createValueStore } from './valueStore';

describe('createValueStore', () => {
  it('tells its listeners about a new value, and only about a new one', () => {
    const store = createValueStore(undefined);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.set(12.5);
    expect(store.get()).toBe(12.5);
    store.set(12.5);
    expect(listener).toHaveBeenCalledTimes(1);
    store.set(undefined);
    expect(store.get()).toBe(undefined);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    store.set(3);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.get()).toBe(3);
  });
});
