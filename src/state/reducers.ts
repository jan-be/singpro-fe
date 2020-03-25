import { combineReducers } from "redux";
import { SET_CURRENT_TONE, SET_LYRIC_DATA, SET_VIDEO_ID, TICK_BEAT } from "./actions";
import { LyricRefType, LyricType, readTextFile, TickDataType } from "../logic/LyricsParser";

const initialState = {
  lyricData: {
    lyricLines: [],
    lyricRefs: [],
    bpm: 0,
    gap: 0,
  },
  videoId: "",
  tickData: {
    currentLine: undefined,
    nextLine: undefined,
    lyricRef: undefined,
    tick: 0
  },
  currentTone: 0,
};

const videoId = (state: string = initialState.videoId, action: any) => {
  switch (action.type) {
    case SET_VIDEO_ID:
      readTextFile(`/ulfs/${action.videoId}`);

      return action.videoId;
    default:
      return state;
  }
};

const lyricData = (state = initialState.lyricData, action: any) => {
  switch (action.type) {
    case SET_LYRIC_DATA:
      return action.lyricData;
    default:
      return state;
  }
};

const currentTone = (state = initialState.currentTone, action: any) => {
  switch (action.type) {
    case SET_CURRENT_TONE:
      return action.currentTone;
    default:
      return state;
  }
};

// @ts-ignore
const tickData = (state: TickDataType = initialState.tickData, action: any) => {
  switch (action.type) {
    case TICK_BEAT:
      let newTick = action.shouldIncrease ? state.tick + 1 : state.tick;

      let lyricData = action.fullState.lyricData;

      // @ts-ignore
      let lyricRef: LyricRefType = undefined;
      let currentLine: LyricType[] = [];
      let nextLine: LyricType[] = [];
      if (lyricData.lyricRefs && lyricData.lyricRefs.length > 0) {
        lyricRef = lyricData.lyricRefs[newTick];
      }
      if (lyricRef) {
        currentLine = lyricData.lyricLines[lyricRef.lineIndex];
        nextLine = lyricData.lyricLines[lyricRef.lineIndex + 1];
      }

      return { currentLine, nextLine, lyricRef, tick: newTick };
    default:
      return state;
  }
};

export const singproApp = combineReducers({
  videoId,
  lyricData,
  tickData,
  currentTone,
});

export default singproApp;