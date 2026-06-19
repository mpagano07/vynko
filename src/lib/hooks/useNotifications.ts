'use client';

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { supabase } from '@/lib/supabaseClient';
import type { Notification } from '@/lib/types/notification';

const fetcher = (url: string) => fetch(url).then((r) => { if (!r.ok) throw new Error('Failed to fetch'); return r.json(); });

type NotificationsResponse = {
  notifications: Notification[];
  unreadCount: number;
  total: number;
};

export function useNotifications() {
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(!!session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const { data, error, isLoading, mutate } = useSWR<NotificationsResponse>(
    hasSession ? '/api/notifications?limit=20' : null,
    fetcher,
    { refreshInterval: 30000, shouldRetryOnError: false, revalidateOnFocus: false }
  );
  return {
    notifications: data?.notifications ?? [],
    unreadCount: data?.unreadCount ?? 0,
    total: data?.total ?? 0,
    isLoading,
    isError: error,
    mutate,
  };
}
