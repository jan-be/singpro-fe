import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import de from './locales/de.json';
import nl from './locales/nl.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import es from './locales/es.json';
import pt from './locales/pt.json';
import fr from './locales/fr.json';
import it from './locales/it.json';
import tr from './locales/tr.json';
import zh from './locales/zh.json';
import zhTW from './locales/zh-TW.json';
import th from './locales/th.json';
import id from './locales/id.json';
import pl from './locales/pl.json';
import ru from './locales/ru.json';
import ar from './locales/ar.json';
import hi from './locales/hi.json';
import vi from './locales/vi.json';
import sv from './locales/sv.json';
import tl from './locales/tl.json';

export const supportedLanguages = [
  'en', 'de', 'nl', 'ja', 'ko', 'es', 'pt',
  'fr', 'it', 'tr', 'zh', 'zh-TW', 'th', 'id',
  'pl', 'ru', 'ar', 'hi', 'vi', 'sv', 'tl',
];

export const languageNames = {
  en: 'English',
  de: 'Deutsch',
  nl: 'Nederlands',
  ja: '日本語',
  ko: '한국어',
  es: 'Español',
  pt: 'Português',
  fr: 'Français',
  it: 'Italiano',
  tr: 'Türkçe',
  zh: '简体中文',
  'zh-TW': '繁體中文',
  th: 'ไทย',
  id: 'Bahasa Indonesia',
  pl: 'Polski',
  ru: 'Русский',
  ar: 'العربية',
  hi: 'हिन्दी',
  vi: 'Tiếng Việt',
  sv: 'Svenska',
  tl: 'Filipino',
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      de: { translation: de },
      nl: { translation: nl },
      ja: { translation: ja },
      ko: { translation: ko },
      es: { translation: es },
      pt: { translation: pt },
      fr: { translation: fr },
      it: { translation: it },
      tr: { translation: tr },
      zh: { translation: zh },
      'zh-TW': { translation: zhTW },
      th: { translation: th },
      id: { translation: id },
      pl: { translation: pl },
      ru: { translation: ru },
      ar: { translation: ar },
      hi: { translation: hi },
      vi: { translation: vi },
      sv: { translation: sv },
      tl: { translation: tl },
    },
    fallbackLng: 'en',
    supportedLngs: supportedLanguages,
    interpolation: {
      escapeValue: false, // React already escapes
    },
    detection: {
      // 1. Check localStorage override (user explicitly picked a language)
      // 2. Check browser language
      // URL path detection is handled by the router, not by i18next detector,
      // because we need it to work before i18n initializes.
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'singpro-lang',
      caches: ['localStorage'],
    },
  });

/**
 * Detect language from URL path.
 * Non-English languages have a /{lang}/ prefix. No prefix = English.
 */
export function detectLanguageFromPath() {
  const match = window.location.pathname.match(/^\/([a-z]{2}(?:-[A-Z]{2})?)(\/|$)/);
  if (match && supportedLanguages.includes(match[1]) && match[1] !== 'en') {
    return match[1];
  }
  return 'en';
}

export default i18n;
