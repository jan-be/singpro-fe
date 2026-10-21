import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import WrapperPage from './WrapperPage';
import StarRating from '../components/StarRating';
import Avatar from '../components/Avatar';
import { useAvatarEditor } from '../components/AvatarEditor';
import ReportPicture from '../components/ReportPicture';
import { LockIcon, DuetIcon as FriendsIcon } from '../components/Icons';
import { Section, TrashIcon, btn, headerCard, input, listBox, rowBox, sm, stageLight, useDate, useSecondClick, type Note } from '../components/ProfileParts';
import { useNotifications } from '../logic/NotificationsContext';
import { statsVisibilityOf, isPrivateProfile } from '../logic/statsPrivacy';
import { useAuth } from '../logic/AuthContext';
import { completionText, starsFor } from '../logic/scoreScale';
import { creditLine, fraction, profileList, progressText } from '../logic/achievements';
import { profileView, sungTime } from '../logic/profileStats';
import {
  getProfile, getFriends, getSuggestions, searchUsers, requestFriend, acceptFriend, removeFriend, getMyScores,
} from '../logic/authApi';
import { appDomain } from '../GlobalConsts';
import { deleteTake, makeShareVideo, scoreMelody, takeAudioBlob, takeAudioUrl } from '../logic/takes';
import { footage, segmentFile } from '../logic/cameraClip';
import { shareLinkFor } from '../logic/shareLinks';
import { cardNames, loadSongArt } from '../logic/shareImage';
import { playerHue } from '../logic/playerColor';
import { useShareCardDrawer } from '../components/useShareCardDrawer';
import ShareDialog, { type DialogShare } from '../components/ShareDialog';
import type {
  FriendSuggestion, FriendsData, PrivateProfile as PrivateProfileData, Profile, Relation, ScoreRow, Take,
  UserSearchResult,
} from '../logic/authApi';
import type { AchievementItem, ProfileAchievement } from '../logic/achievements';
import type { CardMelodyNote } from '../logic/takes';

/** A song in one of the profile's lists: a saved score (ScoreRow) or a song played (PlayedRow) */
type ListedSong = Pick<ScoreRow, 'songId' | 'title' | 'artist' | 'videoId'> & {
  id?: string;
  score: number | null;
  stars?: number | null;
  part?: number | null;
  partial?: boolean;
  completion?: number | null;
  takes?: Take[];
};

// ── Pieces ─────────────────────────────────────────────────────────────

const StatTile = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="rounded-2xl bg-panel border border-white/10 px-3 py-3.5 text-center min-w-0">
    <div className="text-2xl font-semibold tracking-[-0.02em] tabular-nums leading-tight text-white truncate">{value}</div>
    <div className="text-xs text-white/55 mt-1 truncate">{label}</div>
  </div>
);

/**
 * One song: thumbnail, title, score and stars (and, for a duet, the part
 * sung); links to the song. A played song without a score says so, and a
 * partial play shows how far it got instead of stars. `actions`: buttons
 * beside the link (on your own profile: sharing the play, its recording; OwnRowActions).
 */
const SongRow = ({ row, date, actions = null }: { row: ListedSong; date?: string; actions?: React.ReactNode }) => {
  const { t, i18n } = useTranslation();
  // A play stopped too early to count as the song's (the server says which):
  // its score is out of the whole song, so it gets no stars, and the row says
  // how far it got instead
  const stoppedAt = row.partial && row.completion != null && Number.isFinite(row.completion) ? row.completion : null;
  const partial = stoppedAt !== null;
  const link = (
  <Link to={`/sing/${row.songId}`} className={`flex items-center gap-3 py-2.5 no-underline ${actions ? 'flex-1 min-w-0 pl-3 pr-1' : 'px-3 hover:bg-white/[0.04] transition-colors'}`}>
    {row.videoId
      ? <img src={`https://i.ytimg.com/vi/${row.videoId}/mqdefault.jpg`} alt="" className="w-16 h-9 rounded-lg object-cover flex-shrink-0 bg-white/[0.06] ring-1 ring-inset ring-white/10" loading="lazy" />
      : <div className="w-16 h-9 rounded-lg bg-white/[0.06] flex-shrink-0" />}
    <div className="flex-1 min-w-0">
      <div className="text-sm font-medium text-white truncate">{row.title ?? row.songId}</div>
      <div className="text-xs text-white/50 truncate">
        {row.artist}
        {row.part ? <span className="text-hot/85"> · {row.part === 2 ? t('party.duetP2') : t('party.duetP1')}</span> : null}
        {stoppedAt !== null ? <span className="text-white/70" title={t('profile.stoppedHint')}> · {t('profile.stoppedAt', { percent: completionText(stoppedAt, i18n.language) })}</span> : null}
        {date ? <span className="text-white/35"> · {date}</span> : null}
      </div>
    </div>
    {row.score == null ? (
      <div className="text-xs text-white/40 flex-shrink-0">{t('profile.notScored')}</div>
    ) : (
      <div className="text-right flex-shrink-0" title={partial ? t('profile.stoppedHint') : undefined}>
        <div className={`font-mono font-medium text-sm tabular-nums leading-tight ${partial ? 'text-white/60' : 'text-white'}`}>{row.score.toLocaleString()}</div>
        {!partial && <StarRating stars={row.stars ?? starsFor(row.score)} size={12} />}
      </div>
    )}
  </Link>
  );
  if (!actions) return link;
  return <div className="flex items-center hover:bg-white/[0.04] transition-colors">{link}{actions}</div>;
};

