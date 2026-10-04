/**
 * The admin page's "What they sing on" lists, out of /admin/devices (backend
 * routes/admin.js, which reads the stored user agents with userAgent.js).
 *
 * Operating systems and browsers are names and stay as they are; what is
 * not a name is translated: the kinds of device, "other", an app's built-in
 * browser, and 'unknown', which is only ever plays from before the user
 * agent was stored (April 2026), so it says "not recorded".
 */
export const DEVICE_KINDS = ['phone', 'tablet', 'computer', 'tv', 'console'];
const IN_APP = { 'iOS app': 'inAppIos', 'Android WebView': 'inAppAndroid' };

/**
 * `list` is one of the endpoint's lists; `kind` is 'os', 'versions',
 * 'browsers' or 'devices'. A version the browser hides comes as the family
 * and " ?" (backend userAgent.js osRelease) and says so in words.
 */
export function deviceRows(list, kind, t) {
  return (list ?? []).map(({ name, sessions, plays }) => {
    const row = { key: `${kind}:${name}`, label: name, sessions, plays };
    if (name === 'unknown') return { ...row, label: t('admin.devices.notRecorded'), hint: t('admin.devices.notRecordedHint'), inferred: true };
    if (name === 'other') return { ...row, label: t('admin.devices.other') };
    if (kind === 'versions' && name.endsWith(' ?')) {
      return { ...row, label: `${name.slice(0, -2)} · ${t('admin.devices.versionHidden')}`, hint: t('admin.devices.versionHiddenHint'), inferred: true };
    }
    if (kind === 'versions' && name === 'Windows 10/11') return { ...row, hint: t('admin.devices.windowsHint') };
    if (kind === 'devices' && DEVICE_KINDS.includes(name)) return { ...row, label: t(`admin.devices.kind.${name}`) };
    if (kind === 'browsers' && IN_APP[name]) return { ...row, label: t(`admin.devices.${IN_APP[name]}`), hint: t(`admin.devices.${IN_APP[name]}Hint`) };
    return row;
  });
}
