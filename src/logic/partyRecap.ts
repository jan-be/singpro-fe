import { apiUrl } from '../GlobalConsts';
import { getGuestId } from './sessionId';
import { takeAudioUrl } from './takes';

/**
 * A singer's night in a party, for the screen their phone shows once the
 * party is over (components/PartyRecap.tsx; backend partyRecap.ts, which
 * reads what was saved under the party's code: scores, takes, achievements).
 *
 * The party page hands it over when it sends a joiner home (party:closed):
 * the code and why it ended. POST, so the browser's guest id stays out of
 * addresses.
 */

/** A recording the singer kept of a song of the night */
export interface RecapTake {
  id: string;
  /** s */
  duration: number | null;
}

/** A song the singer sang that night (backend partyRecap.ts recapOf) */
export interface RecapSong {
  scoreId: number;
  songId: string;
  title: string | null;
  artist: string | null;
  videoId: string | null;
  score: number;
  stars: number;
  /** stopped before it counted */
  partial: boolean;
  /** 0..1, for a partial one */
  completion?: number;
  /** ISO time */
  sungAt: string;
  takes?: RecapTake[];
}

/** A singer's night in a party (loadRecap) */
export interface PartyRecapData {
  songs: RecapSong[];
  best: { songId: string; title: string | null; score: number; stars: number } | null;
  /** achievement keys */
  achievements: string[];
  keptBy: 'account' | 'guest';
}

/**
 * The night: { songs: [{ scoreId, songId, title, artist, videoId, score,
 * stars, partial, completion?, takes? }], best, achievements, keptBy:
 * 'account' | 'guest' }, or null when it cannot be loaded.
 */
export async function loadRecap(partyId: string): Promise<PartyRecapData | null> {
  try {
    const resp = await fetch(`${apiUrl}/parties/${encodeURIComponent(partyId)}/recap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestId: getGuestId() }),
    });
    if (!resp.ok) return null;
    return ((await resp.json()) as { data?: PartyRecapData | null } | null)?.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Something to play a take with: the address of an account's own take, or
 * for a guest's a local copy fetched with the browser's guest id (an address
 * cannot carry it). Resolves to { src, revoke }.
 */
export async function takeSource(partyId: string, takeId: string, { keptBy }: { keptBy: string | undefined }): Promise<{ src: string; revoke: () => void }> {
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
export function nightSummary<B>(recap: { songs?: readonly { partial?: boolean; takes?: readonly unknown[] }[]; best?: B | null } | null | undefined):
  { sung: number; finished: number; best: B | null; takes: number } {
  const songs = recap?.songs ?? [];
  return {
    sung: songs.length,
    finished: songs.filter(s => !s.partial).length,
    best: recap?.best ?? null,
    takes: songs.reduce((n, s) => n + (s.takes?.length ? 1 : 0), 0),
  };
}
