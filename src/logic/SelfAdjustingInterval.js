/**
 * Self-adjusting interval to account for drifting
 *
 * @param {function} workFunc  Callback containing the work to be done
 *                             for each interval
 * @param {int}      interval  Interval speed (in milliseconds) - This
 * @param {function} errorFunc (Optional) Callback to run if the drift
 *                             exceeds interval
 */
function SelfAdjustingInterval(workFunc, interval, errorFunc) {
  let that = this;
  let expected, timeout;
  this.interval = interval;

  this.start = function () {
    expected = Date.now() + this.interval;
    timeout = setTimeout(step, this.interval);
  };

  this.stop = function () {
    clearTimeout(timeout);
  };

  function step() {
    let drift = Date.now() - expected;
    if (drift > that.interval) {
      // You could have some default stuff here too...
      if (errorFunc) errorFunc();
    }
    workFunc();
    expected += that.interval;
    timeout = setTimeout(step, Math.max(0, that.interval - drift));
  }
}

export default SelfAdjustingInterval;