// Packages without types that the logic modules import (ambient: this file is no module)

/** seedrandom (RandomUtility.ts); @types/seedrandom would replace this */
declare module 'seedrandom' {
  /** A generator seeded with `seed`: each call the next number in [0, 1) */
  export default function seedrandom(seed?: string): () => number;
}
