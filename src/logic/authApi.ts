import { startRegistration, startAuthentication, browserSupportsWebAuthn, browserSupportsWebAuthnAutofill } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { apiUrl } from '../GlobalConsts';
import { getGuestId } from './sessionId';
import { parseAvatarPath } from './avatar';
import type { PrivacySettings, Visibility } from './statsPrivacy';
import type { AchievementItem } from './achievements';
import type { ChartAccessLevel, JobFilter } from './chartJobAdmin';
import type { ChartJobStatus } from './chartJobs';
import type { TrendsData } from './trends';

/**
 * Account, friends and score API (backend routes/auth.js, social.js,
 * scores.js). Sessions are an HttpOnly cookie on the same origin, so plain
 * fetch carries them. Failed calls throw an ApiError with the backend's
 * `code` (translated by the UI) and its English `error` as the message.
 */
export class ApiError extends Error {
  declare code: string;
  declare status: number;
  constructor(code: string, message: string, status: number) { super(message); this.code = code; this.status = status; }
}

// ── What the server answers (dates arrive as ISO strings) ────────────────

/** Who a profile is to the viewer (backend friends.js relation); null: nobody, or yourself */
export type Relation = 'friends' | 'outgoing' | 'incoming' | null;

/** What everyone may see of an account (backend auth.js publicUser); `avatar`: the picture's API path (logic/avatar.js) or null */
export interface PublicUser {
  id: number;
  username: string;
  createdAt: string;
  avatar: string | null;
}

/** One of the signed-in account's passkeys */
export interface Passkey {
  id: string;
  name: string | null;
  transports: string[] | null;
  deviceType: string | null;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  rpId: string | null;
}

/** The signed-in user, from GET /auth/me (backend auth.js privateUser, with the passkeys) */
export interface Me extends PublicUser {
  email: string | null;
  hasPassword: boolean;
  isAdmin: boolean;
  /** the numbers' setting alone, for pages from before the sections (statsPrivacy.js) */
  statsVisibility: Visibility;
  privacy: PrivacySettings;
  passkeys: Passkey[];
}

/** What an address can sign in with (POST /auth/lookup) */
export interface EmailLookup {
  exists: boolean;
  hasPasskey: boolean;
  hasPassword: boolean;
}

/** A mailed code: sent, or (development, test addresses) handed back as devCode */
export interface EmailCodeSent {
  sent: boolean;
  devCode?: string;
}

/** Signing in with the mailed code: an address without an account first needs a display name */
export type EmailVerifyResult = { needsUsername: true } | { needsUsername?: undefined; user: Me; created: boolean };

/** The signed-in user's best per song, by song id: the star badges on song cards */
export type BestScores = Record<string, { score: number; stars: number }>;

/** A recording of a play (backend takes.js attachTakes); `mix` is the way of mixing, for the address the browser keeps it under */
export interface Take {
  id: string;
  duration: number | null;
  mix: number;
}

/** A saved score with its song (backend scoreStore.js topSongs / history), and its recordings where the viewer may listen */
export interface ScoreRow {
  /** the score's row (a BIGINT, so a string) */
  id: string;
  songId: string;
  score: number;
  stars: number;
  sungAt: string;
  /** history rows only */
  isDuet?: boolean;
  part?: number | null;
  /** 0..1 for a play stopped before its end, null for one that ran to it (history rows only) */
  completion?: number | null;
  /** stopped too early to count as the song's (history rows only) */
  partial?: boolean;
  title: string | null;
  artist: string | null;
  videoId: string | null;
  takes?: Take[];
}

/** A song played at a party, scored or not (backend playHistory.js playSummary) */
export interface PlayedRow {
  songId: string;
  title: string | null;
  artist: string | null;
  videoId: string | null;
  playedAt: string;
  score: number | null;
  stars: number | null;
  completion: number | null;
  partial: boolean;
}

