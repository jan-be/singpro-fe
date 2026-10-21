/**
 * What the party page hears from the server: the party socket's JSON messages
 * it reads (singspree-be websocketHandler.ts, partyManager.ts) and the song
 * API's answer (GET /songs/:songId, getSong.ts). Only the fields the page uses.
 */
import type { ChartJob } from '../logic/chartJobs';
import type { ScriptTitles } from '../logic/lyricsScripts';
import type { NotesBatchMessage } from '../logic/WebsocketHandling';
import type { QueueEntry } from '../components/QueuePanel';

/** A song's names in another script (lyricsScripts.ts): { Hans: { title, artist }, … } */
export type SongTitles = Record<string, ScriptTitles>;

/** The song the party is on (party:state, party:song_started) */
export interface PartySong {
  songId: string;
  artist?: string;
  title?: string;
  videoId?: string;
  titles?: SongTitles;
  generated?: boolean;
  beta?: boolean;
  /** ms (Date.now()) when this play started */
  startedAt?: number;
  isPlaying?: boolean;
  /** the host's video length, s, once its player reported it */
  duration?: number;
  /** the play is over (a server from before the flag sends none) */
  ended?: boolean;
  hostVideoTime?: number;
  playedSeconds?: number;
}

/** A seat in the party (party:state players, party:player_joined) */
export interface PartyStatePlayer {
  username: string;
  connected?: boolean;
  /** hue, null for the default */
  color?: number | null;
  score?: number;
  cumulativeScore?: number;
  part?: number;
  avatar?: string | null;
  /** another microphone of a page, not a person of its own */
  extra?: boolean;
}

// The two below are type aliases, not interfaces: partyRoles.ts readSettings
// takes any record (an index signature), which only an alias fits

/** Who runs the party and how it is joined (party:settings, also in party:state) */
export type PartySettingsData = {
  cohosts?: string[];
  joiningOpen?: boolean;
  autoSkip?: boolean | null;
};

/** party:state: the whole party, sent on join */
export type PartyStateData = PartySettingsData & {
  /** the party's limit on songs being charted (partyChartJobs.ts) */
  chartJobs?: { maxPending?: number };
  partyId?: string;
  owner?: string;
  hostConnected?: boolean;
  hostAway?: boolean;
  players?: PartyStatePlayer[];
  queue?: QueueEntry[];
  currentSong?: PartySong | null;
  /** the host's stage shows the duet's two parts */
  duet?: boolean;
};

/** A singer on the scoreboard (party:scores_updated) */
export interface ScoreBoardEntry {
  username: string;
  score?: number;
  stars?: number;
  cumulativeScore?: number;
  color?: number | null;
  avatar?: string | null;
}

/** A singer's card on the score screen (party:song_ended, with party:achievements merged in) */
export interface EndScore {
  username: string;
  score: number;
  stars?: number;
  cumulativeScore: number;
  /** the part of a duet sung */
  part?: number;
  avatar?: string | null;
  saved?: boolean;
  previousBest?: number | null;
  newBest?: boolean;
  /** achievement keys just earned */
  achievements?: string[];
}

/** What plays after the score screen: the queue's next song, or a similar one the server picked */
export interface NextSong {
  songId: string;
  artist: string;
  title: string;
  videoId?: string | null;
  titles?: SongTitles;
  generated?: boolean;
  beta?: boolean;
}

/** The server's JSON messages the party page reads, by `type` */
export type PartyServerMessage =
  | NotesBatchMessage
  | { type: 'party:queue_updated'; data: { queue?: QueueEntry[] } }
  // a song of the queue being charted moved on; one the queue refused (partyChartJobs.ts)
  | { type: 'party:chart_job'; data: { job?: ChartJob } }
  | { type: 'party:queue_refused'; data: { reason?: string } }
  | { type: 'party:lanes'; data: { pinned: string[] | null; spotlight: string[] | null } }
  | { type: 'party:state'; data: PartyStateData }
  | { type: 'party:settings'; data: PartySettingsData }
  | { type: 'playback:control'; data: { action?: 'play' | 'pause' | 'seek' | 'duet'; time?: number; on?: boolean; by?: string } }
  | { type: 'player:color_changed'; data: { username: string; color: number | null } }
  | { type: 'player:avatar'; data: { username: string; avatar?: string | null } }
  | { type: 'player:renamed'; data: { from: string; to: string } }
  | { type: 'player:part_changed'; data: { username: string; part: number } }
  | { type: 'song:lyrics_loaded'; data: { songId?: string; gap?: number; isDuet?: boolean } }
  | { type: 'party:player_joined'; data: PartyStatePlayer }
  | { type: 'party:player_left'; data: { username: string } }
  | { type: 'party:scores_updated'; data: { players?: ScoreBoardEntry[]; scores?: ScoreBoardEntry[]; removed?: string[]; partial?: boolean } }
  // { currentSong }; a server from before sent the song itself
  | { type: 'party:song_started'; data: { currentSong?: PartySong | null } & Partial<PartySong> }
  | { type: 'party:song_ended'; data: { scores?: EndScore[]; nextSong?: NextSong | null } }
  | { type: 'party:achievements'; data: { players?: { username: string; keys?: string[] }[] } }
  | { type: 'party:countdown_cancelled'; data: Record<string, never> }
  | { type: 'video:time'; data: { videoTime: number; isPlaying?: boolean; duration?: number; username?: string } }
  | { type: 'ping:request'; data: { serverTs: number } }
  | { type: 'ping:ack'; data: { latencyMs?: number } }
  | { type: 'party:gap'; data: { gap?: number; songId?: string } }
  | { type: 'party:host_status'; data: { connected?: boolean; away?: boolean } }
  | { type: 'party:closed'; data: { reason?: string } }
  | { type: 'party:latency_updated'; data: { latencies?: { username: string; latencyMs: number }[] } }
  | { type: 'error'; data: { code?: string; message?: string } };

/** A stretch of the video SponsorBlock marks (an intro, an outro, a non-music part) */
export interface SkipSegment {
  start: number;
  end: number;
  category: string;
}

/** GET /songs/:songId: the song and its chart (getSong.ts) */
export interface SongApiData {
  songId: string;
  artist: string;
  title: string;
  videoId: string;
  language?: string;
  titles?: SongTitles;
  skipSegments?: SkipSegment[];
  hasStems?: boolean;
  lyrics?: string | null;
  /** the duet twin's chart */
  duetLyrics?: string | null;
  /** the timing in use: a shared correction, else defaultGap (ms) */
  gap?: number | null;
  /** what the chart plays at by itself: its #GAP plus the video offset */
  defaultGap?: number | null;
  /** the duet twin's own base gap */
  duetGap?: number | null;
  /** the chart in other scripts: { Hans: chart, … } */
  lyricsScripts?: Record<string, string> | null;
  generated?: boolean;
  beta?: boolean;
}
