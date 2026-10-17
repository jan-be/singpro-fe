import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// The guard listens on the window for the start of every press: a bare
// EventTarget stands in for it (the tests run without a DOM)
let guard;
beforeAll(async () => {
  globalThis.window = new EventTarget();
  guard = await import('./popoverGuard.js');
});
afterAll(() => { delete globalThis.window; });

const press = (type = 'pointerdown') => window.dispatchEvent(new Event(type));

describe('stageClickAction', () => {
  it('pauses / resumes after the double-click wait on a plain click', () => {
    expect(guard.stageClickAction({})).toBe('toggle');
  });

  it('waits without pausing when the press answered the prompt for a tap', () => {
    expect(guard.stageClickAction({ promptAnswered: true })).toBe('wait');
  });

  it('still goes fullscreen on the second click after a prompt-answering one', () => {
    expect(guard.stageClickAction({ secondClick: true })).toBe('fullscreen');
    expect(guard.stageClickAction({ promptAnswered: true, secondClick: true })).toBe('fullscreen');
  });

  it('does nothing for a click that only closed a popover', () => {
    expect(guard.stageClickAction({ popoverClosed: true })).toBe('none');
    expect(guard.stageClickAction({ popoverClosed: true, secondClick: true })).toBe('none');
  });
});

describe('per press', () => {
  it('remembers that the press answered the prompt until the next press', () => {
    press('pointerdown');
    guard.markPromptAnswered(); // the prompt's capture handler on the document
    expect(guard.promptJustAnswered()).toBe(true);
    // the click comes after pointerup: no new press in between
    expect(guard.promptJustAnswered()).toBe(true);
    press('pointerdown');
    expect(guard.promptJustAnswered()).toBe(false);
  });

  it('a key press (a TV remote\'s OK) starts a new press too', () => {
    press('pointerdown');
    guard.markPromptAnswered();
    press('keydown');
    expect(guard.promptJustAnswered()).toBe(false);
  });

  it('keeps the popover and the prompt apart', () => {
    press('pointerdown');
    guard.markPopoverClosed();
    expect(guard.popoverJustClosed()).toBe(true);
    expect(guard.promptJustAnswered()).toBe(false);
    press('pointerdown');
    expect(guard.popoverJustClosed()).toBe(false);
  });
});
