import { describe, it, expect } from 'vitest';
import { deviceRows } from './deviceRows';

const t = (key) => `t:${key}`;

describe('deviceRows', () => {
  it('keeps the names of systems and browsers, translates the rest', () => {
    const os = deviceRows([
      { name: 'Windows', sessions: 9, plays: 20 },
      { name: 'other', sessions: 1, plays: 1 },
      { name: 'unknown', sessions: 0, plays: 4 },
    ], 'os', t);
    expect(os.map(r => r.label)).toEqual(['Windows', 't:admin.devices.other', 't:admin.devices.notRecorded']);
    expect(os[2]).toMatchObject({ inferred: true, hint: 't:admin.devices.notRecordedHint', sessions: 0, plays: 4 });
    expect(new Set(os.map(r => r.key)).size).toBe(3);
  });

  it('names the kinds of device and an app\'s built-in browser', () => {
    expect(deviceRows([{ name: 'tv', sessions: 2, plays: 5 }, { name: 'fridge', sessions: 1, plays: 1 }], 'devices', t).map(r => r.label))
      .toEqual(['t:admin.devices.kind.tv', 'fridge']); // a kind this page does not know yet stays as sent
    const [app] = deviceRows([{ name: 'Android WebView', sessions: 1, plays: 2 }], 'browsers', t);
    expect(app).toMatchObject({ label: 't:admin.devices.inAppAndroid', hint: 't:admin.devices.inAppAndroidHint' });
    expect(deviceRows(undefined, 'os', t)).toEqual([]);
  });
});