// ── Your recordings ────────────────────────────────────────────────────

const PlayIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z" /></svg>;
const PauseIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4.5" width="4" height="15" rx="1" /><rect x="14" y="4.5" width="4" height="15" rx="1" /></svg>;
const Spinner = () => <span aria-hidden="true" className="block w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />;

/**
 * One player for the page's recordings, one play at a time: a play's takes
 * in a row (more than one when the microphone was closed and opened again
 * during it). The first listen waits a moment while the server mixes the
 * take over the song's backing track (routes/takes.ts).
 * now: { key (the first take's id), state: 'loading' | 'playing' | 'paused' | 'error' } or null.
 */
const useTakePlayer = () => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<Take[]>([]);
  const [now, setNow] = useState<{ key: string; state: 'loading' | 'playing' | 'paused' | 'error' } | null>(null);
  useEffect(() => () => { audioRef.current?.pause(); audioRef.current = null; }, []);
  const audio = () => {
    if (audioRef.current) return audioRef.current;
    const a = new Audio();
    a.preload = 'auto';
    a.addEventListener('playing', () => setNow(n => n && { ...n, state: 'playing' }));
    a.addEventListener('waiting', () => setNow(n => n && { ...n, state: 'loading' }));
    a.addEventListener('pause', () => setNow(n => (n?.state === 'playing' ? { ...n, state: 'paused' } : n)));
    a.addEventListener('ended', () => {
      const next = queueRef.current.shift();
      if (next) { a.src = takeAudioUrl(next.id, next.mix); a.play().catch(() => {}); } else setNow(null);
    });
    a.addEventListener('error', () => setNow(n => n && { ...n, state: 'error' }));
    audioRef.current = a;
    return a;
  };
  const toggle = (takes: Take[]) => {
    const a = audio();
    const key = takes[0].id;
    if (now?.key === key && now.state !== 'error') {
      if (a.paused) a.play().catch(() => {}); else a.pause();
      return;
    }
    queueRef.current = takes.slice(1);
    setNow({ key, state: 'loading' });
    a.src = takeAudioUrl(key, takes[0].mix);
    a.play().catch(e => { if (e?.name !== 'AbortError') setNow({ key, state: 'error' }); });
  };
  const stop = (ids: (string | undefined)[]) => {
    if (now && ids.includes(now.key)) { audioRef.current?.pause(); setNow(null); }
  };
  return { now, toggle, stop };
};
type TakePlayer = ReturnType<typeof useTakePlayer>;

const VideoIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="6" width="14" height="12" rx="2" /><path d="M16 10l6-3v10l-6-3z" />
  </svg>
);
const ImageIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
  </svg>
);
const AudioIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
  </svg>
);
const ShareIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" />
  </svg>
);

/**
 * Share one of your plays from the profile, long after its score screen. A
 * play with a recording offers a choice (a small menu at the button): the
 * share video (the song's card with your score as its picture, the best
 * moment of the take over the backing track), the audio (the whole take as
 * it plays here, mixed with the backing track) or the card's image. A play
 * without one shares the card (alone on it: the party's board is not kept). Each carries a
 * link with its own share code (logic/shareLinks.ts: the same one each time
 * for the same thing, so the card stays the same picture). A take this tab
 * filmed with influencer mode's camera (logic/cameraClip.ts) makes the video
 * with the singer in it, or the card alone at the dialog's choice. Each takes a
 * moment, so it opens in ShareDialog (`onShare`) to share from there; what
 * was made is kept, so asked again it opens at once.
 */
