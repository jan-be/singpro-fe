import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { getNotifications, markNotificationsSeen, type Notifications } from './authApi';
import { newestNotification } from './achievements';

/** What useNotifications gives: the notifications themselves, and the ways to reload them and mark them seen */
export interface NotificationsContextValue extends Notifications {
  /** the pending requests' names, one per line: changes when they do */
  requestsKey: string;
  /** loads the latest and returns it (null when signed out or offline) */
  refresh: () => Promise<Notifications | null>;
  /** everything up to the newest item of `data` (what refresh returned) is seen */
  markSeen: (data: Notifications) => Promise<void>;
}

const EMPTY: Notifications = { friendRequests: [], achievements: [], unseen: 0 };

const NotificationsContext = createContext<NotificationsContextValue>({
  ...EMPTY, requestsKey: '', refresh: async () => null, markSeen: async () => {},
});

/**
 * The signed-in user's notifications: the pending friend requests to them
 * and the achievements they recently earned, each newest first, and how many
 * arrived since they last opened the bell (NotificationBell, which also keeps
 * this fresh while it is on screen). The friends list on the profile page
 * refreshes it after a change and reloads itself when the requests change
 * (`requestsKey`).
 */
export const NotificationsProvider = ({ children }: { children?: React.ReactNode }) => {
  const { user } = useAuth();
  const [state, setState] = useState(EMPTY);
  const userIdRef = useRef<number | null>(null);
  userIdRef.current = user?.id ?? null;

  /** Loads the latest and returns it (null when signed out or offline). */
  const refresh = useCallback(async () => {
    const id = userIdRef.current;
    if (!id) { setState(EMPTY); return null; }
    try {
      const data = { ...EMPTY, ...await getNotifications() };
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
   * newest item is seen, so one that arrives meanwhile stays new.
   */
  const markSeen = useCallback(async (data: Notifications) => {
    const newest = newestNotification(data);
    if (!data.unseen || !newest) return;
    setState(s => ({ ...s, unseen: 0 }));
    try { await markNotificationsSeen(newest); } catch { /* the badge comes back on the next refresh */ }
  }, []);

  const requestsKey = useMemo(() => state.friendRequests.map(r => r.username).join('\n'), [state.friendRequests]);
  const value = useMemo((): NotificationsContextValue => ({ ...state, requestsKey, refresh, markSeen }), [state, requestsKey, refresh, markSeen]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
};

export const useNotifications = () => useContext(NotificationsContext);
