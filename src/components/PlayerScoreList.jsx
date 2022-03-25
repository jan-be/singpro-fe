import React from 'react';
import { getRandInt } from "../logic/RandomUtility";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import { Box } from "@mui/material";

const PlayerScoreList = props => {
  let data = Object.entries(props.hitNotesByPlayer).map(([playerName, hitNotes], i) => {
    let randInt = getRandInt(0, 360, playerName);
    return {
      id: i,
      icon: randInt,
      player: playerName,
      score: hitNotes.score,
    };
  });

  return (
    <Box sx={{backgroundColor: "white"}}>
      <table>
        {data.map((e) =>
          <tr>
            <td><AccountCircleIcon style={{ color: `hsl(${e.icon}, 100%, 50%)` }}/></td>
            <td>{e.player}</td>
            <td>{e.score}</td>
          </tr>,
        )}
      </table>
    </Box>
  );
};

export default PlayerScoreList;
