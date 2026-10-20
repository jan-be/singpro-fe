/**
 * A new account's profile picture is picked on the sign-up form next to the
 * display name (AuthPage, the name step), before the account exists: it is
 * held in the page and uploaded right after the account is created, through
 * the same PUT /me/avatar as on the profile (same checks, limits, reports).
 * The account stands either way: a picture that does not save is a line on
 * the next step, and it can be added on the profile later.
 */

/**
 * Upload the held picture for the account just created. Resolves to
 * { user, failed }: the user with its picture on it, or the user as it came
 * and the upload's error. Never rejects: the sign-in must not be lost.
 * `upload(blob)` resolves to the picture's path (authApi.uploadAvatar).
 */
export async function uploadSignupPicture(user, blob, upload) {
  if (!user || !blob) return { user, failed: null };
  try {
    const avatar = await upload(blob);
    return { user: avatar ? { ...user, avatar } : user, failed: null };
  } catch (e) {
    return { user, failed: e ?? new Error('upload failed') };
  }
}

/**
 * Whether the page stays for one more step after signing in, rather than
 * going on: a new account is offered a passkey (where the browser has them),
 * and is told when its picture did not save.
 */
export const staysAfterSignIn = ({ created, passkeys, pictureFailed }) => Boolean(created && (passkeys || pictureFailed));