/** A profile's numbers (backend scoreStore.js stats, with the friends, the songs played and the time on the mic) */
export interface ProfileStats {
  songsSung: number;
  totalStars: number;
  averageBest: number;
  fiveStars: number;
  /** the saved scores */
  plays: number;
  friends: number;
  /** songs played at parties, never fewer than `plays` */
  played: number;
  parties: number;
  secondsSung: number | null;
}

/** GET /users/:username: each part null when its owner keeps it from the viewer (statsPrivacy.js) */
export interface PublicProfile {
  user: PublicUser;
  private?: false;
  stats: ProfileStats | null;
  topSongs: ScoreRow[] | null;
  recent: ScoreRow[] | null;
  playedRecently: PlayedRow[] | null;
  achievements: AchievementItem[] | null;
  relation: Relation;
  isMe: boolean;
}

/** GET /users/:username when the viewer may see none of it: the name and picture, and whether friends would see more */
export interface PrivateProfile {
  user: PublicUser;
  private: true;
  friendsOnly?: boolean;
  relation: Relation;
  isMe: boolean;
}

export type Profile = PublicProfile | PrivateProfile;

/** A name found by the friends search, with your relation to them */
export interface UserSearchResult {
  username: string;
  avatar: string | null;
  relation: Relation;
}

/** Someone you sang with and are not friends with yet (backend friends.js suggestions) */
export interface FriendSuggestion {
  username: string;
  avatar: string | null;
  songsTogether: number;
  lastSungAt: string;
}

/** A friend: with their numbers, or `private` without them */
export interface Friend {
  username: string;
  avatar: string | null;
  since: string;
  private?: boolean;
  totalStars?: number;
  songsSung?: number;
}

/** A friend request, to you (incoming) or from you (outgoing) */
export interface FriendRequest {
  username: string;
  avatar: string | null;
  createdAt: string;
}

/** GET /friends */
export interface FriendsData {
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
}

/** GET /notifications: the pending requests to you and the achievements you recently earned, each newest first */
export interface Notifications {
  friendRequests: (FriendRequest & { isNew: boolean })[];
  achievements: { key: string; unlockedAt: string; isNew: boolean }[];
  /** how many arrived since you last looked */
  unseen: number;
}

/** One singer on a song's board (backend scoreStore.js songLeaderboard) */
export interface LeaderboardEntry {
  username: string;
  score: number;
  stars: number;
  sungAt: string;
  avatar: string | null;
}

/** GET /scores/song/:songId: the song's best, your friends' (signed in) and your own record on it */
export interface SongScores {
  top: LeaderboardEntry[];
  friends: LeaderboardEntry[] | null;
  mine: { best: number | null; plays: number } | null;
  maxScore: number;
  starThresholds: number[];
}

/** Where a reported picture was seen (backend avatarReports.js) */
export interface AvatarReportWhere {
  place?: 'profile' | 'party';
  partyId?: string | null;
  nickname?: string | null;
}

/** What is wrong with a song (backend songReports.js parseReport) */
export interface SongReportRequest {
  kinds: string[];
  comment?: string;
  context?: object;
  nickname?: string | null;
  partyId?: string | null;
  sessionId?: string | null;
}

/** A page of a list: its rows, and whether there are more */
export interface Paged<T> {
  data: T[];
  hasMore: boolean;
}

// ── Admin ──

/** A party running right now (backend routes/admin.js partySummary) */
export interface AdminParty {
  partyId: string;
  owner: string;
  /** ms since 1970 */
  createdAt: number;
  hostConnected: boolean;
  hostAway: boolean;
  currentSong: { songId: string; title: string; artist: string; videoId: string; isPlaying: boolean; startedAt?: number } | null;
  queueLength: number;
  players: { username: string; connected: boolean; score: number; signedIn: boolean; latencyMs: number; avatar?: string }[];
}

