/**
 * Who the score strip above the highway shows, best first (LiveScoreStrip.jsx).
 *
 * Everyone who has sung this song, with the newest score there is: the one
 * that rode along with their latest note (live.scores), else the scoreboard's.
 * More than `max` singers: the best ones, and your own place stays on the
 * strip as the last chip. In a crowd (party:lanes, past the lane count) the
 * server says who is on screen, and your standing among everyone comes from
 * it too (live.standing).
 *
 *   scores   { username: { score } } (the JSON scoreboard, React state)
 *   live     { username: score } (live.scores)
 *   lanes    { pinned, spotlight } or null; standing { rank, total, score } or null
 * Returns { rows: [{ username, score, rank }], mine: { rank, total, score } | null, key }
 * where `key` changes only when who is shown, or in which order, does.
 */
export function rankSingers({ scores, live, lanes = null, standing = null, me, max = 8 }) {
  const board = scores ?? {};
  const fresh = live ?? {};
  const names = lanes
    ? [...new Set([...lanes.pinned, ...lanes.spotlight])]
    : [...new Set([...Object.keys(board), ...Object.keys(fresh)])];
  const all = names
    .map(username => ({ username, score: fresh[username] ?? board[username]?.score ?? 0 }))
    .sort((a, b) => b.score - a.score || a.username.localeCompare(b.username));
  all.forEach((r, i) => { r.rank = i + 1; });

  let rows = all.slice(0, max);
  let mine = null;
  if (lanes && standing) {
    // ranks among everyone, not just those on screen
    if (!rows.some(r => r.username === me)) mine = { rank: standing.rank, total: standing.total, score: standing.score };
    rows = rows.map(r => (r.username === me ? { ...r, rank: standing.rank } : r));
  } else if (all.length > max) {
    const own = all.find(r => r.username === me);
    if (own && !rows.includes(own)) rows = [...all.slice(0, max - 1), own];
  }
  // (your standing in a crowd changes seldom, with party:lanes: its score is in the key too)
  const key = rows.map(r => `${r.username}#${r.rank}`).join('\n') + (mine ? `\n=${mine.rank}/${mine.total}/${mine.score}` : '');
  return { rows, mine, key };
}
