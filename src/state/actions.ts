import {LyricRefType, LyricType} from "../logic/LyricsParser";

export const SET_LYRIC_DATA = 'SET_LYRIC_DATA';
export const SET_VIDEO_ID = 'SET_VIDEO_ID';
export const TICK_BEAT = 'TICK_BEAT';

export const setLyricData = (lyricLines: LyricType[][], lyricRefs: LyricRefType[], bpm: number, gap: number) => {
  return {type: SET_LYRIC_DATA, lyricData: {lyricLines, lyricRefs, bpm, gap}};
};

export const setVideoId = (videoId: string) => {
  return {type: SET_VIDEO_ID, videoId};
};

export const tickBeat = () => {
  return {type: TICK_BEAT};
};
