/**
 * The YouTube video id in a pasted link, or null: watch?v=, youtu.be/,
 * /shorts/, /live/ and /embed/ links on youtube.com, m., www. and music.
 * (Used by the home page's search box and the party queue's.)
 */
const ID = /^[a-zA-Z0-9_-]{11}$/;
const HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com', 'music.youtube.com']);

export function extractYouTubeVideoId(text) {
  const trimmed = String(text ?? '').trim();
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null; // not a URL
  }
  if (HOSTS.has(url.hostname)) {
    const v = url.searchParams.get('v');
    if (v && ID.test(v)) return v;
    const match = url.pathname.match(/^\/(?:watch|shorts|live|embed)\/([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];
  }
  if (url.hostname === 'youtu.be') {
    const id = url.pathname.slice(1).split(/[/?]/)[0];
    if (id && ID.test(id)) return id;
  }
  return null;
}
