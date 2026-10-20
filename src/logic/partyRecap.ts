import { apiUrl } from '../GlobalConsts';
import { getGuestId } from './sessionId';
import { takeAudioUrl } from './takes';

/**
 * A singer's night in a party, for the screen their phone shows once the
 * party is over (components/PartyRecap.jsx; backend partyRecap.js, which
 * reads what was saved under the party's code: scores, takes, achievements).
 *
 * The party page hands it over when it sends a joiner home (party:closed):
 * the code and why it ended. POST, so the browser's guest id stays out of
 * addresses.
 */

/**
 * The night: { songs: [{ scoreId, songId, title, artist, videoId, score,
 * stars, partial, completion?, takes? }], best, achievements, keptBy:
 * 'account' | 'guest' }, or null when it cannot be loaded.
 */
export async function loadRecap(partyId) {
  try {
    const resp = await fetch(`${apiUrl}/parties/${encodeURIComponent(partyId)}/recap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestId: getGuestId() }),
    });
    if (!resp.ok) return null;
    return (await resp.json())?.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Something to play a take with: the address of an account's own take, or
 * for a guest's a local copy fetched with the browser's guest id (an address
 * cannot carry it). Resolves to { src, revoke }.
 */
export async function takeSource(partyId, takeId, { keptBy }) {
  if (keptBy === 'account') return { src: takeAudioUrl(takeId), revoke: () => {} };
  const resp = await fetch(`${apiUrl}/parties/${encodeURIComponent(partyId)}/recap/takes/${encodeURIComponent(takeId)}/audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guestId: getGuestId() }),
  });
  if (!resp.ok) throw new Error(`take audio ${resp.status}`);
  const src = URL.createObjectURL(await resp.blob());
  return { src, revoke: () => URL.revokeObjectURL(src) };
}

/** What the night comes to: songs sung (finished or not), finished ones, and the best of those */
export function nightSummary(recap) {
  const songs = recap?.songs ?? [];
  return {
    sung: songs.length,
    finished: songs.filter(s => !s.partial).length,
    best: recap?.best ?? null,
    takes: songs.reduce((n, s) => n + (s.takes?.length ? 1 : 0), 0),
  };
}
