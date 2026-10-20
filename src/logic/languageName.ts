/**
 * A catalogue language (USDB's English names: "German", "Mandarin") in the
 * page's language ("Deutsch", "普通话"), through Intl.DisplayNames; the
 * catalogue's own name where the browser cannot say it.
 */
const CODES = {
  English: 'en', German: 'de', French: 'fr', Spanish: 'es', Japanese: 'ja', Polish: 'pl', Italian: 'it',
  Portuguese: 'pt', Dutch: 'nl', Swedish: 'sv', Finnish: 'fi', Korean: 'ko', Mandarin: 'cmn', Hungarian: 'hu',
  Russian: 'ru', Turkish: 'tr', Slovenian: 'sl', Croatian: 'hr', Hindi: 'hi', Norwegian: 'no', Danish: 'da',
  Cantonese: 'yue', Czech: 'cs', Serbian: 'sr', Romanian: 'ro', Bosnian: 'bs', Ukrainian: 'uk', Malay: 'ms',
  Slovak: 'sk', Latin: 'la', Icelandic: 'is', Indonesian: 'id', Greek: 'el', Tagalog: 'fil', Estonian: 'et',
  Zulu: 'zu', Galician: 'gl', Irish: 'ga', Samoan: 'sm', Hebrew: 'he', Catalan: 'ca', Swahili: 'sw',
  Persian: 'fa', Armenian: 'hy', Malagasy: 'mg', Breton: 'br', Quechua: 'qu', Haitian: 'ht', Scots: 'sco',
  Maori: 'mi', Gaelic: 'gd', Lithuanian: 'lt', Welsh: 'cy', Latvian: 'lv', Yoruba: 'yo',
};

export function languageLabel(name, locale) {
  const code = CODES[name];
  if (!code) return name ?? '';
  try {
    const names = new Intl.DisplayNames([locale, 'en'], { type: 'language', fallback: 'none' });
    const label = names.of(code) ?? (code === 'cmn' ? names.of('zh') : null);
    return label ? label.charAt(0).toLocaleUpperCase(locale) + label.slice(1) : name;
  } catch {
    return name;
  }
}
