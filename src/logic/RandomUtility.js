import Rng from "seedrandom";

export const getRandInt = (min, max, seed) => {
  let randomDecimal = seed ? Rng(seed)() : Math.random();
  return Math.floor(randomDecimal * (max - min + 1)) + min;
};

export const urlEscapedTitle = (artist, title) => `${artist.replace(/[\W]+/g, "_")}--${title.replace(/[\W ]+/g, "_")}`;
