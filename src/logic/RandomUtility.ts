import Rng from "seedrandom";

export const getRandInt = (min: number, max: number, seed?: string | null): number => {
  let randomDecimal = seed ? Rng(seed)() : Math.random();
  return Math.floor(randomDecimal * (max - min + 1)) + min;
};

export const urlEscapedTitle = (artist: string | null | undefined, title: string | null | undefined): string => `${(artist || '').replace(/[\W]+/g, "_")}--${(title || '').replace(/[\W ]+/g, "_")}`;

/**
 * Fisher-Yates shuffle. Returns a new array — does not mutate input.
 * Used to randomise recommended/similar song lists so users don't always
 * see (and auto-queue) the same top match when revisiting.
 */
export const shuffle = <T>(arr: readonly T[] | null | undefined): T[] => {
  const out = [...(arr ?? [])];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
