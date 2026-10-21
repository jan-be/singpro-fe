/**
 * Whether a joiner's phone plays the song's sound.
 *
 * Someone who scanned the QR code or typed the code off the big screen is in
 * the room, where the host's speakers carry the song: a phone playing along
 * only echoes it (and drowns out the speakers its microphone measures the
 * singing delay against). Someone who got the party link from the "Copy
 * link" button (/join/ABCD?l, arrival 'link') is usually somewhere else and
 * needs the sound. So sound is on by default for 'link' arrivals only.
 *
 * Switching it on or off is remembered for the party in this tab, so a
 * reload keeps it; the next party starts from its own arrival again.
 */
const KEY = 'singspree_joiner_audio';

/** The default for an arrival (referrer.js: 'qr' | 'link' | 'join' | 'invite' | null). */
export const joinerSoundDefault = (arrival: string | null | undefined) => arrival === 'link';

/** Sound on for this party: the choice made in this tab, else the arrival's default. */
export function loadJoinerSound(partyId: string | null | undefined, arrival: string | null | undefined, storage: Pick<Storage, 'getItem'> = globalThis.sessionStorage): boolean {
  try {
    const saved = JSON.parse(storage.getItem(KEY) ?? 'null');
    if (saved && partyId && saved.partyId === partyId && typeof saved.on === 'boolean') return saved.on;
  } catch { /* nothing saved, or no storage */ }
  return joinerSoundDefault(arrival);
}

export function saveJoinerSound(partyId: string | null | undefined, on: boolean, storage: Pick<Storage, 'setItem'> = globalThis.sessionStorage) {
  if (!partyId) return;
  try { storage.setItem(KEY, JSON.stringify({ partyId, on: !!on })); } catch { /* kept for this page load only */ }
}
