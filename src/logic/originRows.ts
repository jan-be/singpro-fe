import type { AdminOrigins } from './authApi';
import type { Translate } from '../types/i18n';

/**
 * The admin page's "Arrived from" list, out of /admin/origins (backend
 * routes/admin.ts): external sites, our own links (logic/referrer.ts) and
 * direct visits in one ranking, busiest first.
 *
 * Our own links: the party QR code, the copied party link, a join URL without
 * a tag, a friend invite link, a singer's shared score, video or recording
 * (?r=, logic/shareLinks.ts), and the invitees from before those were tagged,
 * which the backend infers (a browser with no referrer playing in a party that
 * another browser started). That one is marked, since nothing stored says it.
 */
export const OWN_LINKS = ['qr', 'link', 'join', 'invite', 'share', 'inferred'];

/**
 * A row of the admin page's ranked lists (its OriginList): `hint` shown on hover, `own` one of our own links,
 * `inferred` worked out rather than recorded
 */
export interface OriginRow {
  key: string;
  label: string;
  sessions: number;
  plays: number;
  hint?: string;
  own?: boolean;
  inferred?: boolean;
}

export function sourceRows(origins: Pick<AdminOrigins, 'direct' | 'arrivals' | 'referrers'> | null, t: Translate): OriginRow[] {
  if (!origins) return [];
  const direct = origins.direct ?? { sessions: 0, plays: 0 };
  return [
    ...(direct.plays > 0 ? [{ key: 'direct', label: t('admin.origins.direct'), sessions: direct.sessions, plays: direct.plays }] : []),
    // an older backend sends no arrivals; a newer one may send a way this page does not know yet
    ...(origins.arrivals ?? []).map(a => ({
      key: `via:${a.via}`,
      label: OWN_LINKS.includes(a.via) ? t(`admin.origins.via.${a.via}`) : a.via,
      hint: OWN_LINKS.includes(a.via) ? t(`admin.origins.viaHint.${a.via}`) : undefined,
      own: true,
      inferred: a.via === 'inferred',
      sessions: a.sessions,
      plays: a.plays,
    })),
    ...(origins.referrers ?? []).map(r => ({ key: r.source, label: r.source, sessions: r.sessions, plays: r.plays })),
  ].sort((a, b) => b.sessions - a.sessions || b.plays - a.plays);
}
