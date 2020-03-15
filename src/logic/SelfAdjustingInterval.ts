export const setSelfAdjustingInterval = (cb: (arg0: number) => void, ms: number) => {
  let expected = Date.now() + ms;
  let stop = false;

  const step = () => {
    if (stop) {
      return;
    }

    const delta = Date.now() - expected;
    const ticks = Math.max(1, 1 + Math.round(delta / ms));
    cb(ticks);
    const addToExpected = ms * ticks;
    expected += addToExpected;

    setTimeout(step, addToExpected - delta);
  };

  setTimeout(step, ms);

  return () => {
    stop = true;
  };
};

export default setSelfAdjustingInterval;