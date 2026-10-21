import { apiUrl } from '../GlobalConsts';
import { ApiError } from './authApi';
import type { MelodyNote } from './shareImage';

/**
 * Takes: the recordings of your singing you keep (backend takes.ts,
 * routes/takes.ts). The microphone panel's "Save recordings" switch, on
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
export const storeSaveRecordings = (on: boolean) => {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* the switch still holds for this page */ }
};

/**
 * A take over the song's karaoke stem, for an <audio> element: your own, or
 * one its owner lets you hear. `mix`: the way of mixing the profile listed
 * it with; under it the browser keeps the take a week (a new way of mixing
 * is a new address).
 */
export const takeAudioUrl = (id: string, mix?: number) => `${apiUrl}/takes/${encodeURIComponent(id)}/audio${mix != null ? `?v=${encodeURIComponent(mix)}` : ''}`;

/** A note of a play's melody outline for its share card (backend cardMelody.ts): start, end and pitch, all 0..1 */
export type CardMelodyNote = MelodyNote;

/** What the take routes answer: the envelope, and the field each one reads */
interface TakesBody {
  success?: boolean;
  code?: string;
  error?: string;
  melody?: CardMelodyNote[] | null;
  deleted?: number;
  start?: number;
  end?: number;
}

/** An answer's body (null when it had none), or the server's reason thrown */
async function json(r: Response) {
  let body: TakesBody | null = null;
  try { body = await r.json(); } catch { /* no body */ }
  if (!r.ok || body?.success === false) throw new ApiError(body?.code ?? 'network', body?.error ?? `Request failed (${r.status})`, r.status);
  return body;
}
/** The body of an answer that always has one */
const answered = (body: TakesBody | null) => {
  if (!body) throw new Error('The server answered without a body');
  return body;
};
const request = async (method: string, path: string, init: RequestInit = {}) => {
  try { return await fetch(`${apiUrl}${path}`, { method, ...init }); } catch { throw new ApiError('network', 'Could not reach the server', 0); }
};

/** A take's audio as a Blob (for sharing it): what takeAudioUrl plays, from the browser's cache when it has it */
export async function takeAudioBlob(id: string, mix?: number) {
  const r = await request('GET', takeAudioUrl(id, mix).slice(apiUrl.length));
  if (!r.ok) await json(r); // throws the server's reason
  return r.blob();
}

/** The melody outline of one of your saved plays, for its share card (null when the chart has none) */
export const scoreMelody = async (scoreId: string) => answered(await json(await request('GET', `/me/scores/${encodeURIComponent(scoreId)}/melody`))).melody ?? null;

/** Delete one of your takes from the server */
export const deleteTake = async (id: string) => json(await request('DELETE', `/me/takes/${encodeURIComponent(id)}`));
/** Delete every take of yours; resolves to how many there were */
export const deleteAllTakes = async () => answered(await json(await request('DELETE', '/me/takes'))).deleted ?? 0;

/**
 * The share video of a take: about 15 seconds of its best moment over the
 * backing track, with the score card as its picture. `token` is what the
 * upload answered (the score screen, also as a guest); without it the
 * signed-in owner asks (the profile). The card comes from
 * useShareCardDrawer.drawVideo: `image` (a JPEG Blob) and, when it could
 * draw them, the animation's `overlay` and `count` (PNG Blobs) and `layout`;
 * with the image alone the video shows it still. `camera` (influencer mode,
 * logic/cameraClip.ts segmentFile): the singer filmed in that moment, an FLV
 * Blob and the song second its first frame shows; the server deletes it
 * once the video is made, and puts the song's video behind the card (whose
 * `image` is then a PNG on transparency). Resolves to an MP4 Blob.
 */
export async function makeShareVideo({ recordingId, token, image, overlay, count, layout, camera }: {
  recordingId: string; token?: string | null; image: Blob; overlay?: Blob | null; count?: Blob | null; layout?: object | null;
  camera?: { blob: Blob; start: number } | null;
}) {
  const form = new FormData();
  if (token) form.append('token', token);
  form.append('image', image, image.type === 'image/png' ? 'card.png' : 'card.jpg');
  if (overlay && layout) {
    form.append('overlay', overlay, 'result.png');
    if (count) form.append('count', count, 'count.png');
    form.append('layout', JSON.stringify(layout));
    if (camera) {
      form.append('camera', camera.blob, 'camera.flv');
      form.append('cameraStart', String(camera.start));
    }
  }
  const r = await request('POST', `/takes/${encodeURIComponent(recordingId)}/clip`, { body: form });
  if (!r.ok) await json(r); // throws the server's reason
  return r.blob();
}

/**
 * The song seconds a take's share video shows ({ start, end }), or null when
 * it has none: influencer mode's camera keeps those (logic/cameraClip.ts).
 * `token` as for makeShareVideo.
 */
export async function takeMoment(recordingId: string, token: string | null) {
  const r = await request('POST', `/takes/${encodeURIComponent(recordingId)}/moment`, {
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(token ? { token } : {}),
  });
  if (r.status === 422) return null;
  const { start, end } = answered(await json(r));
  return start != null && end != null ? { start, end } : null;
}
