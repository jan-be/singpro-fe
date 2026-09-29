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

/** `list` is one of the endpoint's lists; `kind` is 'os', 'browsers' or 'devices'. */
export function deviceRows(list, kind, t) {
  return (list ?? []).map(({ name, sessions, plays }) => {
    const row = { key: `${kind}:${name}`, label: name, sessions, plays };
    if (name === 'unknown') return { ...row, label: t('admin.devices.notRecorded'), hint: t('admin.devices.notRecordedHint'), inferred: true };
    if (name === 'other') return { ...row, label: t('admin.devices.other') };
    if (kind === 'devices' && DEVICE_KINDS.includes(name)) return { ...row, label: t(`admin.devices.kind.${name}`) };
    if (kind === 'browsers' && IN_APP[name]) return { ...row, label: t(`admin.devices.${IN_APP[name]}`), hint: t(`admin.devices.${IN_APP[name]}Hint`) };
    return row;
  });
}
