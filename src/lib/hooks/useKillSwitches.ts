'use client';

import useSWR from 'swr';
import { fetchWithTenant } from '@/lib/fetchWithTenant';
import type { KillSwitchEnvOverrides, KillSwitchState } from '@/lib/kill-switch';

export interface KillSwitchStatus {
  kill_switches: KillSwitchState;
  env_overrides: KillSwitchEnvOverrides;
}

export const EMPTY_KILL_SWITCH_STATE: KillSwitchState = {
  sales: false,
  payments: false,
  forecast: false,
  imports: false,
  maintenance: false,
};

async function fetcher(url: string): Promise<KillSwitchStatus> {
  const response = await fetchWithTenant(url, { cache: 'no-store' });
  if (!response.ok) throw new Error('Failed to fetch kill switch status');
  return response.json();
}

/**
 * Estado de los kill switches, refrescado cada 15 s.
 *
 * El cache del servidor es de 10 s, asi que en el peor caso la UI refleja un
 * cambio en ~25 s. El enforcement real es del lado del servidor: esto es solo
 * para el banner y para deshabilitar botones.
 */
export function useKillSwitches() {
  const { data, error } = useSWR<KillSwitchStatus>('/api/kill-switch/status', fetcher, {
    refreshInterval: 15_000,
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  });

  return {
    killSwitches: data?.kill_switches ?? EMPTY_KILL_SWITCH_STATE,
    envOverrides: data?.env_overrides ?? {},
    isLoading: !data && !error,
  };
}
