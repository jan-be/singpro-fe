import { describe, it, expect } from 'vitest';
import { avatarInitial, avatarSrc, learnAvatars } from './avatar.js';

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
