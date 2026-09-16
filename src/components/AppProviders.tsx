'use client';

import React from 'react';
import { SWRConfig } from 'swr';
import AutoReload from '@/components/AutoReload';

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: true,
        revalidateOnReconnect: true,
        revalidateIfStale: true,
        dedupingInterval: 5_000,
        refreshInterval: 60_000,
      }}
    >
      {children}
      <AutoReload />
    </SWRConfig>
  );
}