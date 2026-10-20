import { describe, expect, it, vi } from 'vitest';
import { staysAfterSignIn, uploadSignupPicture } from './signupPicture';

const user = { id: 7, username: 'Ann', avatar: null };

describe('uploadSignupPicture', () => {
  it('puts the uploaded picture on the new user', async () => {
    const blob = new Blob(['x'], { type: 'image/webp' });
    const upload = vi.fn().mockResolvedValue('/users/7/avatar?v=12');
    const r = await uploadSignupPicture(user, blob, upload);
    expect(upload).toHaveBeenCalledWith(blob);
    expect(r).toEqual({ user: { ...user, avatar: '/users/7/avatar?v=12' }, failed: null });
    expect(user.avatar).toBe(null); // a new object, the one passed in is left alone
  });

  it('uploads nothing without a picture (skipped)', async () => {
    const upload = vi.fn();
    expect(await uploadSignupPicture(user, null, upload)).toEqual({ user, failed: null });
    expect(upload).not.toHaveBeenCalled();
  });

  it('keeps the account when the upload fails, and says why', async () => {
    const err = Object.assign(new Error('Too many pictures'), { code: 'rate_limited' });
    const r = await uploadSignupPicture(user, new Blob(['x']), () => Promise.reject(err));
    expect(r.user).toBe(user);
    expect(r.failed).toBe(err);
  });

  it('never rejects, even when the upload throws at once or rejects with nothing', async () => {
    const r1 = await uploadSignupPicture(user, new Blob(['x']), () => { throw new Error('boom'); });
    expect(r1.user).toBe(user);
    expect(r1.failed).toBeInstanceOf(Error);
    const r2 = await uploadSignupPicture(user, new Blob(['x']), () => Promise.reject(undefined));
    expect(r2.failed).toBeInstanceOf(Error);
  });

  it('leaves the user as it was when the server answers without a path', async () => {
    const r = await uploadSignupPicture(user, new Blob(['x']), () => Promise.resolve(undefined));
    expect(r).toEqual({ user, failed: null });
  });
});

describe('staysAfterSignIn', () => {
  it('stays for the passkey offer on a new account where passkeys work', () => {
    expect(staysAfterSignIn({ created: true, passkeys: true, pictureFailed: false })).toBe(true);
  });
  it('stays to say the picture did not save, passkeys or not', () => {
    expect(staysAfterSignIn({ created: true, passkeys: false, pictureFailed: true })).toBe(true);
    expect(staysAfterSignIn({ created: true, passkeys: true, pictureFailed: true })).toBe(true);
  });
  it('goes on for a new account without passkeys whose picture saved (or that had none)', () => {
    expect(staysAfterSignIn({ created: true, passkeys: false, pictureFailed: false })).toBe(false);
  });
  it('goes on when signing in to an existing account', () => {
    expect(staysAfterSignIn({ created: false, passkeys: true, pictureFailed: false })).toBe(false);
    expect(staysAfterSignIn({ created: false, passkeys: true })).toBe(false);
  });
});
