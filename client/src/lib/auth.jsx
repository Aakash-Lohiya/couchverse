import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import { getSocket, dropSocket } from './socket.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [usernameChanged, setUsernameChanged] = useState(false);
  const [settings, setSettings] = useState({ chatPopup: 'everyone', emojiPopup: 'everyone', autoFullscreen: true });
  const [unread, setUnread] = useState(0);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);

  const toast = useCallback((text, kind = 'info', ttl = 4000) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl);
  }, []);

  const applySession = useCallback((s) => {
    if (s.token) setToken(s.token);
    setUser(s.user);
    setNeedsProfile(!!s.needsProfile);
    setUsernameChanged(!!s.usernameChanged);
    if (s.settings) setSettings(s.settings);
    if (typeof s.unread === 'number') setUnread(s.unread);
  }, []);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      return null;
    }
    try {
      const me = await api.get('/api/me');
      applySession(me);
      return me;
    } catch (e) {
      if (e.status === 401) {
        setToken(null);
        setUser(null);
      }
      return null;
    }
  }, [applySession]);

  useEffect(() => {
    (async () => {
      try {
        setConfig(await api.get('/api/config'));
      } catch {
        setConfig({ googleClientId: null, allowDevLogin: false, platforms: [] });
      }
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  // Global socket: notifications + friend changes.
  useEffect(() => {
    if (!user) return;
    const s = getSocket();
    const onNotif = (n) => {
      setUnread(n.unread ?? ((u) => u + 1));
      const who = n.payload?.user?.displayName || 'Someone';
      const text =
        n.type === 'friend_request'
          ? `${who} sent you a friend request`
          : n.type === 'friend_accepted'
            ? `${who} accepted your friend request`
            : n.type === 'friend_declined'
              ? `${who} declined your friend request`
              : null;
      if (text) toast(text, 'notif');
      window.dispatchEvent(new CustomEvent('cv:notification', { detail: n }));
    };
    const onFriends = () => window.dispatchEvent(new CustomEvent('cv:friends-changed'));
    s.on('notification', onNotif);
    s.on('friends:changed', onFriends);
    return () => {
      s.off('notification', onNotif);
      s.off('friends:changed', onFriends);
    };
  }, [user?.id, toast]);

  const logout = useCallback(() => {
    setToken(null);
    dropSocket();
    setUser(null);
    setNeedsProfile(false);
  }, []);

  const value = useMemo(
    () => ({ user, needsProfile, usernameChanged, settings, setSettings, unread, setUnread, config, loading, applySession, refresh, logout, toast, toasts }),
    [user, needsProfile, usernameChanged, settings, unread, config, loading, applySession, refresh, logout, toast, toasts],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
