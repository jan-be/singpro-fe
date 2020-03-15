import {LyricType} from "../logic/LyricsParser";

export const SET_LYRIC_DATA = 'SET_LYRIC_DATA';
export const SET_VIDEO_ID = 'SET_VIDEO_ID';
export const TICK_BEAT = 'TICK_BEAT';

export const setLyricData = (lyrics: LyricType[], bpm: number, gap: number) => {
  return {type: SET_LYRIC_DATA, lyricData: {lyrics, bpm, gap}};
};

export const setVideoId = (videoId: string) => {
  return {type: SET_VIDEO_ID, videoId};
};

export const tickBeat = () => {
  return {type: TICK_BEAT};
};
