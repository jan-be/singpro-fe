import { describe, it, expect } from 'vitest';
import { avatarInitial, avatarSrc, learnAvatars, tieLetters, parseAvatarPath } from './avatar.js';

describe('avatarInitial', () => {
  it('takes the first letter, upper-cased', () => {
    expect(avatarInitial('anna')).toBe('A');
    expect(avatarInitial('  bob ')).toBe('B');
    expect(avatarInitial('élodie')).toBe('É');
    expect(avatarInitial('ömer')).toBe('Ö');
  });

  it('keeps a whole emoji, a CJK character, a letter with its combining accent', () => {
    expect(avatarInitial('👩‍🎤 Starlet')).toBe('👩‍🎤');
    expect(avatarInitial('🇩🇪fan')).toBe('🇩🇪');
    expect(avatarInitial('👍🏽yes')).toBe('👍🏽');
    expect(avatarInitial('晴天')).toBe('晴');
    expect(avatarInitial('김민수')).toBe('김');
    expect(avatarInitial('élan')).toBe('É');
  });

  it('stays one character where upper case would make two', () => {
    expect(avatarInitial('ßtar')).toBe('ß');
  });

  it('a question mark for nothing', () => {
    expect(avatarInitial('')).toBe('?');
    expect(avatarInitial('   ')).toBe('?');
    expect(avatarInitial(null)).toBe('?');
    expect(avatarInitial(undefined)).toBe('?');
  });
});

describe('avatarSrc', () => {
  it('puts the API prefix in front of one of our picture paths', () => {
    expect(avatarSrc('/users/12/avatar?v=1759600000000')).toBe('/api/users/12/avatar?v=1759600000000');
    expect(avatarSrc('/users/12/avatar')).toBe('/api/users/12/avatar');
  });

  it('nothing for no picture or anything that is not ours', () => {
    expect(avatarSrc(null)).toBe(null);
    expect(avatarSrc(undefined)).toBe(null);
    expect(avatarSrc('')).toBe(null);
    expect(avatarSrc('https://evil.example/x.png')).toBe(null);
    expect(avatarSrc('//evil.example/users/1/avatar')).toBe(null);
    expect(avatarSrc('/users/12/avatar?v=1&x=javascript:')).toBe(null);
    expect(avatarSrc({ toString: () => '/users/1/avatar' })).toBe(null);
  });
});

describe('learnAvatars', () => {
  it('learns pictures and the absence of one; a guest entry has no field at all', () => {
    const next = learnAvatars({}, [{ username: 'Ann', avatar: '/users/4/avatar?v=1' }, { username: 'Bob', color: 45 }]);
    expect(next).toEqual({ Ann: '/users/4/avatar?v=1', Bob: null });
  });

  it('returns the same object when nothing changed, a new one when something did', () => {
    const prev = { Ann: '/users/4/avatar?v=1', Bob: null };
    expect(learnAvatars(prev, [{ username: 'Ann', avatar: '/users/4/avatar?v=1' }, { username: 'Bob' }])).toBe(prev);
    expect(learnAvatars(prev, [])).toBe(prev);
    const changed = learnAvatars(prev, [{ username: 'Ann', avatar: null }]);
    expect(changed).not.toBe(prev);
    expect(changed).toEqual({ Ann: null, Bob: null });
    expect(prev.Ann).toBe('/users/4/avatar?v=1');
  });

  it('skips entries without a name', () => {
    expect(learnAvatars({}, [null, {}, { avatar: '/users/1/avatar?v=1' }])).toEqual({});
  });
});

describe('tieLetters', () => {
  const hues = { Bea: 20, Ben: 20, Bob: 20, Bo: 140, Cat: 20, Anna: 335, anna: 335 };
  const hueOf = (n) => hues[n] ?? 215;
  const none = () => false;

  it("a name ending in a number shows it, whatever the colours (a device's extra microphones)", () => {
    const t = tieLetters(['Mic 2', 'Mic 3', 'Mic 10', 'Ann'], hueOf, none);
    expect(t.get('Mic 2')).toBe('M2');
    expect(t.get('Mic 10')).toBe('M10');
    expect(t.has('Ann')).toBe(false);
    expect(tieLetters(['Mic 2'], hueOf, (n) => n === 'Mic 2')).toBe(null); // a picture says it already
    expect(tieLetters(['Area51'], hueOf, none)).toBe(null); // only a separate number counts
  });

  it('nobody alike: null, nothing to change', () => {
    expect(tieLetters(['Bea', 'Cat', 'Bo'], hueOf, none)).toBe(null);
    expect(tieLetters([], hueOf, none)).toBe(null);
  });

  it('same letter, same colour, no picture: the first letter that tells them apart', () => {
    expect(tieLetters(['Bea', 'Ben'], hueOf, none)).toEqual(new Map([['Bea', 'Ba'], ['Ben', 'Bn']]));
    const three = tieLetters(['Bea', 'Ben', 'Bob', 'Cat'], hueOf, none);
    expect(three).toEqual(new Map([['Bea', 'Ba'], ['Ben', 'Bn'], ['Bob', 'Bo']]));
    expect(new Set(three.values()).size).toBe(3);
  });

  it('another colour or a picture is told apart already', () => {
    expect(tieLetters(['Bea', 'Bo'], hueOf, none)).toBe(null); // Bo is green
    expect(tieLetters(['Bea', 'Ben'], hueOf, (n) => n === 'Ben')).toBe(null);
  });

  it('grapheme-safe: emoji and CJK count as one letter each', () => {
    const h = () => 215;
    expect(tieLetters(['👩‍🎤Star', '👩‍🎤Sun'], h, none)).toEqual(new Map([['👩‍🎤Star', '👩‍🎤t'], ['👩‍🎤Sun', '👩‍🎤u']]));
    expect(tieLetters(['晴天', '晴雨'], h, none)).toEqual(new Map([['晴天', '晴天'], ['晴雨', '晴雨']]));
  });

  it('nothing sets them apart (case only, or a name of one letter): the second letter, if any', () => {
    expect(tieLetters(['Anna', 'anna'], hueOf, none)).toEqual(new Map([['Anna', 'An'], ['anna', 'An']]));
    expect(tieLetters(['B', 'Bea'], () => 20, none)).toEqual(new Map([['B', 'B'], ['Bea', 'Be']]));
  });

  it('a name listed twice is one player', () => {
    expect(tieLetters(['Bea', 'Bea'], hueOf, none)).toBe(null);
  });
});

describe('parseAvatarPath', () => {
  it('whose picture and which version, from the path the server sent', () => {
    expect(parseAvatarPath('/users/12/avatar?v=131523308749667')).toEqual({ userId: 12, version: 131523308749667 });
    expect(parseAvatarPath('/users/12/avatar')).toBe(null);
    expect(parseAvatarPath('/api/users/12/avatar?v=1')).toBe(null);
    expect(parseAvatarPath(null)).toBe(null);
  });
});
