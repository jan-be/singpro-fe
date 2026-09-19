/**
 * A short device label from a user agent, to tell a phone from a laptop
 * from a script at a glance: "Chrome · Android", "Safari · iPhone",
 * "Firefox · Windows", "script (curl/8.4.0)". Not a parser, just the usual
 * suspects in the order that keeps Edge from reading as Chrome and an
 * iPhone from reading as a Mac.
 */
const BROWSERS = [
  ['Edg/', 'Edge'], ['SamsungBrowser', 'Samsung Internet'], ['OPR/', 'Opera'], ['Silk/', 'Silk'],
  ['Firefox/', 'Firefox'], ['FxiOS/', 'Firefox'], ['CriOS/', 'Chrome'], ['Chrome/', 'Chrome'], ['Safari/', 'Safari'],
];
const SYSTEMS = [
  ['Android', 'Android'], ['iPhone', 'iPhone'], ['iPad', 'iPad'], ['Windows', 'Windows'],
  ['CrOS', 'ChromeOS'], ['Mac OS X', 'Mac'], ['Linux', 'Linux'],
];

export function deviceLabel(ua) {
  if (!ua || typeof ua !== 'string') return '';
  if (ua.includes('HeadlessChrome')) return 'Headless Chrome';
  const browser = BROWSERS.find(([mark]) => ua.includes(mark))?.[1];
  const system = SYSTEMS.find(([mark]) => ua.includes(mark))?.[1];
  if (!browser && !system) return `script (${ua.split(/[\s(]/)[0].slice(0, 30)})`;
  return [browser, system].filter(Boolean).join(' · ');
}
