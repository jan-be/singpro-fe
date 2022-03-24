import React from "react";
import { getRandInt } from "../logic/RandomUtility";
import { Container } from "@mui/material";
import useMeasure from "react-use-measure";

const MusicBars = props => {
  const [ref, bounds] = useMeasure();
  let width = bounds.width ?? 600;

  let tickData = props.tickData;
  let hitNotesByPlayer = props.hitNotesByPlayer;

  let lineStartTick =
    tickData.currentLine && tickData.currentLine[1]
      ? tickData.currentLine[1].start
      : 0;

  if (!tickData.currentLine || !tickData.currentLine[1]) {
    return null;
  }

  let lowerBound = Math.min(...(tickData.currentLine?.map(e => e.tone) ?? [0])) - 6;
  let upperBound = Math.max(...(tickData.currentLine?.map(e => e.tone) ?? [0])) + 6;

  let difference = upperBound - lowerBound;

  if (difference < 12) {
    lowerBound -= 6 - difference / 2;
    upperBound += 6 - difference / 2;
  }

  let firstLineTick = tickData.currentLine[1].start;
  let lastEl = tickData.currentLine[tickData.currentLine.length - 1];
  let lastLineTick = lastEl.start + lastEl.length;
  let lineLengthInTicks = lastLineTick - firstLineTick;
  let shareOfTimeForLine = (tickData.tickFloat - firstLineTick) / (lineLengthInTicks);

  return (
    <Container maxWidth="md">
      <svg width="100%" ref={ref}>
        {tickData.currentLine && tickData.currentLine.filter(el => !el.isBreak).map((el, i) => {
          let isCurrent = tickData.lyricRef.syllableIndex === i + 1 && !tickData.lyricRef.isSilent;

          return (
            <rect x={((el.start - lineStartTick) / lineLengthInTicks) * width}
                  y={200 - ((el.tone - lowerBound) / (upperBound - lowerBound)) * 200}
                  key={i}
                  fill={isCurrent ? "greenyellow" : null}
                  width={el.length / lineLengthInTicks * width}
                  height="10"
                  stroke="white"
                  rx="15" ry="15"/>
          );
        })}

        <rect x={shareOfTimeForLine * width}
              y="20"
              width="5"
              height="60"
              fill="white"/>

        {Object.entries(hitNotesByPlayer)
          .map(([username, hitNotes]) => hitNotes.ticks
            .filter(e => e.tick > firstLineTick)
            .map((({ tick, note }) => {
              if (note === 0) {
                return null;
              }

              let randInt = getRandInt(0, 360, username);

              return <rect
                key={tick}
                fill={`hsl(${randInt}, 100%, 50%)`}
                x={((tick - lineStartTick) / lineLengthInTicks) * width}
                y={200 - ((note - lowerBound) / (upperBound - lowerBound)) * 200}
                width="10"
                height="10"
                rx="15" ry="15"/>;
            })))}

        {/*{Object.entries(hitNotesByPlayer)*/}
        {/*  .map(([username, hitNotes]) => hitNotes.ticks*/}
        {/*    .filter(e => e.tickFloat > firstLineTick)*/}
        {/*    .map((({ tickFloat, note }) => {*/}
        {/*      if (note === 0) {*/}
        {/*        return null;*/}
        {/*      }*/}

        {/*      let randInt = getRandInt(0, 360, username);*/}

        {/*      return <rect*/}
        {/*        key={tickFloat}*/}
        {/*        fill={`hsl(${randInt}, 100%, 50%)`}*/}
        {/*        x={((tickFloat - lineStartTick) / lineLengthInTicks) * width}*/}
        {/*        y={200 - ((note - lowerBound) / (upperBound - lowerBound)) * 200}*/}
        {/*        width="10"*/}
        {/*        height="10"*/}
        {/*        rx="15" ry="15"/>;*/}
        {/*    })))}*/}

      </svg>
    </Container>
  );
};

export default MusicBars;
