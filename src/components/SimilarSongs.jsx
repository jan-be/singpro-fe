import React from "react";
import { useTranslation } from "react-i18next";
import { useSongNames } from "../logic/useSongNames";

/**
 * Songs like the current one, next to the queue (the drawer on the party page
 * and the popped-out queue window). Those we have can be queued with one click.
 */
const SimilarSongs = ({ songs, onAdd, limit = 8 }) => {
  const { t } = useTranslation();
  const namesOf = useSongNames();
  if (!songs?.length) return null;
  return (
    <div className="bg-surface-light/80 rounded-lg border border-surface-lighter p-3 backdrop-blur-sm">
      <h3 className="text-white font-bold text-sm mb-2">{t('party.similarSongs')}</h3>
      <div className="space-y-1 max-h-60 overflow-y-auto">
        {songs.slice(0, limit).map((song, i) => {
          const local = song.localMatch;
          const names = local?.titles ? namesOf(local) : { title: song.name ?? song.title, artist: song.artist?.name ?? song.artist };
          return (
            <div key={i} className="flex items-center gap-2 group">
              {local?.videoId && (
                <img
                  src={`https://i.ytimg.com/vi/${local.videoId}/default.jpg`}
                  alt=""
                  className="w-10 h-7.5 rounded object-cover flex-shrink-0"
                  loading="lazy"
                />
              )}
              <div className="flex-1 min-w-0 text-sm">
                <div className="text-gray-300 truncate" lang={names.lang}>{names.title}</div>
                <div className="text-gray-500 text-xs truncate" lang={names.lang}>{names.artist}</div>
              </div>
              {local && (
                <button
                  onClick={() => onAdd?.(local)}
                  className="flex-shrink-0 w-7 h-7 rounded-full bg-neon-green/10 text-neon-green hover:bg-neon-green/25 border border-neon-green/30 hover:border-neon-green/60 flex items-center justify-center text-lg leading-none transition-all opacity-60 group-hover:opacity-100"
                  title={`Add ${local.title} to queue`}
                >
                  +
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SimilarSongs;
