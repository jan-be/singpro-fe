import {LyricRefType, LyricType} from "../logic/LyricsParser";
import store from "./store";

export const SET_LYRIC_DATA = 'SET_LYRIC_DATA';
export const SET_LYRICS_CURRENT_TICK = 'SET_LYRICS_CURRENT_TICK';
export const SET_VIDEO_ID = 'SET_VIDEO_ID';
export const TICK_BEAT = 'TICK_BEAT';

export const setLyricData = (lyricLines: LyricType[][], lyricRefs: LyricRefType[], bpm: number, gap: number) => {
  store.dispatch({type: SET_LYRIC_DATA, lyricData: {lyricLines, lyricRefs, bpm, gap}});
};

export const setVideoId = (videoId: string) => {
  store.dispatch({type: SET_VIDEO_ID, videoId});
};

export const tickBeat = (shouldIncrease: boolean) => {
  store.dispatch({type: TICK_BEAT, shouldIncrease: shouldIncrease, fullState: store.getState()});
};
