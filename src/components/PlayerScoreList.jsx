import React from 'react';
import { getRandInt } from "../logic/RandomUtility";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import { Box } from "@mui/material";
import { motion } from "framer-motion";

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

  const spring = React.useMemo(
    () => ({
      type: "spring",
      damping: 50,
      stiffness: 100,
    }),
    [],
  );

  return (
    <Box sx={{ backgroundColor: "white" }}>
      <table>
        <tbody>
        {data.sort((a, b) => b.score - a.score).map((e) =>
          <motion.tr layout transition={spring} key={e.player}>
            <td><AccountCircleIcon style={{ color: `hsl(${e.icon}, 100%, 50%)` }}/></td>
            <td>{e.player}</td>
            <td>{e.score}</td>
          </motion.tr>,
        )}
        </tbody>
      </table>
    </Box>
  );
};

export default PlayerScoreList;
