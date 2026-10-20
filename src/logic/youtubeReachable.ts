/**
 * Can this network reach YouTube at all? Every song plays through YouTube, and
 * where it is blocked (mainland China above all) the player never even
 * appears: no error, just a spinner forever. Visitors there are told so.
 *
 * The probe is a request to the host the player's script comes from, with no
 * credentials, so it reveals nothing the player would not. Only a success is
 * remembered: a failed probe may have been a passing hiccup.
 */
const PROBE_URL = 'https://www.youtube.com/generate_204';

let reachable = false;
let pending = null;

export function probeYouTube(timeoutMs = 6000) {
  if (reachable) return Promise.resolve(true);
  if (pending) return pending;
  pending = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      await fetch(PROBE_URL, { mode: 'no-cors', cache: 'no-store', credentials: 'omit', signal: ctrl.signal });
      reachable = true;
    } catch {
      reachable = false;
    } finally {
      clearTimeout(timer);
      pending = null;
    }
    return reachable;
  })();
  return pending;
}

// Mainland China's time zones. Visitors there are probed on the front page
// already, before they pick a song; everyone else only meets YouTube on the
// song page, as before.
const CHINA_ZONES = new Set(['Asia/Shanghai', 'Asia/Urumqi', 'Asia/Chongqing', 'Asia/Chungking', 'Asia/Harbin', 'Asia/Kashgar', 'PRC']);

export function inMainlandChinaTimeZone() {
  try { return CHINA_ZONES.has(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { return false; }
}
