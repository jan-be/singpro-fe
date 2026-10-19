import { apiUrl } from '../GlobalConsts';
import { ApiError } from './authApi';

/**
 * Takes: the recordings of your singing you keep (backend takes.js,
 * routes/takes.js). The microphone panel's "Save recordings" switch, on
 * unless turned off, decides whether this browser records at all: off, it
 * neither records nor uploads anything. On, each song you sing is uploaded
 * with your guest id or account and the play it belongs to, so your profile
 * can play it back over the song's backing track, and the score screen can
 * make a short video of it to share.
 */
const KEY = 'singspree_save_recordings';

/** Whether this browser saves recordings (on unless it was turned off) */
export const loadSaveRecordings = () => {
  try { return localStorage.getItem(KEY) !== '0'; } catch { return true; }
};
export const storeSaveRecordings = (on) => {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* the switch still holds for this page */ }
};

/**
 * A take over the song's karaoke stem, for an <audio> element: your own, or
 * one its owner lets you hear. `mix`: the way of mixing the profile listed
 * it with; under it the browser keeps the take a week (a new way of mixing
 * is a new address).
 */
export const takeAudioUrl = (id, mix) => `${apiUrl}/takes/${encodeURIComponent(id)}/audio${mix != null ? `?v=${encodeURIComponent(mix)}` : ''}`;

async function json(r) {
  let body = null;
  try { body = await r.json(); } catch { /* no body */ }
  if (!r.ok || body?.success === false) throw new ApiError(body?.code ?? 'network', body?.error ?? `Request failed (${r.status})`, r.status);
  return body;
}
const request = async (method, path, init = {}) => {
  try { return await fetch(`${apiUrl}${path}`, { method, ...init }); } catch { throw new ApiError('network', 'Could not reach the server', 0); }
};

/** A take's audio as a Blob (for sharing it): what takeAudioUrl plays, from the browser's cache when it has it */
export async function takeAudioBlob(id, mix) {
  const r = await request('GET', takeAudioUrl(id, mix).slice(apiUrl.length));
  if (!r.ok) await json(r); // throws the server's reason
  return r.blob();
}

/** The melody outline of one of your saved plays, for its share card (null when the chart has none) */
export const scoreMelody = async (scoreId) => (await json(await request('GET', `/me/scores/${encodeURIComponent(scoreId)}/melody`))).melody ?? null;

/** Delete one of your takes from the server */
export const deleteTake = async (id) => json(await request('DELETE', `/me/takes/${encodeURIComponent(id)}`));
/** Delete every take of yours; resolves to how many there were */
export const deleteAllTakes = async () => (await json(await request('DELETE', '/me/takes'))).deleted ?? 0;

/**
 * The share video of a take: about 15 seconds of its best moment over the
 * backing track, with the score card as its picture. `token` is what the
 * upload answered (the score screen, also as a guest); without it the
 * signed-in owner asks (the profile). The card comes from
 * useShareCardDrawer.drawVideo: `image` (a JPEG Blob) and, when it could
 * draw them, the animation's `overlay` and `count` (PNG Blobs) and `layout`;
 * with the image alone the video shows it still. Resolves to an MP4 Blob.
 */
export async function makeShareVideo({ recordingId, token, image, overlay, count, layout }) {
  const form = new FormData();
  if (token) form.append('token', token);
  form.append('image', image, 'card.jpg');
  if (overlay && layout) {
    form.append('overlay', overlay, 'result.png');
    if (count) form.append('count', count, 'count.png');
    form.append('layout', JSON.stringify(layout));
  }
  const r = await request('POST', `/takes/${encodeURIComponent(recordingId)}/clip`, { body: form });
  if (!r.ok) await json(r); // throws the server's reason
  return r.blob();
}
