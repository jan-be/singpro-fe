import React, { useEffect, useState, useCallback, useRef } from "react";
import { initMicInput } from "../logic/MicrophoneInput";
import {
  openWebSocket,
  sendLastNote,
  sendPartyJoin,
  sendPlayerNote,
  sendQueueAdd,
  sendPingReply,
} from "../logic/WebsocketHandling";
import { useParams } from "react-router-dom";
import { apiUrl } from "../GlobalConsts";

const SingOnlyPage = () => {
  const params = useParams();
  const { username } = params;
  const partyId = params.partyId;

  const [volume, setVolume] = useState(0);
  const [note, setNote] = useState(0);
  const [wss, setWss] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Track host video state (received via video:time messages)
  const hostVideoRef = useRef({ videoTime: 0, isPlaying: false });

  // Server state
  const [currentLyrics, setCurrentLyrics] = useState(null);
  const [currentSong, setCurrentSong] = useState(null);
  const [personalScore, setPersonalScore] = useState(0);
  const [pitchFeedback, setPitchFeedback] = useState("");
  const [queue, setQueue] = useState([]);

  // Search for adding songs
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);

  useEffect(() => {
    let stopped = false;
    let stopMic;
    let wsInstance;

    (async () => {
      try {
        const [micResult, ws] = await Promise.all([
          initMicInput(),
          openWebSocket({ partyId, username }),
        ]);
        if (stopped) {
          micResult.stopMicInput();
          ws.close();
          return;
        }
        stopMic = micResult.stopMicInput;
        wsInstance = ws;

        // Send v2 join
        sendPartyJoin(ws, { partyId, username, isShowingVideo: false });

        setWss(ws);
        setLoading(false);

        micResult.setOnProcessing(msg => {
          const { note: rawNote, volume: rawVol } = msg.data;

          setVolume(Math.min(10, Math.log2(1 + Math.abs(rawVol))));
          setNote(rawNote);

          // Send note with host's video time (server deduplicates per-tick)
          const videoTime = hostVideoRef.current.videoTime;
          sendLastNote(ws, rawNote);
          sendPlayerNote(ws, { note: rawNote, videoTime });
        });

        // Handle messages from server
        ws.onmessage = (msg) => {
          const data = JSON.parse(msg.data);

          if (data.type === "song:lyrics_loaded") {
            setCurrentLyrics(data.data);
          }

          if (data.type === "party:song_started") {
            setCurrentSong(data.data);
          }

          if (data.type === "party:song_ended") {
            setCurrentSong(null);
            setCurrentLyrics(null);
          }

          if (data.type === "party:scores_updated") {
            const players = data.data.players ?? data.data.scores ?? [];
            const me = players.find(p => p.username === username);
            if (me) {
              setPersonalScore(me.cumulativeScore ?? me.score ?? 0);
            }
          }

          if (data.type === "party:queue_updated") {
            setQueue(data.data.queue ?? []);
          }

          if (data.type === "player:note_echo") {
            if (data.data.username === username) {
              const expected = data.data.expectedNote;
              const actual = data.data.note;
              if (actual === 0) {
                setPitchFeedback("");
              } else if (expected === undefined || expected === null) {
                setPitchFeedback("");
              } else if (actual === expected) {
                setPitchFeedback("on-pitch");
              } else if (actual > expected) {
                setPitchFeedback("too-high");
              } else {
                setPitchFeedback("too-low");
              }
            }
          }

          if (data.type === "ping:request") {
            sendPingReply(ws, { serverTs: data.data.serverTs });
          }

          // Track host video time for accurate scoring
          if (data.type === "video:time") {
            hostVideoRef.current = {
              videoTime: data.data.videoTime ?? 0,
              isPlaying: data.data.isPlaying ?? false,
            };
          }
        };
      } catch (err) {
        console.error("[SingOnlyPage] init failed:", err);
        if (!stopped) {
          setError(err.message || "Failed to initialize microphone");
          setLoading(false);
        }
      }
    })();

    return () => {
      stopped = true;
      stopMic?.();
      wsInstance?.close();
    };
  }, [partyId, username]);

  const handleSearch = async (term) => {
    setSearchTerm(term);
    if (term.length >= 2) {
      try {
        const resp = await fetch(`${apiUrl}/search/${term}`);
        const json = await resp.json();
        setSearchResults(json.data ?? []);
      } catch {
        setSearchResults([]);
      }
    } else {
      setSearchResults([]);
    }
  };

  const handleAddToQueue = useCallback((song) => {
    if (wss) {
      sendQueueAdd(wss, { songId: song.songId, artist: song.artist, title: song.title, videoId: song.videoId });
    }
    setSearchOpen(false);
    setSearchTerm("");
    setSearchResults([]);
  }, [wss]);

  const volumeRadius = 20 + 14 * volume;

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-surface to-[#0a0a1a] flex flex-col items-center justify-center gap-4 px-6">
        <div className="text-neon-magenta text-lg font-bold">Failed to start</div>
        <div className="text-gray-400 text-sm text-center">{error}</div>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded bg-neon-purple/20 text-neon-purple hover:bg-neon-purple/30 transition-colors cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-surface to-[#0a0a1a] flex flex-col">
      {/* Header */}
      <div className="bg-surface-light border-b border-surface-lighter px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-neon-cyan font-mono text-sm">Party: {partyId}</div>
            <div className="text-white font-bold">{username}</div>
          </div>
          <div className="text-right">
            <div className="text-gray-400 text-xs">Score</div>
            <div className="text-neon-green font-mono text-2xl font-bold">{personalScore}</div>
          </div>
        </div>
      </div>

      {/* Loading overlay */}
      {loading && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <div className="text-neon-cyan font-mono text-sm animate-pulse">Loading pitch engine...</div>
        </div>
      )}

      {!loading && (
        <>
          {/* Current song info */}
          {currentSong && (
            <div className="text-center py-3 px-4 bg-surface-light/50">
              <div className="text-white font-bold">{currentSong.title}</div>
              <div className="text-gray-400 text-sm">{currentSong.artist}</div>
            </div>
          )}

          {/* Lyrics display */}
          {currentLyrics && (
            <div className="text-center py-4 px-4">
              {currentLyrics.currentLine && (
                <div className="text-2xl font-bold text-white">{currentLyrics.currentLine}</div>
              )}
              {currentLyrics.nextLine && (
                <div className="text-lg text-gray-500 mt-2">{currentLyrics.nextLine}</div>
              )}
            </div>
          )}

          {/* Pitch feedback + volume visualizer */}
          <div className="flex-1 flex flex-col items-center justify-center gap-6 py-8">
            {/* Pitch indicator */}
            <div className="text-center h-8">
              {pitchFeedback === "on-pitch" && (
                <span className="text-neon-green font-bold text-lg">On pitch!</span>
              )}
              {pitchFeedback === "too-high" && (
                <span className="text-neon-magenta font-bold text-lg">Too high &#9660;</span>
              )}
              {pitchFeedback === "too-low" && (
                <span className="text-neon-cyan font-bold text-lg">Too low &#9650;</span>
              )}
            </div>

            {/* Volume ring */}
            <svg width={200} height={200} className="drop-shadow-lg">
              <circle cx={100} cy={100} r={20} fill="#b44aff" />
              <circle
                cx={100} cy={100}
                r={volumeRadius}
                stroke={note > 0 ? "#00e5ff" : "#444"}
                strokeWidth={2}
                fill="none"
                style={{ transition: "r 0.05s ease-out" }}
              />
              {note > 0 && (
                <text x={100} y={105} textAnchor="middle" fill="white" fontSize="14" fontFamily="monospace">
                  {note}
                </text>
              )}
            </svg>
          </div>

          {/* Queue section */}
          <div className="border-t border-surface-lighter">
            <div className="flex items-center justify-between px-4 py-3">
              <h3 className="text-white font-bold text-sm">Queue ({queue.length})</h3>
              <button
                onClick={() => setSearchOpen(!searchOpen)}
                className="px-3 py-1 text-xs rounded bg-neon-purple/20 text-neon-purple hover:bg-neon-purple/30 transition-colors cursor-pointer"
              >
                + Add Song
              </button>
            </div>

            {searchOpen && (
              <div className="px-4 pb-3">
                <input
                  type="text"
                  placeholder="Search songs..."
                  value={searchTerm}
                  onChange={(e) => handleSearch(e.target.value)}
                  autoFocus
                  className="w-full px-3 py-2 rounded bg-surface border border-surface-lighter text-white text-sm placeholder-gray-500 focus:outline-none focus:border-neon-cyan transition-all"
                />
                {searchResults.length > 0 && (
                  <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
                    {searchResults.map((song, i) => (
                      <button
                        key={i}
                        onClick={() => handleAddToQueue(song)}
                        className="w-full text-left px-3 py-2 rounded hover:bg-surface-lighter transition-colors text-sm cursor-pointer"
                      >
                        <div className="text-white truncate">{song.title}</div>
                        <div className="text-gray-400 text-xs truncate">{song.artist}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {queue.length > 0 && (
              <div className="px-4 pb-4 space-y-1">
                {queue.map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm py-1">
                    {i === 0 && <span className="text-[10px] text-neon-green font-bold">NEXT</span>}
                    <span className="text-white truncate">{item.title}</span>
                    <span className="text-gray-500 text-xs truncate">- {item.artist}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default SingOnlyPage;
