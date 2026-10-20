import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getMe, getMyBest, logout as apiLogout } from './authApi';

const AuthContext = createContext({ user: null, loading: true, best: {}, refresh: async () => {}, refreshBest: async () => {}, setUser: () => {}, logout: async () => {} });

/**
 * Who is signed in (session cookie) plus their best score per song, used for
 * the star badges on song cards. Re-checked when the tab regains focus, so
 * signing in from another tab is picked up without a reload.
 */
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [best, setBest] = useState({});
  const userIdRef = useRef(null);

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
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => { document.removeEventListener('visibilitychange', onFocus); window.removeEventListener('focus', onFocus); };
  }, [refresh]);

  const signedIn = useCallback((me) => {
    setUser(me);
    userIdRef.current = me?.id ?? null;
    if (me) refreshBest(); else setBest({});
  }, [refreshBest]);

  const logout = useCallback(async () => {
    try { await apiLogout(); } catch { /* cookie is cleared server-side; state is reset regardless */ }
    signedIn(null);
  }, [signedIn]);

  const value = useMemo(() => ({ user, loading, best, refresh, refreshBest, setUser: signedIn, logout }), [user, loading, best, refresh, refreshBest, signedIn, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