const ShareSongButton = ({ row, score, scoreId, username, onShare }: {
  row: ListedSong; score: number; scoreId: string; username: string; onShare: (share: DialogShare) => void;
}) => {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ top?: number; bottom?: number; right: number } | null>(null); // where the choice opens: { top | bottom, right } (fixed)
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const made = useRef<Record<string, { key: string; file: File; data: ShareData; link: string }>>({}); // kind -> { key, file, data }
  const drawer = useShareCardDrawer();
  const take = row.takes?.length ? row.takes.reduce((a, b) => ((b.duration ?? 0) > (a.duration ?? 0) ? b : a)) : null;
  const label = take ? t('share.share') : t('share.shareScore');

  // the menu closes on a click elsewhere, Escape, scrolling or resizing
  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    const outside = (e: MouseEvent) => {
      const target = e.target instanceof Node ? e.target : null;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) close();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); buttonRef.current?.focus(); } };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menu]);
  useEffect(() => { if (menu) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(); }, [menu]);

  // (the button is only there for a play with a score: OwnRowActions)
  const texts = (names: ReturnType<typeof cardNames>, songUrl: string) => {
    const points = score.toLocaleString();
    return {
      title: t('share.shareTitle', { score: points, title: names.title ?? appDomain }),
      text: t('share.shareText', { title: names.title, artist: names.artist, score: points, url: songUrl }),
    };
  };
  const share = async (kind: 'video' | 'audio' | 'card', withCamera = true) => {
    setMenu(null);
    if (busy) return;
    const segment = kind === 'video' && withCamera ? footage.get(take?.id) : null;
    // the video's choice in the dialog: with the camera or the card alone (when the camera filmed it)
    const camera = kind === 'video' && footage.get(take?.id) ? { on: !!segment, onChange: (on: boolean) => { share('video', on); } } : undefined;
    const slot = segment ? 'video:camera' : kind;
    const key = take?.id ?? 'card';
    const kept = made.current[slot];
    if (kept?.key === key) {
      onShare({ file: kept.file, data: kept.data, link: kept.link, url: URL.createObjectURL(kept.file), camera });
      return;
    }
    setBusy(true);
    let art: Awaited<ReturnType<typeof loadSongArt>> | null = null;
    try {
      // (a song gone from the catalogue has a null title and artist, which cardNames passes through: texts() reads `?? appDomain`)
      const names = cardNames(row, i18n.language);
      // What is shared: the card, or the take's video or audio (the menu offers those only with a take)
      const target = kind === 'card' ? { kind } : take && { kind, take };
      if (!target) throw new Error('No recording to share');
      const songUrl = await shareLinkFor(target.kind === 'card'
        ? { kind: target.kind, songId: row.songId, scoreId }
        : { kind: target.kind, songId: row.songId, recordingId: target.take.id });
      const base = `singspree-${(row.title ?? 'score').replace(/\W+/g, '-')}`;
      let file: File;
      if (target.kind === 'audio') {
        // the take as it plays here (most often already in the browser's cache)
        const blob = await takeAudioBlob(target.take.id, target.take.mix);
        // .m4a as audio/x-m4a: the name and type Chrome's share sheet takes for this sound
        file = new File([blob], `${base}.m4a`, { type: 'audio/x-m4a' });
      } else {
        let melody: CardMelodyNote[] | null;
        [art, melody] = await Promise.all([loadSongArt(row.videoId).catch(() => null), scoreMelody(scoreId).catch(() => null)]);
        const me = { username, score, stars: row.stars ?? starsFor(score), rank: 1, ...(row.part ? { part: row.part } : {}) };
        const hueOf = (name: string) => playerHue(null, name);
        const card = { names, me, ranked: [me], rows: [me], more: 0, hueOf, melody, art: art && { aspect: art.aspect }, songUrl, t };
        const paint = { art, hue: hueOf(username) };
        // drawVideo's pictures for the video, draw's image for the card
        const blob = target.kind === 'video'
          ? await makeShareVideo({ recordingId: target.take.id, ...await drawer.drawVideo(card, paint), camera: segment ? segmentFile(segment) : null })
          : await drawer.draw(card, paint);
        file = new File([blob], `${base}.${target.kind === 'video' ? 'mp4' : 'jpg'}`, { type: target.kind === 'video' ? 'video/mp4' : 'image/jpeg' });
      }
      const data = { ...texts(names, songUrl), files: [file] };
      made.current[slot] = { key, file, data, link: songUrl };
      onShare({ url: URL.createObjectURL(file), file, data, link: songUrl, camera });
    } catch (e) {
      console.error('Sharing from the profile failed:', e);
      if (take) onShare({ error: true, kind });
    } finally {
      art?.dispose?.();
      setBusy(false);
    }
  };
  const open = () => {
    if (busy) return;
    if (!take) { share('card'); return; }
    if (menu) { setMenu(null); return; }
    const button = buttonRef.current;
    if (!button) return; // (it is the button clicked)
    const r = button.getBoundingClientRect();
    // below the button, or above it when the row is near the bottom of the window
    const right = Math.max(8, window.innerWidth - r.right);
    setMenu(window.innerHeight - r.bottom > 140 ? { top: r.bottom + 6, right } : { bottom: window.innerHeight - r.top + 6, right });
  };
  return (
    <>
      <button type="button" ref={buttonRef} onClick={open} disabled={busy} aria-busy={busy} aria-label={label} title={label} data-row-share=""
        {...(take ? { 'aria-haspopup': 'menu', 'aria-expanded': !!menu } : {})}
        className={`btn-icon w-9 h-9 ${busy || menu ? 'text-hot' : ''}`}>
        {busy ? <Spinner /> : <ShareIcon />}
      </button>
      {menu && createPortal(
        <div ref={menuRef} role="menu" aria-label={label} data-share-menu="" className="pop fixed z-[90] w-48 p-1.5" style={menu}>
          <button type="button" role="menuitem" onClick={() => share('video')} data-share-kind="video" className="menu-item">
            <VideoIcon />{t('share.shareVideo')}
          </button>
          <button type="button" role="menuitem" onClick={() => share('audio')} data-share-kind="audio" className="menu-item">
            <AudioIcon />{t('share.shareAudio')}
          </button>
          <button type="button" role="menuitem" onClick={() => share('card')} data-share-kind="card" className="menu-item">
            <ImageIcon />{t('share.shareImage')}
          </button>
        </div>,
        document.body,
      )}
      {drawer.element}
    </>
  );
};

/** Your own play's buttons: share it, and when it has a recording, listen to or delete that */
const OwnRowActions = ({ row, username, player, onDeleted, onShare }: {
  row: ListedSong; username: string; player: TakePlayer; onDeleted: (ids: string[]) => void; onShare: (share: DialogShare) => void;
}) => (
  <div className="flex items-center gap-1 pr-2 flex-shrink-0">
    {row.score != null && row.id != null && <ShareSongButton row={row} score={row.score} scoreId={row.id} username={username} onShare={onShare} />}
    {row.takes?.length ? <TakeActions takes={row.takes} player={player} onDeleted={onDeleted} /> : null}
  </div>
);

