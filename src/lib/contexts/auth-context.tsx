"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { storeRefreshToken } from '@/lib/webauthn';
import type { Session, User } from '@supabase/supabase-js';
import toast from 'react-hot-toast';

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
  company_name?: string;
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

const ACTIVE_TENANT_KEY = 'vynko_active_tenant_id';
const LAST_ACTIVITY_KEY = 'vynko_last_activity';
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const INACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const;

function getLastActivity(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const val = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
    return Number.isFinite(val) && val > 0 ? val : 0;
  } catch {
    return 0;
  }
}

function setLastActivity(now: number) {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
  } catch {
    // ignore
  }
}

function clearLastActivity() {
  try {
    localStorage.removeItem(LAST_ACTIVITY_KEY);
  } catch {
    // ignore
  }
}

function getStoredActiveTenantId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const val = localStorage.getItem(ACTIVE_TENANT_KEY);
    return val === '__all__' ? null : val;
  } catch {
    return null;
  }
}

export function isAllTenantsMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(ACTIVE_TENANT_KEY) === '__all__';
  } catch {
    return false;
  }
}

function setStoredActiveTenantId(id: string) {
  try {
    localStorage.setItem(ACTIVE_TENANT_KEY, id);
  } catch {
    // ignore
  }
}

function clearStoredActiveTenantId() {
  try {
    localStorage.removeItem(ACTIVE_TENANT_KEY);
  } catch {
    // ignore
  }
}

// The browser client persists the session as `supabase.auth.token` cookies
// (chunked as `supabase.auth.token.0`, `.1`, ...). Check there so we can tell
// "logged out" apart from "session exists but the first refresh failed".
export function hasStoredSession(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const cookieNames = document.cookie.split(';').map((c) => c.split('=')[0].trim());
    if (cookieNames.some((n) => n === 'supabase.auth.token' || n.startsWith('supabase.auth.token.'))) {
      return true;
    }
    return localStorage.getItem('supabase.auth.token') !== null;
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)),
  ]);
}

