import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import YouTube from 'react-youtube';
import css from './VideoPlayer.module.css';

const CONSENT_KEY = 'singpro-yt-consent';

const VideoPlayer = props => {
  const { t } = useTranslation();
  const [consented, setConsented] = useState(() => localStorage.getItem(CONSENT_KEY) === '1');

  const handleConsent = () => {
    localStorage.setItem(CONSENT_KEY, '1');
    setConsented(true);
  };

  return (
    <div className={css.videoContainerWrapper}>
      <div className={css.videoContainer}>
        {props.videoId
          ? consented
            ? <YouTube
                videoId={props.videoId}
                opts={{ playerVars: { autoplay: 1 } }}
                onReady={e => props.onPlayerObject(e.target)}
                onStateChange={e => props.onStateChange?.(e.data)}
                onEnd={() => props.onEnd?.()}/>
            : <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface/95 border border-surface-lighter rounded-lg p-6 text-center">
                <svg className="w-12 h-12 text-neon-cyan/60 mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
                  <path d="M10 9l5 3-5 3V9z" fill="currentColor"/>
                </svg>
                <p className="text-gray-300 text-sm max-w-xs mb-1">
                  {t('consent.youtubeMessage')}
                </p>
                <p className="text-gray-500 text-xs max-w-xs mb-4">
                  {t('consent.youtubeDetail')}{' '}
                  <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-neon-cyan/70 hover:text-neon-cyan underline">{t('consent.googlePrivacy')}</a>
                </p>
                <button
                  onClick={handleConsent}
                  className="px-5 py-2 rounded-lg bg-neon-cyan/15 border border-neon-cyan/40 text-neon-cyan font-medium text-sm hover:bg-neon-cyan/25 hover:border-neon-cyan/60 hover:shadow-[0_0_15px_rgba(0,229,255,0.15)] transition-all duration-300 cursor-pointer"
                >
                  {t('consent.accept')}
                </button>
              </div>
          : null}
      </div>
    </div>
  );
};

export default VideoPlayer;