/** A recording of a play: listen (over the backing track), and on your own profile delete it */
const TakeActions = ({ takes, player, onDeleted }: { takes: Take[]; player: TakePlayer; onDeleted?: (ids: string[]) => void }) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const confirm = useSecondClick();
  const state = player.now?.key === takes[0].id ? player.now.state : null;
  const label = state === 'playing' ? t('profile.pauseRecording') : state === 'error' ? t('profile.recordingFailed') : t('profile.playRecording');
  // (the delete button, there only with onDeleted, passes it)
  const remove = async (deleted: (ids: string[]) => void) => {
    setBusy(true);
    const ids = takes.map(tk => tk.id);
    try {
      for (const id of ids) await deleteTake(id);
      player.stop(ids);
      deleted(ids);
    } catch {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" onClick={() => player.toggle(takes)} aria-label={label} title={label} data-take-play=""
        className={`btn-icon w-9 h-9 ${state === 'error' ? 'text-red-300' : state ? 'text-hot' : ''}`}>
        {state === 'loading' ? <Spinner /> : state === 'playing' ? <PauseIcon /> : <PlayIcon />}
      </button>
      {onDeleted && <button type="button" onClick={() => confirm.press(() => remove(onDeleted))} disabled={busy} data-take-delete="" aria-pressed={confirm.armed}
        aria-label={confirm.armed ? t('profile.deleteRecordingConfirm') : t('profile.deleteRecording')} title={t('profile.deleteRecording')}
        className={confirm.armed
          ? 'h-9 px-3 rounded-full text-xs font-semibold whitespace-nowrap bg-red-500/20 text-red-200 ring-1 ring-inset ring-red-400/40 animate-pulse cursor-pointer'
          : 'btn-icon w-9 h-9 hover:text-red-300'}>
        {confirm.armed ? t('profile.deleteRecordingConfirm') : <TrashIcon />}
      </button>}
    </>
  );
};

/** Rows without the takes `ids` (deleted; null: all of them) */
const withoutTakes = (rows: ScoreRow[], ids: string[] | null) => rows.map((r): ScoreRow => {
  if (!r.takes?.some(tk => ids === null || ids.includes(tk.id))) return r;
  const takes = ids === null ? [] : r.takes.filter(tk => !ids.includes(tk.id));
  const { takes: _, ...rest } = r;
  return takes.length ? { ...rest, takes } : rest;
});

/** Add / accept / cancel / remove, depending on the relation seen from the viewer. */
const FriendButton = ({ username, relation, onChange, compact = false }: { username: string; relation: Relation; onChange: (relation: Relation) => void; compact?: boolean }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  // In a list row the buttons are the small size; on the profile header the regular one
  const b = compact ? { primary: sm(btn.primary), quiet: sm(btn.quiet), danger: sm(btn.danger) } : btn;
  if (!user) {
    // ?add=1 sends the request as soon as they are signed in
    return <Link to={`/login?next=${encodeURIComponent(`/u/${username}?add=1`)}`} className={b.primary}>{t('friends.add')}</Link>;
  }
  const act = (fn: (username: string) => Promise<Relation>) => async () => {
    setBusy(true);
    try { onChange(await fn(username)); } catch { /* transient; the page state stays */ } finally { setBusy(false); }
  };
  switch (relation) {
    case 'friends':
      return (
        <span className="inline-flex items-center gap-3">
          {!compact && <span className="text-sm text-emerald-300 font-medium">✓ {t('friends.friends')}</span>}
          <button type="button" disabled={busy} onClick={act(removeFriend)} className={b.danger}>{t('friends.remove')}</button>
        </span>
      );
    case 'outgoing':
      return <button type="button" disabled={busy} onClick={act(removeFriend)} className={b.quiet} title={t('friends.requested')}>{t('friends.cancelRequest')}</button>;
    case 'incoming':
      return (
        <span className="inline-flex items-center gap-2">
          <button type="button" disabled={busy} onClick={act(acceptFriend)} className={b.primary}>{t('friends.accept')}</button>
          <button type="button" disabled={busy} onClick={act(removeFriend)} className={b.quiet}>{t('friends.decline')}</button>
        </span>
      );
    default:
      return <button type="button" disabled={busy} onClick={act(requestFriend)} className={b.primary}>{t('friends.add')}</button>;
  }
};

// ── Achievements ───────────────────────────────────────────────────────

/**
 * One achievement: its icon, its name (a nod to a song, credited under it),
 * what it takes, and when it was earned or, on your own profile, how far
 * along you are.
 */
