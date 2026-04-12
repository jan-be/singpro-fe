import { useParams } from "react-router-dom";

const isDev = import.meta.env.DEV;
export const apiUrl = isDev
  ? '/api'
  : `https://${window.location.hostname}/api`;

export const appDomain = 'singpro.app';

/**
 * Hook: returns the current language prefix from the URL (e.g. "en", "de").
 * Falls back to "en" if not present.
 */
export const useLang = () => {
  const { lang } = useParams();
  return lang || 'en';
};

/**
 * Hook: returns a function that prefixes a path with the current language.
 * Usage: const lp = useLangPath(); lp('/sing/foo/123') → '/en/sing/foo/123'
 */
export const useLangPath = () => {
  const lang = useLang();
  return (path) => `/${lang}${path}`;
};
