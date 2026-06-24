"use client";

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { User } from '@supabase/supabase-js';

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  avatar_url?: string;
}

interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  description?: string;
  subscription_plan?: string;
  created_at?: string;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfileAndTenant = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

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
    } catch (err) {
      console.error('Error loading profile/tenant:', err);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();

      if (!mounted) return;

      if (session?.user) {
        setUser(session.user);
        await loadProfileAndTenant();
      } else {
        setUser(null);
        setProfile(null);
        setTenant(null);
        setRole(null);
      }
      setLoading(false);
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;

        if (session?.user) {
          setUser(session.user);
          await loadProfileAndTenant();
        } else {
          setUser(null);
          setProfile(null);
          setTenant(null);
          setRole(null);
        }

        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
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
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setTenant(null);
    setRole(null);
  };

  return {
    user,
    profile,
    tenant,
    role,
    loading,
    logout,
    isAuthenticated: !!user,
  };
}

