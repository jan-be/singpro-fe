import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getAdminShares, type AdminShares as Shares, type ShareCounts } from '../logic/authApi';
import { FilterButtons, Hint, Loading, Section, panel } from './AdminParts';

/**
 * The admin page's share links (backend referrals.js, GET /admin/shares):
 * per kind of share the links made, how often they were sent, the browsers
 * that came by them and how many of those then started a party, sang or
 * made an account; and the sharers who brought the most people.
 */
const DAYS = [7, 28, 365];
const COLUMNS: (keyof ShareCounts)[] = ['links', 'sent', 'arrivals', 'parties', 'singers', 'accounts'];

const AdminShares = ({ onError = () => {} }: { onError?: (e: unknown) => void }) => {
  const { t, i18n } = useTranslation();
  const [days, setDays] = useState(28);
  const [data, setData] = useState<Pick<Shares, 'kinds' | 'top'> | null>(null); // (empty lists when it could not be read)
  useEffect(() => {
    let active = true;
    setData(null);
    getAdminShares(days).then(d => { if (active) setData(d); }).catch(e => { if (active) { setData({ kinds: [], top: [] }); onError(e); } });
    return () => { active = false; };
  }, [days]); // eslint-disable-line react-hooks/exhaustive-deps
  const fmt = (n: number) =>Number(n).toLocaleString(i18n.language);
  const total = (key: keyof ShareCounts) => (data?.kinds ?? []).reduce((sum, k) => sum + (k[key] ?? 0), 0);
  const cell = 'px-3 py-2 text-right tabular-nums whitespace-nowrap';

  return (
    <Section
      title={t('admin.shares.title')}
      aside={<FilterButtons options={DAYS} value={days} onChange={setDays} label={d => t('admin.origins.days', { count: d })} />}
    >
      <Hint>{t('admin.shares.hint')}</Hint>
      {!data ? <Loading>{t('sections.loading')}</Loading> : (
        <div className="grid grid-cols-1 gap-3">
          <div className={`${panel} overflow-x-auto`} data-admin-shares="">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-white/50 border-b border-white/[0.07]">
                  <th className="px-3 py-2 text-left font-medium">{t('admin.shares.kind')}</th>
                  {COLUMNS.map(c => <th key={c} className="px-3 py-2 text-right font-medium whitespace-nowrap" title={t(`admin.shares.hints.${c}`)}>{t(`admin.shares.columns.${c}`)}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.07]">
                {data.kinds.map(k => (
                  <tr key={k.kind} className={k.links || k.arrivals ? 'text-white' : 'text-white/40'}>
                    <td className="px-3 py-2 whitespace-nowrap">{t(`admin.shares.kinds.${k.kind}`, k.kind) as string}</td>
                    {COLUMNS.map(c => <td key={c} className={cell}>{fmt(k[c])}</td>)}
                  </tr>
                ))}
                <tr className="text-white font-semibold">
                  <td className="px-3 py-2">{t('admin.shares.total')}</td>
                  {COLUMNS.map(c => <td key={c} className={cell}>{fmt(total(c))}</td>)}
                </tr>
              </tbody>
            </table>
          </div>

          <div className={`${panel} p-4`}>
            <div className="text-xs font-medium text-white/55 mb-2">{t('admin.shares.top')}</div>
            {data.top.length === 0 ? <p className="text-sm text-white/40">{t('admin.origins.none')}</p> : (
              <ol className="divide-y divide-white/[0.07]">
                {data.top.map((r, i) => (
                  <li key={`${r.userId ?? 'g'}-${r.name}-${i}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-sm">
                    <span className="min-w-0 basis-full sm:basis-0 sm:flex-1 truncate text-white">
                      {r.userId != null && r.name
                        ? <Link to={`/u/${encodeURIComponent(r.name)}`} className="hover:underline">{r.name}</Link>
                        : <>{r.name ?? '–'} <span className="text-white/40">· {t('admin.shares.guest')}</span></>}
                    </span>
                    <span className="text-white/60 tabular-nums">{t('admin.shares.topLine', {
                      sent: fmt(r.sent), arrivals: fmt(r.arrivals), singers: fmt(r.singers), parties: fmt(r.parties), accounts: fmt(r.accounts),
                    })}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </Section>
  );
};

export default AdminShares;
