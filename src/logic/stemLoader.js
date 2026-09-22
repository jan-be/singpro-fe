// stemLoader.js — a stem fetched whole, to be played from memory.
//
// A seek over the network lands late: on iOS by hundreds of milliseconds,
// the Ogg stems having no index (WebKit bisects with range requests), and
// even an indexed file costs a round trip — so the stems trailed the
// lyrics. A seek within a Blob lands at once. The files are a few MB and
// are fetched while the player starts up; the browser decodes from the
// Blob as it plays, so memory holds the compressed file, not the audio.

/**
 * Resolves to { objectUrl, size, ms }. The caller owns the URL and revokes
 * it when the element is done with it.
 */
export async function fetchStemIntoMemory(url, {
  fetchImpl = (u) => globalThis.fetch(u),
  createObjectURL = (blob) => URL.createObjectURL(blob),
  now = () => performance.now(),
} = {}) {
  const startedAt = now();
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  if (!blob.size) throw new Error('empty file');
  return { objectUrl: createObjectURL(blob), size: blob.size, ms: Math.round(now() - startedAt) };
}
