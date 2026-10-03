import { useTranslation } from 'react-i18next';
import { songNames, loadScriptChoices } from './lyricsScripts';

/**
 * (song) => { title, artist, lang?, roman? }: a song's names as this viewer
 * reads them (lyricsScripts.js songNames). The saved script choices are read
 * on every render, so a list re-rendered after the lyrics pill was switched
 * follows it.
 */
export function useSongNames() {
  const { i18n } = useTranslation();
  const saved = loadScriptChoices();
  return (song) => songNames(song, { locale: i18n.language, saved });
}
