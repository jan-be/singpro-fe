import React from "react";
import { getRandInt } from "../logic/RandomUtility";
import { motion } from "motion/react";

const PlayerScoreList = props => {
  let data = Object.entries(props.hitNotesByPlayer).map(([playerName, hitNotes], i) => {
    let randInt = getRandInt(0, 360, playerName);
    return {
      id: i,
      hue: randInt,
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
    <div className="bg-surface-light/80 rounded-lg p-3 backdrop-blur-sm">
      <table className="w-full">
        <tbody>
          {data.sort((a, b) => b.score - a.score).map((e) =>
            <motion.tr layout transition={spring} key={e.player} className="border-b border-surface-lighter last:border-b-0">
              <td className="py-2 pr-2">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                  style={{ backgroundColor: `hsl(${e.hue}, 70%, 45%)` }}
                >
                  {e.player.charAt(0).toUpperCase()}
                </div>
              </td>
              <td className="py-2 text-white text-sm">{e.player}</td>
              <td className="py-2 text-right text-neon-cyan font-mono font-bold">{e.score}</td>
            </motion.tr>,
          )}
        </tbody>
      </table>
    </div>
  );
};

export default PlayerScoreList;