/** GET /admin/overview: the tiles' numbers and the parties */
export interface AdminOverview {
  usersTotal: number;
  usersDay: number;
  usersWeek: number;
  playsDay: number;
  playsWeek: number;
  scoresDay: number;
  secondsDay: number;
  secondsWeek: number;
  reportsOpen: number;
  avatarReportsOpen: number;
  chartJobsActive: number;
  partiesRunning: number;
  playersOnline: number;
  parties: AdminParty[];
}

/** A song played, for the admin list (backend routes/admin.js playRow) */
export interface AdminPlay {
  /** the song_play event (a BIGINT, so a string) */
  id: string;
  songId: string;
  nickname: string | null;
  partyId: string | null;
  at: string;
  userAgent: string | null;
  title: string | null;
  artist: string | null;
  videoId: string | null;
  userId: number | null;
  seconds: number | null;
  score: number | null;
  ping: number | null;
  pingMax: number | null;
  /** the system and its version (backend userAgent.js osRelease) */
  os: string | null;
}

/** An account in the admin list (backend routes/admin.js userRow) */
export interface AdminUser {
  id: number;
  username: string;
  email: string | null;
  isAdmin: boolean;
  verified: boolean;
  hasPassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  scores: number;
  playsAsName: number;
  passkeys: number;
  userAgent: string | null;
  avatar: string | null;
  os: string | null;
}

/** A row of /admin/origins and /admin/devices: browser sessions and plays */
export interface VisitCount {
  sessions: number;
  plays: number;
}

/** GET /admin/origins */
export interface AdminOrigins {
  days: number;
  referrers?: (VisitCount & { source: string })[];
  /** our own links (logic/referrer.js); an older backend sends none */
  arrivals?: (VisitCount & { via: string })[];
  direct?: VisitCount;
  countries: (VisitCount & { country: string })[];
}

/** One name in a list of /admin/devices */
export interface DeviceCount extends VisitCount {
  name: string;
}

/** GET /admin/devices */
export interface AdminDevices {
  days: number;
  os: DeviceCount[];
  versions: DeviceCount[];
  browsers: DeviceCount[];
  devices: DeviceCount[];
}

/** GET /admin/discovery: how songs were found */
export interface AdminDiscovery {
  days: number;
  picks: { source: string; picks: number; browsers: number }[];
  searches: Partial<Record<'entry' | 'queue' | 'youtube', { sessions: number; hits: number; empty: number }>>;
  topMissed: { q: string; count: number }[];
  youtube: { match: string; lookups: number }[];
}

/** A share link kind's or a sharer's numbers (backend referrals.js) */
export interface ShareCounts {
  links: number;
  sent: number;
  arrivals: number;
  parties: number;
  singers: number;
  accounts: number;
}

/** GET /admin/shares */
export interface AdminShares {
  days: number;
  kinds: (ShareCounts & { kind: string })[];
  top: (Omit<ShareCounts, 'links'> & { userId: number | null; name: string | null; guest?: boolean })[];
}

export type SongReportStatus = 'open' | 'resolved' | 'dismissed';

/** A song report as the admin page lists it (backend songReports.js) */
export interface AdminSongReport {
  id: number;
  songId: string;
  kinds: string[];
  comment: string | null;
  context: { gap: number | null; videoTime: number | null; delayMs: number | null; delaySource: 'bleed' | 'fixed' | null; isHost: boolean | null; videoId: string | null } | null;
  userId: number | null;
  username: string | null;
  nickname: string | null;
  partyId: string | null;
  status: SongReportStatus;
  adminNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  userAgent: string | null;
  os: string | null;
  artist: string | null;
  title: string | null;
  videoId: string | null;
  openForSong: number;
}

export type AvatarReportStatus = 'open' | 'removed' | 'dismissed';

