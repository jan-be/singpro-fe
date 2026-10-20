import { describe, it, expect } from 'vitest';
import { contextLatency, nextLead } from './outputLead';

describe('contextLatency', () => {
  it('adds the context buffer and the device after it', () => {
    expect(contextLatency({ baseLatency: 0.043, outputLatency: 0.512 })).toBeCloseTo(0.555, 6); // the stick on Bluetooth
    expect(contextLatency({ baseLatency: 0.01, outputLatency: 0.04 })).toBeCloseTo(0.05, 6);    // a desktop
  });
  it('is 0 where the browser gives nothing, and capped where it gives nonsense', () => {
    expect(contextLatency(null)).toBe(0);
    expect(contextLatency({})).toBe(0);
    expect(contextLatency({ baseLatency: 0.01, outputLatency: 5 })).toBe(1);
    expect(contextLatency({ outputLatency: -1 })).toBe(0);
  });
});

describe('nextLead', () => {
  it('takes the first estimate at once and follows later ones slowly', () => {
    let lead = nextLead(0, 0.3);
    expect(lead).toBe(0.3);
    lead = nextLead(lead, 0.55);
    expect(lead).toBeCloseTo(0.35, 6);
    for (let i = 0; i < 30; i++) lead = nextLead(lead, 0.55); // 15 s of updates
    expect(lead).toBeCloseTo(0.55, 2);
  });
  it('keeps the last lead when there is no estimate', () => {
    expect(nextLead(0.3, 0)).toBe(0.3);
    expect(nextLead(0, 0)).toBe(0);
  });
});
