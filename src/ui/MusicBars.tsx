import React from "react";
import {connect} from "react-redux";
import {TickDataType} from "../logic/LyricsParser";
import css from './MusicBars.module.css'

const MusicBars = (props: any) => {
  let tickData: TickDataType = props.tickData;

  let lineStartTick =
    tickData.currentLine
      ? tickData.currentLine[1].start
      : 0;

  return (
    <svg width={1200} height={200}>
      {tickData.currentLine && tickData.currentLine.filter(el => !el.isBreak).map((el, i) => {
        let isCurrent = tickData.lyricRef.syllableIndex === i && !tickData.lyricRef.isSilent;

        return (
          <rect x={(el.start - lineStartTick) * 10}
                y={200 - el.tone * 10}
                key={i}
                className={isCurrent ? css.barCurrent : css.barNotCurrent}
                width={el.length * 10}
                height="10"
                rx="15" ry="15"/>
        );
      })}

      return (
      <rect x={0}
            y={200 - props.currentTone * 10}
            className={css.barPlayer}
            width="1200"
            height="3"
            rx="15" ry="15"/>
      );
      })}

    </svg>
  )
};

const mapStateToProps = (state: any) => ({
  tickData: state.tickData,
  currentTone: state.currentTone,
});

export default connect(mapStateToProps)(MusicBars);