/** A reported picture (backend avatarReports.js), with the picture now and whether it is still the one reported */
export interface AdminAvatarReport {
  id: number;
  userId: number;
  username: string;
  reportedVersion: number;
  reporterId: number | null;
  reporter: string | null;
  place: 'profile' | 'party' | null;
  partyId: string | null;
  nickname: string | null;
  status: AvatarReportStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  openForUser: number;
  avatar: string | null;
  stillCurrent: boolean;
}

/** A list of reports with the count per status */
export type ReportsPage<R, S extends string> = Paged<R> & { counts: Record<S, number> };

/** The cost guards of chart generation */
export interface ChartJobLimits {
  maxActive: number;
  userDaily: number;
  daily: number;
  maxSeconds: number;
}

/** The AI chart tiles (backend chartJobsAdmin.js stats) */
export interface ChartJobStats {
  dayCounted: number;
  running: number;
  queued: number;
  doneWeek: number;
  rejectedWeek: number;
  failedWeek: number;
  medianReadyS: number | null;
  songs: number;
  playsWeek: number;
  limits: ChartJobLimits;
}

/** An AI chart job as the admin page lists it (backend chartJobsAdmin.js adminJob) */
export interface AdminChartJob {
  id: number;
  videoId: string;
  status: ChartJobStatus;
  title: string | null;
  artist: string | null;
  durationS: number | null;
  viewCount: number | null;
  userId: number | null;
  username: string | null;
  songId: string | null;
  songExists: boolean;
  plays: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  qa: { decision: string | null; reasons: string[]; predicted: number | null } | null;
  error: string | null;
  /** live while it runs (chartJobs.js progressAt) */
  progress: { position?: number; stage?: string; fraction?: number; eta?: number } | null;
  at: number | null;
}

/** GET /admin/chart-jobs */
export type ChartJobsPage = Paged<AdminChartJob> & { counts: Record<JobFilter, number>; stats: ChartJobStats };

/** Who may have AI charts made: what applies, who set it last, and what applies while nothing is stored */
export interface ChartAccessState {
  access: ChartAccessLevel;
  stored: { access: ChartAccessLevel; updatedAt: string; updatedBy: string | null } | null;
  fallback: { access: ChartAccessLevel; from: 'env' | 'default' };
  generator: boolean;
}

/** Every answer's envelope; a failed one carries the code and the English message */
interface Envelope {
  success?: boolean;
  code?: string;
  error?: string;
}

