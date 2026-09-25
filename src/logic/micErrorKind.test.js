import { describe, it, expect } from 'vitest';
import { micErrorKind } from './MicrophoneInput.js';

const err = (name) => Object.assign(new Error(name), { name });

describe('micErrorKind', () => {
  it('a refused permission is "denied", in every spelling browsers use', () => {
    expect(['NotAllowedError', 'SecurityError', 'PermissionDeniedError'].map(n => micErrorKind(err(n)))).toEqual(['denied', 'denied', 'denied']);
  });

  it('no microphone, or the remembered one is gone, is "noDevice"', () => {
    expect(['NotFoundError', 'OverconstrainedError', 'DevicesNotFoundError'].map(n => micErrorKind(err(n)))).toEqual(['noDevice', 'noDevice', 'noDevice']);
  });

  it('anything else, a detector that failed to load included, is "failed"', () => {
    expect(micErrorKind(new Error('pitch worker failed to load'))).toBe('failed');
    expect(micErrorKind(new TypeError("Cannot read properties of undefined (reading 'getUserMedia')"))).toBe('failed');
    expect(micErrorKind(undefined)).toBe('failed');
  });
});
