/**
 * The system the browser itself reports, sent with each play for the admin
 * console's operating system versions (backend userAgent.js osRelease).
 * Chromium browsers freeze the Android, Windows and macOS versions in their
 * user agent ("Android 10; K", "Windows NT 10.0", "Mac OS X 10_15_7") but
 * tell them through navigator.userAgentData when asked. Only the system's
 * name and version, nothing else it could tell.
 */

/** { name, version } from `nav`, or null where the browser does not say (Safari, Firefox) */
export async function readPlatformHints(nav = globalThis.navigator) {
  const data = nav?.userAgentData;
  if (typeof data?.getHighEntropyValues !== 'function') return null;
  try {
    const v = await data.getHighEntropyValues(['platformVersion']);
    return v?.platform && v?.platformVersion ? { name: v.platform, version: v.platformVersion } : null;
  } catch {
    return null; // a browser may refuse it
  }
}

let pending = null;
/** The same, asked once per page load */
export const platformHints = () => (pending ??= readPlatformHints());
