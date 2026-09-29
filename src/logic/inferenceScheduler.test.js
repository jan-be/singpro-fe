import { describe, it, expect } from 'vitest';
import { createInferenceScheduler } from './inferenceScheduler';

const setup = (options) => {
  const sent = [];
  let clock = 0;
  const s = createInferenceScheduler(job => sent.push(job), { now: () => clock, ...options });
  return { s, sent, advance: ms => { clock += ms; } };
};

describe('createInferenceScheduler', () => {
  it('sends a window straight away when the worker is free', () => {
    const { s, sent } = setup();
    s.submit('a');
    expect(sent).toEqual(['a']);
  });

  it('keeps one request in flight and one waiting, the newest winning', () => {
    const { s, sent } = setup();
    s.submit('a');
    s.submit('b');
    s.submit('c'); // replaces b
    expect(sent).toEqual(['a']);
    expect(s.dropped).toBe(1);
    s.done();
    expect(sent).toEqual(['a', 'c']);
    s.done();
    expect(sent).toEqual(['a', 'c']);
    s.submit('d');
    expect(sent).toEqual(['a', 'c', 'd']);
  });

  it('never queues up on a device slower than real time', () => {
    // A window every 30 ms, an inference taking 70 ms: the worker only ever sees the newest
    const { s, sent, advance } = setup();
    const answered = [];
    let busyUntil = null;
    for (let t = 0; t < 3000; t += 10) {
      if (t % 30 === 0) s.submit(t);
      if (busyUntil === null && sent.length > answered.length) busyUntil = t + 70;
      if (busyUntil !== null && t >= busyUntil) {
        answered.push(sent[answered.length]);
        busyUntil = null;
        s.done();
      }
      advance(10);
    }
    // every answered window is at most one window plus one inference old when its answer arrives
    expect(sent.length).toBeGreaterThan(30);
    expect(sent.length - answered.length).toBeLessThanOrEqual(1);
    expect(s.dropped).toBeGreaterThan(0);
  });

  it('gives up on a request that never got an answer', () => {
    const { s, sent, advance } = setup({ staleMs: 1000 });
    s.submit('a');
    advance(500);
    s.submit('b');
    expect(sent).toEqual(['a']);
    advance(600);
    s.submit('c');
    expect(sent).toEqual(['a', 'c']);
  });

  it('forgets the waiting window on clear()', () => {
    const { s, sent } = setup();
    s.submit('a');
    s.submit('b');
    s.clear();
    s.done();
    expect(sent).toEqual(['a']);
  });
});
