import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getMe, getMyBest, logout as apiLogout, type BestScores, type Me } from './authApi';
import { rememberRustPartyPage } from './rustPartyPage';

/** What useAuth gives */
export interface AuthContextValue {
  /** the signed-in user, or null */
  user: Me | null;
  /** true until /auth/me first answered */
  loading: boolean;
  /** the signed-in user's best per song (empty when signed out) */
  best: BestScores;
  refresh: () => Promise<void>;
  refreshBest: () => Promise<void>;
  /** signed in or out (null) here: the new user, and their best scores */
  setUser: (me: Me | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({ user: null, loading: true, best: {}, refresh: async () => {}, refreshBest: async () => {}, setUser: () => {}, logout: async () => {} });

/**
 * Who is signed in (session cookie) plus their best score per song, used for
 * the star badges on song cards. Re-checked when the tab regains focus, so
 * signing in from another tab is picked up without a reload.
 */
export const AuthProvider = ({ children }: { children?: React.ReactNode }) => {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [best, setBest] = useState<BestScores>({});
  const userIdRef = useRef<number | null>(null);

  const refreshBest = useCallback(async () => {
    try { setBest(await getMyBest()); } catch { /* keep what we have */ }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await getMe();
      setUser(me);
      if (me?.id !== userIdRef.current) {
        userIdRef.current = me?.id ?? null;
        if (me) await refreshBest(); else setBest({});
      }
    } catch { /* offline: keep the last known state */ }
    finally { setLoading(false); }
  }, [refreshBest]);

  useEffect(() => { refresh(); }, [refresh]);
  // the Rust party page's switch, for the song pages of this browser (logic/rustPartyPage.ts)
  useEffect(() => { if (!loading) rememberRustPartyPage(Boolean(user?.rustPartyPage)); }, [user, loading]);
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => { document.removeEventListener('visibilitychange', onFocus); window.removeEventListener('focus', onFocus); };
  }, [refresh]);

  const signedIn = useCallback((me: Me | null) => {
    setUser(me);
    userIdRef.current = me?.id ?? null;
    if (me) refreshBest(); else setBest({});
  }, [refreshBest]);

  const logout = useCallback(async () => {
    try { await apiLogout(); } catch { /* cookie is cleared server-side; state is reset regardless */ }
    signedIn(null);
  }, [signedIn]);

  const value = useMemo((): AuthContextValue => ({ user, loading, best, refresh, refreshBest, setUser: signedIn, logout }), [user, loading, best, refresh, refreshBest, signedIn, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
