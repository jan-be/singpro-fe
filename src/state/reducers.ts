import {combineReducers} from "redux";
import {SET_LYRIC_DATA, SET_VIDEO_ID, TICK_BEAT} from "./actions";

const initialState = {
  lyricData: {
    lyrics: [],
    bpm: 0,
    gap: 0,
  },
  videoId: "dvgZkm1xWPE",
  tick: 0,
};

const videoId = (state: string = initialState.videoId, action: any) => {
  switch (action.type) {
    case SET_VIDEO_ID:
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

const tick = (state: number = initialState.tick, action: any) => {
  switch (action.type) {
    case TICK_BEAT:
      return state + 1;
    default:
      return state;
  }
};

export const singproApp = combineReducers({
  videoId,
  lyricData,
  tick,
});

export default singproApp;