const AchievementCard = ({ item, date }: { item: ProfileAchievement; date: string }) => {
  const { t, i18n } = useTranslation();
  const { info } = item;
  const done = Boolean(item.unlockedAt);
  const showProgress = !done && item.progress != null;
  return (
    <li
      className={`flex items-start gap-3 rounded-2xl border px-3.5 py-3 ${done ? 'bg-panel bg-[linear-gradient(135deg,rgba(255,92,214,0.11),rgba(192,75,255,0.04)_55%,transparent)] border-white/10' : 'bg-white/[0.025] border-white/[0.06]'}`}
      title={done ? t('achievements.unlockedOn', { date }) : t('achievements.locked')}
    >
      <span
        aria-hidden="true"
        className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-xl ${done ? 'bg-gradient-to-br from-hot/30 to-neon-purple/25 ring-1 ring-inset ring-white/15' : 'bg-white/[0.06] grayscale opacity-40'}`}
      >
        {info.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`text-sm font-semibold tracking-[-0.01em] truncate ${done ? 'text-white' : 'text-white/55'}`}>{info.name}</span>
          {done && <span className="text-[11px] text-white/40 flex-shrink-0">{date}</span>}
          {showProgress && <span className="text-[11px] tabular-nums text-white/45 flex-shrink-0">{progressText(item, i18n.language)}</span>}
        </div>
        <div className={`text-[11px] truncate ${done ? 'text-hot/80' : 'text-white/35'}`}>♪ {creditLine(info)}</div>
        <div className={`text-xs mt-0.5 ${done ? 'text-white/65' : 'text-white/40'}`}>
          {!done && <span className="sr-only">{t('achievements.locked')}: </span>}
          {t(`achievements.desc.${item.key}`)}
        </div>
        {showProgress && (
          <div className="h-1 rounded-full bg-white/10 mt-2 overflow-hidden" aria-hidden="true">
            <div className="h-full rounded-full bg-gradient-to-r from-[#ff5cd6] to-[#c04bff]" style={{ width: `${Math.round(fraction(item) * 100)}%` }} />
          </div>
        )}
      </div>
    </li>
  );
};

/**
 * What the singer earned; on your own profile also the few you are closest
 * to. "Show all" unfolds the whole catalogue (the rest greyed out).
 */
const AchievementsSection = ({ items, isMe, username }: { items: AchievementItem[]; isMe: boolean; username: string }) => {
  const { t } = useTranslation();
  const fmt = useDate();
  const [expanded, setExpanded] = useState(false);
  const all = profileList(items, { expanded: true });
  if (all.length === 0) return null;
  const shown = profileList(items, { expanded });
  const unlocked = all.filter(a => a.unlockedAt).length;
  return (
    <Section
      id="achievements"
      title={t('achievements.title')}
      aside={<span className="text-xs text-white/45 tabular-nums">{t('achievements.count', { unlocked, total: all.length })}</span>}
    >
      {unlocked === 0 && !expanded && (
        <p className="text-sm text-white/50 mb-3">{isMe ? t('achievements.none') : t('achievements.noneOther', { username })}</p>
      )}
      {shown.length > 0 && (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {shown.map(a => <AchievementCard key={a.key} item={a} date={fmt(a.unlockedAt)} />)}
        </ul>
      )}
      {(expanded || shown.length < all.length) && (
        <button type="button" onClick={() => setExpanded(e => !e)} className={`${sm(btn.quiet)} mt-3`} aria-expanded={expanded}>
          {expanded ? t('achievements.showLess') : t('achievements.showAll')}
        </button>
      )}
    </Section>
  );
};

// ── Own profile: friends ───────────────────────────────────────────────

const FriendsSection = () => {
  const { t } = useTranslation();
  const [data, setData] = useState<FriendsData>({ friends: [], incoming: [], outgoing: [] });
  const [suggested, setSuggested] = useState<FriendSuggestion[]>([]); // people you sang with, not friends yet
  const [q, setQ] = useState('');
  const [results, setResults] = useState<UserSearchResult[] | null>(null);
  // The bell answers requests too and notices new ones: reload when they change
  const { requestsKey, refresh: refreshNotifications } = useNotifications();

  const reload = useCallback(() => {
    getFriends().then(setData).catch(() => {});
    getSuggestions().then(setSuggested).catch(() => {});
  }, []);
  useEffect(() => { reload(); }, [reload, requestsKey]);

  // (a newer term clears the older one's timer: the effect's cleanup)
  useEffect(() => {
    const term = q.trim();
    if (!term) { setResults(null); return; }
    const timer = setTimeout(() => searchUsers(term).then(setResults).catch(() => setResults([])), 250);
    return () => clearTimeout(timer);
  }, [q]);

  const changed = (username: string) => (relation: Relation) => {
    setResults(r => r?.map(x => (x.username === username ? { ...x, relation } : x)) ?? r);
    reload();
    refreshNotifications();
  };

  const nameLink = (username: string, avatar: string | null) => (
    <Link to={`/u/${encodeURIComponent(username)}`} className="flex items-center gap-2.5 min-w-0 text-sm font-medium text-white no-underline hover:text-white/75">
      <Avatar username={username} src={avatar} size={28} /><span className="truncate">{username}</span>
    </Link>
  );

  return (
    <Section id="friends" title={t('friends.title')} aside={<span className="text-xs text-white/45">{t('friends.count', { count: data.friends.length })}</span>}>
      <div className="relative">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/45 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={t('friends.search')}
          className={`${input} h-11 pl-10`}
          autoComplete="off"
        />
      </div>
      {results && (
        <ul className={`mt-2 ${listBox}`}>
          {results.length === 0 && <li className="px-4 py-3 text-sm text-white/45">{t('friends.noResults')}</li>}
          {results.map(r => (
            <li key={r.username} className={rowBox}>
              {nameLink(r.username, r.avatar)}
              <FriendButton username={r.username} relation={r.relation} onChange={changed(r.username)} compact />
            </li>
          ))}
        </ul>
      )}

      {suggested.length > 0 && (
        <div className="mt-5">
          <div className="pop-label mb-2">{t('profile.suggestions')}</div>
          <ul className={listBox}>
            {suggested.map(s => (
              <li key={s.username} className={rowBox}>
                {nameLink(s.username, s.avatar)}
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-xs text-white/50 hidden sm:inline">{t('profile.songsTogether', { count: s.songsTogether })}</span>
                  <FriendButton username={s.username} relation={null} onChange={changed(s.username)} compact />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(data.incoming.length > 0 || data.outgoing.length > 0) && (
        <div className="mt-5">
          <div className="pop-label mb-2">{t('friends.requests')}</div>
          <ul className={listBox}>
            {data.incoming.map(r => (
              <li key={`in-${r.username}`} className={`${rowBox} bg-hot/[0.06]`}>
                {nameLink(r.username, r.avatar)}
                <FriendButton username={r.username} relation="incoming" onChange={changed(r.username)} compact />
              </li>
            ))}
            {data.outgoing.map(r => (
              <li key={`out-${r.username}`} className={rowBox}>
                {nameLink(r.username, r.avatar)}
                <FriendButton username={r.username} relation="outgoing" onChange={changed(r.username)} compact />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5">
        {data.friends.length === 0
          ? <p className="text-sm text-white/50">{t('friends.none')}</p>
          : (
            <ul className={listBox}>
              {data.friends.map(f => (
                <li key={f.username} className={rowBox}>
                  {nameLink(f.username, f.avatar)}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {/* A friend who keeps their stats private comes without numbers */}
                    {f.private ? (
                      <span className="inline-flex items-center gap-1 text-xs text-white/45" title={t('privacy.profileTitle')}><LockIcon size={12} />{t('privacy.private')}</span>
                    ) : (
                      <>
                        <span className="text-xs text-white/50 hidden sm:inline">{t('profile.songsSung')}: <span className="text-white tabular-nums">{f.songsSung}</span></span>
                        <span className="text-xs text-white/70 tabular-nums"><span className="text-yellow-400">★</span> {f.totalStars}</span>
                      </>
                    )}
                    <FriendButton username={f.username} relation="friends" onChange={changed(f.username)} compact />
                  </div>
                </li>
              ))}
            </ul>
          )}
      </div>
    </Section>
  );
};

// ── Someone else's private profile ─────────────────────────────────────

/**
 * A profile whose owner keeps their stats private (logic/statsPrivacy.ts):
 * the header as everyone sees it, without the stars, and a note where the
 * numbers, achievements and songs would be. Friends see it the same way.
 */
const PrivateProfile = ({ data, onRelation }: { data: PrivateProfileData; onRelation: (relation: Relation) => void }) => {
  const { t } = useTranslation();
  const fmt = useDate();
  const { user } = data;
  return (
    <WrapperPage>
      <div className={headerCard}>
        <div className={stageLight} aria-hidden="true" />
        <Avatar username={user.username} src={user.avatar} size={72} className="text-3xl relative" />
        <div className="relative flex-1 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-[-0.02em] text-white truncate">{user.username}</h1>
          <div className="text-sm text-white/55 mt-0.5">{t('profile.memberSince', { date: fmt(user.createdAt) })}</div>
          {user.avatar && <ReportPicture path={user.avatar} where={{ place: 'profile' }} className="mt-1.5" />}
        </div>
        <div className="relative w-full pl-[88px] sm:w-auto sm:pl-0 sm:flex-shrink-0">
          <FriendButton username={user.username} relation={data.relation} onChange={onRelation} />
        </div>
      </div>

      <div className="mt-3 sm:mt-4 rounded-2xl bg-panel border border-white/10 px-6 py-10 text-center">
        <span aria-hidden="true" className="mx-auto w-12 h-12 rounded-full grid place-items-center bg-white/[0.07] ring-1 ring-inset ring-white/10 text-white/70">
          {data.friendsOnly ? <FriendsIcon size={20} /> : <LockIcon size={20} />}
        </span>
        <h2 className="mt-4 text-lg font-semibold tracking-[-0.02em] text-white">{t(data.friendsOnly ? 'privacy.friendsOnlyTitle' : 'privacy.profileTitle')}</h2>
        <p className="mt-1 text-sm text-white/55 max-w-sm mx-auto">{t(data.friendsOnly ? 'privacy.friendsOnlyText' : 'privacy.profileText', { username: user.username })}</p>
      </div>
    </WrapperPage>
  );
};

// ── Page ───────────────────────────────────────────────────────────────

/** The parts of your settings (pages/SettingsPage.tsx) that were on the profile before */
const SETTINGS_HASHES = ['#privacy', '#account'];

const GearIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const ProfilePage = () => {
  const { t, i18n } = useTranslation();
  const fmt = useDate();
  const { username = '' } = useParams(); // the route's own segment: always there
  const [params, setParams] = useSearchParams();
  const { user, loading: authLoading, refresh: refreshMe } = useAuth();
  const [data, setData] = useState<Profile | null>(null);
  // Your own picture: the header shows the new one at once, the account menu after /auth/me
  const [avatarNote, setAvatarNote] = useState<Note | null>(null);
  const editor = useAvatarEditor({
    onChange: (avatar) => { setData(d => (d ? { ...d, user: { ...d.user, avatar } } : d)); refreshMe(); },
    onMessage: (text) => setAvatarNote({ text }),
    onError: (text) => setAvatarNote({ text, error: true }),
  });
  const [error, setError] = useState<unknown>(null);
  const [history, setHistory] = useState<{ rows: ScoreRow[]; hasMore: boolean } | null>(null); // own profile: paged full history
  const player = useTakePlayer();
  const [share, setShare] = useState<DialogShare | null>(null); // a play shared from here, in ShareDialog
  // Takes deleted (ids, or null for all of them): out of every list on the page
  const dropTakes = useCallback((ids: string[] | null) => {
    // (your own profile: a public one)
    setData(d => (d && !isPrivateProfile(d)
      ? { ...d, topSongs: d.topSongs && withoutTakes(d.topSongs, ids), recent: d.recent && withoutTakes(d.recent, ids) }
      : d));
    setHistory(h => (h ? { ...h, rows: withoutTakes(h.rows, ids) } : h));
  }, []);

  useEffect(() => {
    let active = true;
    setError(null);
    getProfile(username).then(d => { if (active) setData(d); }).catch(e => { if (active) setError(e); });
    return () => { active = false; };
  }, [username, user?.id]);

  // Invite link (/u/name?add=1): send the friend request as soon as we are signed in
  useEffect(() => {
    if (params.get('add') !== '1' || !user || !data || data.isMe) return;
    setParams(p => { const n = new URLSearchParams(p); n.delete('add'); return n; }, { replace: true });
    if (data.relation !== null && data.relation !== 'incoming') return; // a request from their side gets accepted
    requestFriend(data.user.username).then(relation => setData(d => d && { ...d, relation })).catch(() => {});
  }, [params, user, data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { document.title = `${username} | SingSpree`; }, [username]);

  // The bell links to #achievements and #friends: those sections exist once the profile is loaded.
  // Your settings were here before (#privacy, #account): links to them go on to /settings
  const { hash } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (!data || !hash) return;
    if (data.isMe && SETTINGS_HASHES.includes(hash)) { navigate(`/settings${hash}`, { replace: true }); return; }
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [data, hash, navigate]);

  if (error) {
    return (
      <WrapperPage>
        <div className="text-center py-20">
          <div className="text-6xl mb-4 text-white/40 font-semibold">:(</div>
          <h2 className="text-2xl font-semibold tracking-[-0.02em] text-white mb-6">{t('profile.notFound')}</h2>
          <Link to="/" className="btn btn-primary no-underline">{t('notFound.goHome')}</Link>
        </div>
      </WrapperPage>
    );
  }
  if (!data || authLoading) {
    return <WrapperPage><div className="text-white/40 text-sm text-center py-20 animate-pulse">{t('sections.loading')}</div></WrapperPage>;
  }

  // Someone else who keeps their stats private: the name and picture, nothing else
  if (isPrivateProfile(data)) return <PrivateProfile data={data} onRelation={(relation) => setData(d => d && { ...d, relation })} />;

  // A part its owner keeps from this viewer comes as null (statsPrivacy.ts): it is left out
  const { stats, isMe } = data;
  // Your own plays: share, listen, delete; someone else's: listen, where they let you
  const takeActions = (r: ListedSong) => (isMe
    ? <OwnRowActions row={r} username={data.user.username} player={player} onDeleted={dropTakes} onShare={setShare} />
    : r.takes?.length ? <div className="flex items-center gap-1 pr-2 flex-shrink-0"><TakeActions takes={r.takes} player={player} /></div> : null);
  const recentRows = history?.rows ?? data.recent ?? [];
  const hasMore = history ? history.hasMore : (isMe && recentRows.length >= 10);
  // (the button is on a loaded profile of your own)
  const loadMore = async () => {
    const offset = history?.rows.length ?? data.recent?.length ?? 0;
    const page = await getMyScores(offset, 20);
    setHistory(h => ({ rows: [...(h?.rows ?? data.recent ?? []), ...page.data], hasMore: page.hasMore }));
  };
  // Scores, songs played without a score yet, or nothing (logic/profileStats.ts); unknown without the numbers
  const { kind, played } = stats ? profileView(stats) : { kind: null, played: 0 };
  const hasScores = stats !== null && kind === 'scores'; // (scores: there are numbers)
  const bestRows = data.topSongs ?? [];
  const playedRows = data.playedRecently ?? [];
  // Under the name: since when, and with scores also in how many parties and
  // how long on the mic (without, the parties have a tile of their own)
  const timeSung = stats ? sungTime(stats.secondsSung, i18n.language) : null;
  const facts = [
    t('profile.memberSince', { date: fmt(data.user.createdAt) }),
    ...(hasScores && stats.parties > 0 ? [t('profile.partiesCount', { count: stats.parties })] : []),
    ...(timeSung ? [t('profile.timeSung', { time: timeSung })] : []),
  ];

  return (
    <WrapperPage>
      {/* Header */}
      <div className={headerCard}>
        <div className={stageLight} aria-hidden="true" />
        {isMe ? (
          // Your own: the picture opens the picker, the camera says so
          <button type="button" onClick={editor.choose} disabled={editor.busy} className="relative rounded-full flex-shrink-0 group" aria-label={data.user.avatar ? t('avatar.change') : t('avatar.add')} title={data.user.avatar ? t('avatar.change') : t('avatar.add')}>
            <Avatar username={data.user.username} src={data.user.avatar} size={72} className="text-3xl transition-opacity group-hover:opacity-85" />
            <span aria-hidden="true" className="absolute -right-0.5 -bottom-0.5 w-7 h-7 rounded-full fill-hot grid place-items-center ring-2 ring-panel">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
            </span>
          </button>
        ) : (
          <Avatar username={data.user.username} src={data.user.avatar} size={72} className="text-3xl relative" />
        )}
        <div className="relative flex-1 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-[-0.02em] text-white truncate">{data.user.username}</h1>
          {/* a phone breaks the line between the facts, not inside one */}
          <div className="text-sm text-white/55 mt-0.5">
            {facts.map((f, i) => <React.Fragment key={i}>{i > 0 && ' · '}<span className="whitespace-nowrap">{f}</span></React.Fragment>)}
          </div>
          {hasScores && <div className="mt-1.5"><StarRating stars={Math.min(3, Math.round((stats.averageBest / 10000) * 3))} size={18} label={`${stats.averageBest}`} /></div>}
          {/* Someone else's picture can be reported to the admins (guests too) */}
          {!isMe && data.user.avatar && <ReportPicture path={data.user.avatar} where={{ place: 'profile' }} className="mt-1.5" />}
          {/* Your picture changed from here, or why not */}
          {isMe && avatarNote && <p className={`text-xs mt-1.5 ${avatarNote.error ? 'text-red-300' : 'text-emerald-200'}`} role={avatarNote.error ? 'alert' : 'status'}>{avatarNote.text}</p>}
          {/* Your stats kept private, or to friends: who else sees what follows */}
          {isMe && statsVisibilityOf(user) !== 'public' && (
            <Link to="/settings#privacy" title={t(statsVisibilityOf(user) === 'friends' ? 'privacy.onlyFriends' : 'privacy.onlyYou')} className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold text-white/75 no-underline hover:bg-white/15 hover:text-white transition-colors">
              {statsVisibilityOf(user) === 'friends' ? <><FriendsIcon size={12} />{t('privacy.friends')}</> : <><LockIcon size={12} />{t('privacy.private')}</>}
            </Link>
          )}
        </div>
        {/* On a phone the button gets its own row under the name, so the name keeps the width */}
        <div className="relative w-full pl-[88px] sm:w-auto sm:pl-0 sm:flex-shrink-0">
          {isMe
            ? <Link to="/settings" className={btn.quiet} data-settings-link=""><GearIcon />{t('settings.title')}</Link>
            : <FriendButton username={data.user.username} relation={data.relation} onChange={(relation) => setData(d => d && { ...d, relation })} />}
        </div>
      </div>

      {/* Numbers */}
      {!stats ? null : hasScores ? (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3 mt-3 sm:mt-4">
          <StatTile label={t('profile.songsSung')} value={stats.songsSung} />
          <StatTile label={t('profile.totalStars')} value={<><span className="text-yellow-400">★</span> {stats.totalStars}</>} />
          <StatTile label={t('profile.fiveStars')} value={stats.fiveStars} />
          <StatTile label={t('profile.averageBest')} value={stats.averageBest.toLocaleString()} />
          <StatTile label={t('profile.played')} value={played} />
          <StatTile label={t('friends.title')} value={stats.friends} />
        </div>
      ) : kind === 'played' ? (
        <div className="grid grid-cols-3 gap-2 sm:gap-3 mt-3 sm:mt-4">
          <StatTile label={t('profile.played')} value={played} />
          <StatTile label={t('profile.parties')} value={stats.parties ?? 0} />
          <StatTile label={t('friends.title')} value={stats.friends} />
        </div>
      ) : (
        <div className="mt-3 sm:mt-4 rounded-2xl bg-panel border border-white/10 px-5 py-6 sm:px-7 text-center">
          {isMe ? (
            <>
              <div className="text-base font-semibold text-white">{t('profile.emptyTitle')}</div>
              <p className="text-sm text-white/55 mt-1 max-w-md mx-auto">{t('profile.emptyText')}</p>
              <Link to="/" className={`${btn.primary} mt-4`}>{t('profile.pickSong')}</Link>
            </>
          ) : (
            <p className="text-sm text-white/55">{t('profile.emptyOther', { username: data.user.username })}</p>
          )}
        </div>
      )}

      {/* Someone else's: only once there is one; before, the catalogue would only say that nothing was earned (yours shows how close you are) */}
      {data.achievements && (isMe || data.achievements.some(a => a.unlockedAt)) && <AchievementsSection items={data.achievements} isMe={isMe} username={data.user.username} />}

      {/* Best songs */}
      {bestRows.length > 0 && (
        <Section title={t('profile.bestSongs')}>
          <div className={listBox}>{bestRows.map(r => <SongRow key={r.songId} row={r} actions={takeActions(r)} />)}</div>
        </Section>
      )}

      {/* Recent */}
      {recentRows.length > 0 && (
        <Section title={t('profile.recent')}>
          <div className={listBox}>
            {recentRows.map(r => <SongRow key={r.id ?? `${r.songId}-${r.sungAt}`} row={r} date={fmt(r.sungAt)} actions={takeActions(r)} />)}
          </div>
          {hasMore && <button type="button" onClick={loadMore} className={`${sm(btn.quiet)} mt-3`}>{t('profile.showMore')}</button>}
        </Section>
      )}

      {/* Played, nothing scored yet: the songs, and how scores come about */}
      {playedRows.length > 0 && recentRows.length === 0 && (kind === 'played' || (!stats && bestRows.length === 0)) && (
        <Section title={t('profile.playedRecently')}>
          <p className="text-sm text-white/50 mb-3">
            {isMe ? t('profile.playedHint', { button: t('party.joinSinging') }) : stats ? t('profile.noScoresOther', { username: data.user.username }) : null}
          </p>
          <div className={listBox}>
            {playedRows.map(r => <SongRow key={`${r.songId}-${r.playedAt}`} row={r} date={fmt(r.playedAt)} />)}
          </div>
        </Section>
      )}

      {isMe && <FriendsSection />}
      {isMe && editor.ui}
      <ShareDialog share={share} onClose={() => setShare(null)} />
    </WrapperPage>
  );
};

export default ProfilePage;