async function call<T = Envelope>(method: string, path: string, body?: unknown): Promise<T> {
  let r: Response;
  // A Blob (a picture) goes as itself, with its own type; anything else as JSON
  const raw = typeof Blob !== 'undefined' && body instanceof Blob;
  try {
    r = await fetch(`${apiUrl}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': raw ? body.type : 'application/json' } : undefined,
      body: body !== undefined ? (raw ? body : JSON.stringify(body)) : undefined,
    });
  } catch {
    throw new ApiError('network', 'Could not reach the server', 0);
  }
  let json: Envelope | null = null;
  try { json = await r.json(); } catch { /* no body */ }
  if (!r.ok || json?.success === false) throw new ApiError(json?.code ?? 'network', json?.error ?? `Request failed (${r.status})`, r.status);
  return json as T;
}
const get = <T = Envelope>(path: string) => call<T>('GET', path);
const post = <T = Envelope>(path: string, body: unknown = {}) => call<T>('POST', path, body);

// ── Session ──────────────────────────────────────────────────────────────

export const getMe = () => get<{ user: Me | null }>('/auth/me').then(j => j.user);
export const logout = () => post('/auth/logout');

/** What the address can sign in with: { exists, hasPasskey, hasPassword }. */
export const lookupEmail = (email: string) => post<EmailLookup>('/auth/lookup', { email });
/** Mail a six-digit code to the address. Resolves to { sent, devCode? } (the code itself only in development). */
export const startEmailCode = (email: string, lang: string) => post<EmailCodeSent>('/auth/email/start', { email, lang });
/**
 * Sign in with the mailed code. An address without an account resolves to
 * { needsUsername: true } until a display name is given, then creates it.
 * Otherwise { user, created }.
 */
export const verifyEmailCode = (email: string, code: string, username?: string | null) =>
  post<EmailVerifyResult>('/auth/email/verify', { email, code, guestId: getGuestId(), ...(username != null ? { username } : {}) });

// Every sign-in carries the browser's guest id: the scores sung as a guest on it become the account's.
export const loginPassword = (email: string, password: string) => post<{ user: Me }>('/auth/password/login', { email, password, guestId: getGuestId() }).then(j => j.user);
/** Rename and/or set a password: { username?, newPassword? }. Resolves to the updated user. */
export const updateAccount = (changes: { username?: string; newPassword?: string; statsVisibility?: Visibility; privacy?: Partial<PrivacySettings> }) =>
  call<{ user: Me }>('PATCH', '/auth/me', changes).then(j => j.user);
export const deleteAccount = () => call('DELETE', '/auth/me');
export const deletePasskey = (id: string) => call<{ passkeys: Passkey[] }>('DELETE', `/auth/passkeys/${encodeURIComponent(id)}`).then(j => j.passkeys);
/** Upload a profile picture (a square WebP or JPEG Blob, logic/avatarImage.js). Resolves to its path (logic/avatar.js). */
export const uploadAvatar = (blob: Blob) => call<{ avatar: string }>('PUT', '/me/avatar', blob).then(j => j.avatar);
export const removeAvatar = () => call('DELETE', '/me/avatar');
/**
 * Report someone's picture to the admins (anyone, guests too): `path` as the
 * server gave it, `where` { place: 'profile' | 'party', partyId?, nickname? }.
 * Resolves to { already } (true: your report on it is still open).
 */
export function reportAvatar(path: string, where: AvatarReportWhere = {}) {
  const pic = parseAvatarPath(path);
  if (!pic) return Promise.reject(new ApiError('no_avatar', 'No picture', 404));
  return post<{ already: boolean }>(`/users/${pic.userId}/avatar/reports`, { v: pic.version, guestId: getGuestId(), ...where });
}

// ── Songs ────────────────────────────────────────────────────────────────

/** Submit a timing correction for everyone (signed in). Resolves to { gap, sourceGap }. */
export const submitGapCorrection = (songId: string, gap: number) => call<{ gap: number; sourceGap: number | null }>('PATCH', `/songs/${encodeURIComponent(songId)}`, { gap }); // admins only

/** What is wrong with a song: { kinds, comment?, context?, nickname?, partyId?, sessionId? } (anyone, guests too). */
export const reportSong = (songId: string, report: SongReportRequest) => post<{ id: number; merged: boolean }>(`/songs/${encodeURIComponent(songId)}/reports`, report);

export const passkeysSupported = () => browserSupportsWebAuthn();
export const passkeyAutofillSupported = () => browserSupportsWebAuthnAutofill();

/** The user dismissed the browser's passkey prompt (not an error worth showing). */
export const isCancelled = (e: unknown) => (e as { name?: string } | null)?.name === 'NotAllowedError' || (e as { name?: string } | null)?.name === 'AbortError';

/** The options the server makes for a passkey prompt (backend routes/auth.js, @simplewebauthn/server), and its id for them */
interface PasskeyOptions<O> {
  challengeId: string;
  options: O;
}

/** Add a passkey to the signed-in account. */
export async function registerPasskey({ name }: { name?: string } = {}) {
  const { challengeId, options } = await post<PasskeyOptions<PublicKeyCredentialCreationOptionsJSON>>('/auth/passkey/register/options');
  const response = await startRegistration({ optionsJSON: options });
  return post<{ user: Me }>('/auth/passkey/register/verify', { challengeId, response, name }).then(j => j.user);
}

/**
 * Sign in with a passkey. Without an address the browser offers every passkey
 * it has for this site; with `useBrowserAutofill` that happens inside the
 * e-mail field's autocomplete (needs autocomplete="… webauthn").
 */
export async function loginPasskey({ email, useBrowserAutofill = false }: { email?: string; useBrowserAutofill?: boolean } = {}) {
  const { challengeId, options } = await post<PasskeyOptions<PublicKeyCredentialRequestOptionsJSON>>('/auth/passkey/login/options', email ? { email } : {});
  const response = await startAuthentication({ optionsJSON: options, useBrowserAutofill });
  return post<{ user: Me }>('/auth/passkey/login/verify', { challengeId, response, guestId: getGuestId() }).then(j => j.user);
}

// ── Scores ───────────────────────────────────────────────────────────────

export const getMyBest = () => get<{ data: BestScores }>('/me/best').then(j => j.data);
export const getMyScores = (offset = 0, limit = 20) => get<Paged<ScoreRow>>(`/me/scores?offset=${offset}&limit=${limit}`);
export const getSongScores = (songId: string) => get<{ data: SongScores }>(`/scores/song/${encodeURIComponent(songId)}`).then(j => j.data);

// ── People ───────────────────────────────────────────────────────────────

/** A public profile; `achievements` is the whole catalogue [{ key, goal, unlockedAt, progress? }] (progress on your own only) */
export const getProfile = (username: string) => get<{ data: Profile }>(`/users/${encodeURIComponent(username)}`).then(j => j.data);
export const searchUsers = (q: string) => get<{ data: UserSearchResult[] }>(`/users/search?q=${encodeURIComponent(q)}`).then(j => j.data);
export const getFriends = () => get<{ data: FriendsData }>('/friends').then(j => j.data);
export const getSuggestions = () => get<{ data: FriendSuggestion[] }>('/friends/suggestions').then(j => j.data);
export const requestFriend = (username: string) => post<{ relation: Relation }>('/friends/request', { username }).then(j => j.relation);
export const acceptFriend = (username: string) => post<{ relation: Relation }>('/friends/accept', { username }).then(j => j.relation);
export const removeFriend = (username: string) => call<{ relation: Relation }>('DELETE', `/friends/${encodeURIComponent(username)}`).then(j => j.relation);
/**
 * { friendRequests: [{ username, createdAt, isNew }], achievements: [{ key, unlockedAt, isNew }], unseen }:
 * pending requests to you and the achievements you recently earned, each newest first
 */
export const getNotifications = () => get<{ data: Notifications }>('/notifications').then(j => j.data);
/** Everything up to `until` (the newest createdAt / unlockedAt shown) has been seen */
export const markNotificationsSeen = (until: string) => post('/notifications/seen', { until });

// ── Admin (routes/admin.js; 403 for everyone without the flag) ───────────

/** Numbers for the tiles plus every party running right now. */
export const getAdminOverview = () => get<{ data: AdminOverview }>('/admin/overview').then(j => j.data);
/** One row of counts per day (in Berlin) for the last `days` and the `days` before, with each range's totals (logic/trends.js reads them). */
export const getAdminTrends = (days = 30) => get<{ data: TrendsData }>(`/admin/trends?days=${days}`).then(j => j.data);
export const getAdminPlays = (offset = 0, limit = 20) => get<Paged<AdminPlay>>(`/admin/plays?offset=${offset}&limit=${limit}`);
/** Newest accounts, or those whose name or address starts with q. */
export const getAdminUsers = (q = '', offset = 0, limit = 20) => get<Paged<AdminUser>>(`/admin/users?q=${encodeURIComponent(q)}&offset=${offset}&limit=${limit}`);
/** Appoint or demote; resolves to the account as the list shows it. */
export const adminSetAdmin = (id: number, isAdmin: boolean) => call<{ data: AdminUser | null }>('PATCH', `/admin/users/${id}`, { isAdmin }).then(j => j.data);
export const adminRevokeSessions = (id: number) => call('DELETE', `/admin/users/${id}/sessions`);
export const adminDeleteUser = (id: number) => call('DELETE', `/admin/users/${id}`);
/** Remove someone's profile picture (moderation). */
export const adminRemoveAvatar = (id: number) => call('DELETE', `/admin/users/${id}/avatar`);
export const adminCloseParty = (partyId: string) => post(`/admin/parties/${encodeURIComponent(partyId)}/close`);
/** Where the visitors of the last `days` came from: { days, referrers, arrivals (our own links), direct, countries }. */
export const getAdminOrigins = (days = 30) => get<{ data: AdminOrigins }>(`/admin/origins?days=${days}`).then(j => j.data);
/**
 * Share links of the last `days` (backend referrals.js): { days, kinds: [{ kind, links, sent, arrivals, parties, singers, accounts }],
 * top: [{ userId, name, guest, sent, arrivals, parties, singers, accounts }] }.
 */
export const getAdminShares = (days = 28) => get<{ data: AdminShares }>(`/admin/shares?days=${days}`).then(j => j.data);
/** What the players of the last `days` ran on: { days, os, browsers, devices }, each [{ name, sessions, plays }]. */
export const getAdminDevices = (days = 30) => get<{ data: AdminDevices }>(`/admin/devices?days=${days}`).then(j => j.data);
/** How songs were found in the last `days`: { days, picks, searches, topMissed, topAsked, youtube }. */
export const getAdminDiscovery = (days = 30) => get<{ data: AdminDiscovery }>(`/admin/discovery?days=${days}`).then(j => j.data);
/** { data: reports, hasMore, counts: { open, resolved, dismissed } }; status 'open' | 'resolved' | 'dismissed' | 'all' */
export const getAdminReports = (status: SongReportStatus | 'all' = 'open', offset = 0, limit = 20) =>
  get<ReportsPage<AdminSongReport, SongReportStatus>>(`/admin/reports?status=${status}&offset=${offset}&limit=${limit}`);
export const adminReviewReport = (id: number, status: SongReportStatus, note?: string) => call<{ data: { id: number; songId: string; status: SongReportStatus } }>('PATCH', `/admin/reports/${id}`, { status, ...(note ? { note } : {}) }).then(j => j.data);
/** Reported profile pictures: open (default) | removed | dismissed | all. */
export const getAdminAvatarReports = (status: AvatarReportStatus | 'all' = 'open', offset = 0, limit = 20) =>
  get<ReportsPage<AdminAvatarReport, AvatarReportStatus>>(`/admin/avatar-reports?status=${status}&offset=${offset}&limit=${limit}`);
/** Dismiss a picture report, or open it again ('dismissed' | 'open'); removing the picture is adminRemoveAvatar. */
export const adminReviewAvatarReport = (id: number, status: 'dismissed' | 'open') => call<{ data: { id: number; userId: string; status: AvatarReportStatus } }>('PATCH', `/admin/avatar-reports/${id}`, { status }).then(j => j.data);
/** AI karaoke charts: { data: jobs, hasMore, counts (per filter), stats (the tiles, with the limits) }; status 'all' | 'active' | 'done' | 'rejected' | 'failed' */
export const getAdminChartJobs = (status: JobFilter = 'all', offset = 0, limit = 20) => get<ChartJobsPage>(`/admin/chart-jobs?status=${status}&offset=${offset}&limit=${limit}`);
/** Who may have AI charts made: { access, stored: { access, updatedAt, updatedBy } | null, fallback: { access, from }, generator } */
export const getAdminChartAccess = () => get<{ data: ChartAccessState }>('/admin/chart-jobs/access').then(j => j.data);
export const adminSetChartAccess = (access: ChartAccessLevel) => call<{ data: ChartAccessState }>('PUT', '/admin/chart-jobs/access', { access }).then(j => j.data);
