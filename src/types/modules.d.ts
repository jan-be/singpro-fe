// Packages without types that the logic modules import (ambient: this file is no module)

/** seedrandom (RandomUtility.ts); @types/seedrandom would replace this */
declare module 'seedrandom' {
  /** A generator seeded with `seed`: each call the next number in [0, 1) */
  export default function seedrandom(seed?: string): () => number;
}

/**
 * timesync's client (SyncedTime.ts). The package is not installed: nothing imports SyncedTime, which would not build;
 * its own typings (or @types/timesync) would replace this.
 */
declare module 'timesync/lib/timesync' {
  export interface TimeSync {
    /** the server's time now, ms */
    now(): number;
    sync(): void;
    destroy(): void;
    on(event: 'change' | 'sync' | 'error', callback: (value: unknown) => void): void;
  }
  export function create(options: { server: string; delay?: number; interval?: number | null; timeout?: number; repeat?: number }): TimeSync;
}
