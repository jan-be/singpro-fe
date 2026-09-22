import React, { useCallback, useEffect, useState } from 'react';
import { clearDebugEntries, formatDebugEntries, getDebugEntries, subscribeDebug } from '../logic/debugLog';

/**
 * The devtools a phone does not have, shown with ?debug (see debugLog.js).
 * `snapshot` returns the live state worth seeing as text (audio, video,
 * mic), polled twice a second; below it sit the captured errors and notes.
 * "Copy" puts both on the clipboard, to paste into a chat or an issue; when
 * the clipboard is refused the text is shown selectable instead.
 */
export default function DebugOverlay({ snapshot }) {
  const [state, setState] = useState('');
  const [entries, setEntries] = useState(getDebugEntries);
  const [hidden, setHidden] = useState(false);
  const [copied, setCopied] = useState(null); // null | 'ok' | 'manual'

  useEffect(() => {
    const tick = () => { try { setState(snapshot?.() ?? ''); } catch (e) { setState(`snapshot failed: ${e.message}`); } };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [snapshot]);
  useEffect(() => subscribeDebug(() => setEntries(getDebugEntries())), []);

  const text = `${state}\n\n${formatDebugEntries(entries)}`;
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('ok');
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied('manual');
    }
  }, [text]);

  if (hidden) {
    return (
      <button type="button" onClick={() => setHidden(false)} className="fixed bottom-2 right-2 z-[60] px-2 py-1 rounded bg-black/80 text-white font-mono text-xs border border-white/20">
        debug
      </button>
    );
  }
  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] max-h-[50vh] flex flex-col bg-black/90 text-white font-mono text-[11px] leading-snug border-t border-white/20">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-white/10">
        <span className="text-neon-cyan font-bold">debug</span>
        <span className="text-white/50">{entries.length} entries</span>
        <span className="flex-1" />
        <button type="button" onClick={copy} className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20">{copied === 'ok' ? 'copied' : 'copy'}</button>
        <button type="button" onClick={clearDebugEntries} className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20">clear</button>
        <button type="button" onClick={() => setHidden(true)} className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20">hide</button>
      </div>
      {copied === 'manual' ? (
        <textarea readOnly value={text} onFocus={e => e.target.select()} className="flex-1 min-h-[30vh] p-2 bg-transparent text-white/90 resize-none outline-none" />
      ) : (
        <div className="overflow-y-auto p-2 space-y-2">
          <pre className="whitespace-pre-wrap break-all text-white/90">{state}</pre>
          <pre className="whitespace-pre-wrap break-all">
            {entries.map((e, i) => (
              <div key={i} className={e.level === 'error' ? 'text-red-300' : 'text-white/70'}>
                {new Date(e.time).toISOString().slice(11, 23)} [{e.tag}] {e.msg}{e.count > 1 ? ` ×${e.count}` : ''}
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}
