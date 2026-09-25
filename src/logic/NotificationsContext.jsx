import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { getNotifications, markNotificationsSeen } from './authApi';

const EMPTY = { friendRequests: [], unseen: 0 };

const NotificationsContext = createContext({
  ...EMPTY, requestsKey: '', refresh: async () => null, markSeen: async () => {},
});

/**
 * The signed-in user's notifications: the pending friend requests to them,
 * newest first, and how many arrived since they last opened the bell
 * (NotificationBell, which also keeps this fresh while it is on screen).
 * The friends list on the profile page refreshes it after a change and
 * reloads itself when the requests change (`requestsKey`).
 */
export const NotificationsProvider = ({ children }) => {
  const { user } = useAuth();
  const [state, setState] = useState(EMPTY);
  const userIdRef = useRef(null);
  userIdRef.current = user?.id ?? null;

  /** Loads the latest and returns it (null when signed out or offline). */
  const refresh = useCallback(async () => {
    const id = userIdRef.current;
    if (!id) { setState(EMPTY); return null; }
    try {
      const data = await getNotifications();
      if (userIdRef.current !== id) return null; // signed out or switched meanwhile
      setState(data);
      return data;
    } catch {
      return null; // offline: keep what we have
    }
  }, []);

  useEffect(() => { refresh(); }, [user?.id, refresh]);

  /**
   * The user looked at `data` (what refresh returned): everything up to its
   * newest request is seen, so one that arrives meanwhile stays new.
   */
  const markSeen = useCallback(async (data) => {
    const newest = data?.friendRequests?.[0]?.createdAt;
    if (!data?.unseen || !newest) return;
    setState(s => ({ ...s, unseen: 0 }));
    try { await markNotificationsSeen(newest); } catch { /* the badge comes back on the next refresh */ }
  }, []);

  const requestsKey = useMemo(() => state.friendRequests.map(r => r.username).join('\n'), [state.friendRequests]);
  const value = useMemo(() => ({ ...state, requestsKey, refresh, markSeen }), [state, requestsKey, refresh, markSeen]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
};

export const useNotifications = () => useContext(NotificationsContext);
