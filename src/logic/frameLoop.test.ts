import { describe, it, expect } from 'vitest';
import { frameLoop } from './frameLoop';

// A window whose frames and timers run only when the test says so; a hidden
// page gets no frames, like a browser's background tab
function fakeWindow() {
  let next = 1;
  const frames = new Map<number, () => void>();
  const timers = new Map<number, () => void>();
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: 'visible',
    addEventListener: (type: string, fn: () => void) => { if (type === 'visibilitychange') listeners.add(fn); },
    removeEventListener: (type: string, fn: () => void) => { if (type === 'visibilitychange') listeners.delete(fn); },
  };
  return {
    document: doc,
    requestAnimationFrame: (fn: () => void) => { const id = next++; frames.set(id, fn); return id; },
    cancelAnimationFrame: (id: number) => { frames.delete(id); },
    setTimeout: (fn: () => void) => { const id = next++; timers.set(id, fn); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
    frame() { if (doc.visibilityState === 'hidden') return; const due = [...frames.values()]; frames.clear(); due.forEach(fn => fn()); },
    timer() { const due = [...timers.values()]; timers.clear(); due.forEach(fn => fn()); },
    setHidden(hidden: boolean) { doc.visibilityState = hidden ? 'hidden' : 'visible'; listeners.forEach(fn => fn()); },
    pending: () => ({ frames: frames.size, timers: timers.size, listeners: listeners.size }),
  };
}

describe('frameLoop', () => {
  it('steps once per animation frame in a visible tab', () => {
    const win = fakeWindow();
    let steps = 0;
    frameLoop(() => { steps += 1; }, { win });
    win.frame(); win.frame(); win.frame();
    win.timer();
    expect(steps).toBe(3);
  });

  it('keeps stepping on a timer while the tab is hidden', () => {
    const win = fakeWindow();
    let steps = 0;
    frameLoop(() => { steps += 1; }, { win });
    win.frame();
    win.setHidden(true);
    win.frame(); // no frames for a hidden tab
    win.timer(); win.timer(); win.timer();
    expect(steps).toBe(4);
    expect(win.pending()).toMatchObject({ frames: 0, timers: 1 });
  });

  it('goes back to frames, and one at a time, once the tab is shown again', () => {
    const win = fakeWindow();
    let steps = 0;
    frameLoop(() => { steps += 1; }, { win });
    win.setHidden(true);
    win.timer();
    win.setHidden(false);
    expect(win.pending()).toMatchObject({ frames: 1, timers: 0 });
    win.timer(); // nothing left on the timer
    win.frame(); win.frame();
    expect(steps).toBe(3);
    win.setHidden(true); win.setHidden(false); win.setHidden(false);
    expect(win.pending()).toMatchObject({ frames: 1, timers: 0 });
  });

  it('ends when the step says so, or when stopped', () => {
    const win = fakeWindow();
    let steps = 0;
    frameLoop(() => { steps += 1; return steps < 2; }, { win });
    win.frame(); win.frame(); win.frame();
    expect(steps).toBe(2);
    expect(win.pending()).toEqual({ frames: 0, timers: 0, listeners: 0 });

    const stop = frameLoop(() => { steps += 1; }, { win });
    win.setHidden(true);
    stop();
    win.timer(); win.setHidden(false); win.frame();
    expect(steps).toBe(2);
    expect(win.pending()).toEqual({ frames: 0, timers: 0, listeners: 0 });
  });
});
