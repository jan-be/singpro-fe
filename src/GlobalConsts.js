import { useParams } from "react-router-dom";

const isDev = import.meta.env.DEV;
export const apiUrl = isDev
  ? '/api'
  : `https://${window.location.hostname}/api`;

export const appDomain = 'singpro.app';

/**
 * Hook: returns the current language from the URL.
 * No :lang param means English (the default, served at /).
 */
export const useLang = () => {
  const { lang } = useParams();
  return lang || 'en';
};

/**
 * Hook: returns a function that prefixes a path with the current language.
 * English has no prefix: lp('/sing/foo') → '/sing/foo'
 * Other languages:       lp('/sing/foo') → '/de/sing/foo'
 */
export const useLangPath = () => {
  const lang = useLang();
  return (path) => lang === 'en' ? path : `/${lang}${path}`;
};
