'use client';

import useSWR from 'swr';
import type { Notification } from '@/lib/types/notification';

const fetcher = (url: string) => fetch(url).then((r) => { if (!r.ok) throw new Error('Failed to fetch'); return r.json(); });

type NotificationsResponse = {
  notifications: Notification[];
  unreadCount: number;
  total: number;
};

export function useNotifications() {
  const { data, error, isLoading, mutate } = useSWR<NotificationsResponse>(
    '/api/notifications?limit=20',
    fetcher,
    { refreshInterval: 30000 }
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
