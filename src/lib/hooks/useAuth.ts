"use client";

import { useAuthContext } from '@/lib/contexts/auth-context';
export type { UserProfile, TenantInfo } from '@/lib/contexts/auth-context';

export function useAuth() {
  return useAuthContext();
}
