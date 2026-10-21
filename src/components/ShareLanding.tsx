import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import WrapperPage from "../pages/WrapperPage";
import StarRating from "./StarRating";
import { useSongNames } from "../logic/useSongNames";
import { landingDone, visitShare, type ShareVisit } from "../logic/shareLinks";

export interface ShareLandingProps {
  /** the route's song */
  songId: string | undefined;
  code: string;
  onSing: () => void;
}

/**
 * What a shared song link (/sing/<song>?r=<code>, logic/shareLinks.ts) opens
 * to before any party starts: the song, who sent it and their score when
 * their settings let this visitor see it ("Can you beat it?"), and one tap
 * to sing it. That tap starts the party (PartyPage) on this page, and is
 * also the touch the browser wants before the video may play with sound.
 *
 * The visit is recorded on the server (who came by whose link). A code the
 * server does not know opens the song as before, and so does a server that
 * cannot be reached, after the song's own button.
 */
const ShareLanding = ({ songId, code, onSing }: ShareLandingProps) => {
  const { t, i18n } = useTranslation();
  const namesOf = useSongNames();
  const [state, setState] = useState<{ loading: boolean; data: ShareVisit | null }>({ loading: true, data: null });

  useEffect(() => {
    let active = true;
    visitShare(code).then(
      (data) => {
        if (!active) return;
        if (!data || data.songId !== songId) onSing(); // not a code of this song's: the song as before
        else setState({ loading: false, data });
      },
      () => { if (active) setState({ loading: false, data: null }); },
    );
    return () => { active = false; };
  }, [code, songId]); // eslint-disable-line react-hooks/exhaustive-deps

  const { loading, data } = state;
  const names = data ? namesOf({ title: data.title, artist: data.artist }) : null;
  useEffect(() => {
    if (names?.title) document.title = `${names.title} – ${names.artist} | SingSpree`;
  }, [names?.title, names?.artist]);
  const from = data?.from ?? null;
  const own = !!data?.own;
  const score = from?.score != null ? from.score.toLocaleString(i18n.language) : null;

  let line = null;
  if (from && own) line = score ? t('share.landing.yourScore', { score }) : null;
  else if (from && score) line = t('share.landing.scored', { name: from.name, score });
  else if (from) line = t('share.landing.sang', { name: from.name });
  else if (data) line = t('share.landing.someone');

  return (
    <WrapperPage>
      <div className="max-w-md mx-auto sm:py-6" data-share-landing="">
        <div className="rounded-3xl bg-panel border border-white/10 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)] overflow-hidden">
          <div className="relative aspect-video bg-white/[0.04]">
            {data?.videoId && (
              <img src={`https://i.ytimg.com/vi/${data.videoId}/hqdefault.jpg`} alt="" className="absolute inset-0 w-full h-full object-cover" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[rgba(16,12,36,0.97)] via-[rgba(16,12,36,0.6)] to-[rgba(16,12,36,0.1)]" aria-hidden="true" />
            {names && (
              <div className="absolute inset-x-0 bottom-0 p-5">
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-[-0.02em] text-white text-balance" lang={names.lang}>{names.title}</h1>
                <p className="text-white/70 mt-0.5" lang={names.lang}>{names.artist}</p>
              </div>
            )}
          </div>

          <div className="p-6 sm:p-7">
            {loading ? (
              <div className="h-16 rounded-2xl bg-white/[0.05] animate-pulse" aria-hidden="true" />
            ) : (
              <>
                {line && <p className="text-lg text-white font-medium text-pretty">{line}</p>}
                {from?.stars != null && from.stars > 0 && <StarRating stars={from.stars} size={22} className="mt-2" />}
                {from && score && !own &&<p className="mt-3 text-white/70">{t('share.landing.beatIt')}</p>}
              </>
            )}

            <button type="button" onClick={onSing} className="btn btn-primary btn-lg w-full mt-6" autoFocus>
              {t('share.landing.sing')}
            </button>
            <p className="mt-3 text-sm text-white/55 text-center text-pretty">{t('share.landing.how')}</p>
          </div>
        </div>
        <div className="text-center mt-5">
          <Link to="/" onClick={landingDone} className="text-sm text-white/60 hover:text-white">{t('share.landing.more')}</Link>
        </div>
      </div>
    </WrapperPage>
  );
};

export default ShareLanding;
