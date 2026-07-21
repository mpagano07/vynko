"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { storeRefreshToken } from '@/lib/webauthn';
import type { User } from '@supabase/supabase-js';

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  avatar_url?: string;
}

export interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  description?: string;
  subscription_plan?: string;
  subscription_status?: string;
  subscription_current_period_end?: string;
  created_at?: string;
  razon_social?: string;
  cuit?: string;
  punto_venta?: number;
  iva_condition?: string;
  ingresos_brutos?: string;
  inicio_actividades?: string;
  business_address?: string;
  business_city?: string;
  business_province?: string;
  business_zip?: string;
  business_phone?: string;
  business_email?: string;
}

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  tenant: TenantInfo | null;
  role: string | null;
  loading: boolean;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
  loadProfileAndTenant: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const activeFetchRef = useRef<Promise<void> | null>(null);
  const lastFetchedUserIdRef = useRef<string | null>(null);

  const loadProfileAndTenant = useCallback(async () => {
    if (activeFetchRef.current) return activeFetchRef.current;

    const promise = (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          setProfile(null);
          setTenant(null);
          setRole(null);
          lastFetchedUserIdRef.current = null;
          return;
        }

        const response = await fetch('/api/session', {
          credentials: 'include',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'x-refresh-token': session.refresh_token ?? '',
          },
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to fetch session');

        setProfile(data.profile);
        setTenant(data.tenant);
        setRole(data.role);
        lastFetchedUserIdRef.current = session.user.id;
      } catch (err) {
        console.error('Error loading profile/tenant:', err);
      } finally {
        activeFetchRef.current = null;
      }
    })();

    activeFetchRef.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!mounted) return;

        if (session?.user) {
          setUser(session.user);
          if (lastFetchedUserIdRef.current !== session.user.id) {
            await loadProfileAndTenant();
          }
        } else {
          setUser(null);
          setProfile(null);
          setTenant(null);
          setRole(null);
        }
      } catch (err) {
        console.error('Auth initialization error:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;

        if (session?.refresh_token) {
          storeRefreshToken(session.refresh_token);
        }

        if (session?.user) {
          setUser(session.user);
          if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || lastFetchedUserIdRef.current !== session.user.id) {
            await loadProfileAndTenant();
          }
        } else {
          setUser(null);
          setProfile(null);
          setTenant(null);
          setRole(null);
          lastFetchedUserIdRef.current = null;
        }

        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
          setLoading(false);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfileAndTenant]);

  const logout = async () => {
    await (supabase.auth as any)._removeSession();
    setUser(null);
    setProfile(null);
    setTenant(null);
    setRole(null);
    lastFetchedUserIdRef.current = null;
  };

  const value: AuthContextValue = {
    user,
    profile,
    tenant,
    role,
    loading,
    logout,
    isAuthenticated: !!user,
    loadProfileAndTenant,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