// When the app is opened after a long time the access token has expired, so
// the first getSession() must hit the network to refresh it. If that request
// transiently fails (flaky network, device just waking up, 5xx from the auth
// server) getSession() resolves to null and the app settles on "logged out"
// until a manual reload. Retry a few times while a stored session still
// exists, and bound each attempt so a hung request can't leave `loading`
// stuck forever.
async function getSessionWithRetry(): Promise<Session | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 1200));
    }
    try {
      const { data } = await withTimeout(supabase.auth.getSession(), 6000);
      if (data.session) return data.session;
    } catch (err) {
      console.warn('Auth session check attempt failed:', err);
    }
    if (!hasStoredSession()) return null;
  }
  return null;
}

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  tenant: TenantInfo | null;
  tenants: TenantInfo[];
  role: string | null;
  loading: boolean;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
  allTenants: boolean;
  loadProfileAndTenant: () => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [allTenants, setAllTenants] = useState(false);
  const [loading, setLoading] = useState(true);

  const activeFetchRef = useRef<Promise<void> | null>(null);
  const lastFetchedUserIdRef = useRef<string | null>(null);
  // True once a session has been established through onAuthStateChange. Guards
  // the initial getSessionWithRetry() against clobbering that session when it
  // finally resolves (e.g. after timing out on a stale-cookie refresh that the
  // user already replaced by signing in).
  const sessionViaEventRef = useRef(false);

  const loadProfileAndTenant = useCallback(async () => {
    if (activeFetchRef.current) return activeFetchRef.current;

    const promise = (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          setProfile(null);
          setTenant(null);
          setTenants([]);
          setRole(null);
          lastFetchedUserIdRef.current = null;
          return;
        }

        const storedId = localStorage.getItem('vynko_active_tenant_id');
        const isAll = storedId === '__all__';
        const activeTenantId = !isAll ? getStoredActiveTenantId() : null;

        const headers: Record<string, string> = {
          Authorization: `Bearer ${session.access_token}`,
          'x-refresh-token': session.refresh_token ?? '',
        };
        if (isAll) {
          headers['x-active-tenant-id'] = '__all__';
        } else if (activeTenantId) {
          headers['x-active-tenant-id'] = activeTenantId;
        }

        const response = await fetch('/api/session', {
          credentials: 'include',
          headers,
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to fetch session');

        const tenantsList: TenantInfo[] = data.tenants || [];

        let bestStatus = 'free';
        let bestPlan = 'starter';
        let bestPeriodEnd: string | null = null;
        let bestCreatedAt: string | null = null;
        const planRank: Record<string, number> = { enterprise: 4, business: 3, starter: 2, free: 1 };
        const statusRank: Record<string, number> = { active: 5, incomplete: 4, past_due: 3, canceled: 2, free: 1 };
        for (const t of tenantsList) {
          const s = t.subscription_status || 'free';
          const p = t.subscription_plan || 'free';
          const curRank = (statusRank[s] || 0) + (planRank[p] || 0);
          const bestRank = (statusRank[bestStatus] || 0) + (planRank[bestPlan] || 0);
          if (curRank > bestRank) {
            bestStatus = s;
            bestPlan = p;
            bestPeriodEnd = t.subscription_current_period_end || null;
            bestCreatedAt = t.created_at || null;
          }
        }

        let currentTenant = data.tenant as TenantInfo | null;
        if (currentTenant) {
          currentTenant = {
            ...currentTenant,
            subscription_status: bestStatus,
            subscription_plan: bestPlan,
            subscription_current_period_end: bestPeriodEnd || currentTenant.subscription_current_period_end,
            created_at: bestCreatedAt || currentTenant.created_at,
          };
        }

        setProfile(data.profile);
        setTenant(isAll ? null : currentTenant);
        setTenants(tenantsList);
        setRole(data.role);
        setAllTenants(isAll);
        if (!isAll && data.tenant?.id) {
          setStoredActiveTenantId(data.tenant.id);
        }
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

  const switchTenant = useCallback(async (tenantId: string) => {
    setStoredActiveTenantId(tenantId);
    await loadProfileAndTenant();
  }, [loadProfileAndTenant]);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      // If the tab was closed longer than the inactivity window ago, expire
      // the session immediately instead of restoring it from cookies.
      const lastActivity = getLastActivity();
      if (lastActivity > 0 && Date.now() - lastActivity > INACTIVITY_TIMEOUT_MS && hasStoredSession()) {
        await supabase.auth.signOut();
      }

      try {
        const session = await getSessionWithRetry();
        if (!mounted) return;

        if (session?.user) {
          setUser(session.user);
          if (lastFetchedUserIdRef.current !== session.user.id) {
            await loadProfileAndTenant();
          }
        } else if (!sessionViaEventRef.current) {
          setUser(null);
          setProfile(null);
          setTenant(null);
          setTenants([]);
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
          sessionViaEventRef.current = true;
          setUser(session.user);
          if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || lastFetchedUserIdRef.current !== session.user.id) {
            await loadProfileAndTenant();
          }
        } else {
          sessionViaEventRef.current = false;
          setUser(null);
          setProfile(null);
          setTenant(null);
          setTenants([]);
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
    await supabase.auth.signOut();
    sessionViaEventRef.current = false;
    setUser(null);
    setProfile(null);
    setTenant(null);
    setTenants([]);
    setRole(null);
    clearStoredActiveTenantId();
    clearLastActivity();
    lastFetchedUserIdRef.current = null;
  };

  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  // Log the user out automatically after 30 minutes of inactivity. The timer
  // is reset on any user interaction while there is an active session, and the
  // last activity timestamp is persisted so a closed tab also expires.
  useEffect(() => {
    if (!user) return;

    let timer: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      setLastActivity(Date.now());
      clearTimeout(timer);
      timer = setTimeout(() => {
        clearLastActivity();
        void logoutRef.current();
        toast('Tu sesión expiró por inactividad. Iniciá sesión nuevamente.', {
          duration: 5000,
        });
      }, INACTIVITY_TIMEOUT_MS);
    };

    INACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      clearTimeout(timer);
      INACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, resetTimer));
    };
  }, [user]);

  const value: AuthContextValue = {
    user,
    profile,
    tenant,
    tenants,
    role,
    loading,
    logout,
    isAuthenticated: !!user,
    allTenants,
    loadProfileAndTenant,
    switchTenant,
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
