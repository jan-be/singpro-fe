import Rng from "seedrandom";

export const getRandInt = (min, max, seed) => {
  let randomDecimal = seed ? Rng(seed)() : Math.random();
  return Math.floor(randomDecimal * (max - min + 1)) + min;
};
