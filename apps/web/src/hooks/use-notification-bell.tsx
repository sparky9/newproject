'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createApiClient } from '@/lib/api';

interface NotificationBellContextValue {
  unreadCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
  optimisticDecrement: () => void;
}

const NotificationBellContext = createContext<NotificationBellContextValue | undefined>(
  undefined
);

const POLL_INTERVAL_MS = 30000;

export function NotificationBellProvider({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();
  const api = useMemo(() => createApiClient(getToken), [getToken]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchCount = useMemo(
    () =>
      async (silent = false) => {
        if (!silent) {
          setLoading(true);
        }
        try {
          const stats = await api.getNotificationStats();
          setUnreadCount(stats.unread ?? 0);
        } catch (error) {
          console.error('Failed to fetch notification count', error);
          setUnreadCount(0);
        } finally {
          if (!silent) {
            setLoading(false);
          }
        }
      },
    [api]
  );

  useEffect(() => {
    let active = true;

    const kickOff = async () => {
      if (!active) return;
      await fetchCount(false);
      if (!active) return;
      pollRef.current = setTimeout(loop, POLL_INTERVAL_MS);
    };

    const loop = async () => {
      if (!active) return;
      await fetchCount(true);
      if (!active) return;
      pollRef.current = setTimeout(loop, POLL_INTERVAL_MS);
    };

    void kickOff();

    return () => {
      active = false;
      if (pollRef.current) {
        clearTimeout(pollRef.current);
      }
    };
  }, [fetchCount]);

  const value = useMemo<NotificationBellContextValue>(
    () => ({
      unreadCount,
      loading,
      refresh: () => fetchCount(false),
      optimisticDecrement: () => setUnreadCount((count) => Math.max(0, count - 1)),
    }),
    [fetchCount, loading, unreadCount]
  );

  return (
    <NotificationBellContext.Provider value={value}>
      {children}
    </NotificationBellContext.Provider>
  );
}

export function useNotificationBell() {
  const context = useContext(NotificationBellContext);
  if (!context) {
    throw new Error('useNotificationBell must be used within NotificationBellProvider');
  }
  return context;
}
