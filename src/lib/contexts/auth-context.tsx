"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import { useSWRConfig } from 'swr';
import type { User } from '@supabase/supabase-js';
import toast from 'react-hot-toast';
import { clearAuthLinkErrorFromUrl, getAuthLinkErrorParams } from '@/lib/auth-link-error';
import { NEW_ACCOUNT_PLAN } from '@/lib/plans';

// An expired or already-used email link leaves a Supabase auth error in the
// URL (e.g. `?error=access_denied&error_code=otp_expired...`). It doesn't
// block anything — the account works fine once confirmed — so don't alarm the
// user, just silently clean the address bar.
function clearStaleAuthLinkError() {
  if (!getAuthLinkErrorParams()) return;
  clearAuthLinkErrorFromUrl();
}

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
// Cada cuanto se le pregunta al servidor si la sesion sigue viva. El token de
// acceso caduca en ~1h y lo refresca el cliente de servidor al reescribir la
// cookie, asi que este intervalo no compite con ese refresco: solo detecta que
// la sesion ya no se puede renovar (refresh token revocado, cookie expirada).
const SESSION_REVALIDATE_INTERVAL_MS = 5 * 60 * 1000;
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

// The browser client (`@supabase/ssr`) persists the session in a cookie named
// `sb-<projectRef>-auth-token`, chunked as `.0`, `.1`, ... when the payload
// exceeds the per-cookie limit. Older setups used `supabase.auth.token`, so
// both are accepted. Matching on the shape instead of the project ref keeps
// this correct across projects and Supabase upgrades.
const LEGACY_AUTH_KEY = 'supabase.auth.token';
const CHUNKED_AUTH_KEY = /^sb-.+-auth-token(\.\d+)?$/;

export function isSupabaseAuthKey(name: string): boolean {
  return name === LEGACY_AUTH_KEY || name.startsWith(`${LEGACY_AUTH_KEY}.`) || CHUNKED_AUTH_KEY.test(name);
}

function storedAuthKeys(): string[] {
  const names: string[] = [];
  try {
    for (const c of document.cookie.split(';')) {
      const name = c.split('=')[0]?.trim();
      if (name && isSupabaseAuthKey(name)) names.push(name);
    }
  } catch {
    // ignore
  }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && isSupabaseAuthKey(key)) names.push(key);
    }
  } catch {
    // ignore
  }
  return names;
}

// Nota: ya no existe un `hasStoredSession()`. Antes servia para distinguir
// "deslogueado" de "la sesion existe pero el primer refresh fallo", porque
// `getSession()` del navegador devolvia null en ambos casos. Con la cookie de
// sesion HttpOnly esa ambiguedad no puede ocurrir: la respuesta de
// `/api/session` es la unica fuente de verdad y un `user: null` es definitivo.
// Se evita deliberadamente reincorporar un chequeo de cookies desde el
// navegador: volveria a exponer la sesion al JS, que es justo lo que secerra.

function sameTenantsList(a: TenantInfo[] | null, b: TenantInfo[]): boolean {
  if (!a) return false;
  if (a.length !== b.length) return false;
  return a.every((t, i) => {
    const u = b[i];
    return u && t.id === u.id && t.name === u.name && t.subscription_plan === u.subscription_plan && t.subscription_status === u.subscription_status;
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)),
  ]);
}

// Upper bound for a single profile/tenant load. The /api/session request (and
// the token refresh it may trigger) can hang on a cold serverless start, and
// `authLoading` gates both the landing redirect and the dashboard gate: if it
// stays true the app settles on "logged-in but stuck" until a manual reload.
const PROFILE_LOAD_TIMEOUT_MS = 10_000;

// Resolucion de sesion contra el servidor.
//
// Antes se leia la sesion con `supabase.auth.getSession()` en el navegador. Con
// la cookie de sesion HttpOnly eso ya no es posible (y no debe ser: si el JS
// puede leer el token, un XSS se lo lleva), asi que la pregunta "hay sesion?" la
// contesta `/api/session`, que resuelve al usuario desde la cookie.
//
// Esto tambien elimina la ambiguedad que justificaba `hasStoredSession()`: la
// respuesta del servidor es definitiva. "sin usuario" significa deslogueado de
// verdad y no se reintenta; solo se reintenta cuando el request fallo, que es
// el unico caso indistinguible de un problema de red.
const SESSION_PROBE_TIMEOUT_MS = 8000;

type SessionProbe = { kind: 'user'; user: User } | { kind: 'anonymous' } | { kind: 'error' };

async function probeSession(): Promise<SessionProbe> {
  try {
    const response = await withTimeout(
      fetch('/api/session', { credentials: 'include' }),
      SESSION_PROBE_TIMEOUT_MS,
    );
    if (!response.ok) return { kind: 'error' };
    const data = await response.json();
    return data?.user ? { kind: 'user', user: data.user as User } : { kind: 'anonymous' };
  } catch {
    return { kind: 'error' };
  }
}

async function resolveSessionUser(): Promise<User | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 1000));
    }
    const probe = await probeSession();
    if (probe.kind === 'user') return probe.user;
    if (probe.kind === 'anonymous') return null;
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
  refreshSession: () => Promise<boolean>;
  switchTenant: (tenantId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Wipe every Supabase auth cookie from the browser. `signOut()` normally
// clears them, but on flaky/slow networks it can leave stale
// `sb-*-auth-token` chunks behind, which would let a follow-up request
// authenticate as the previous account (data leak between tenants). This is a
// belt-and-suspenders hard clear.
export function clearSupabaseAuthCookies() {
  if (typeof document === 'undefined') return;
  try {
    for (const name of storedAuthKeys()) {
      document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0; SameSite=Lax`;
      document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0`;
    }
  } catch {
    // ignore
  }
}

function clearStoredAuthStorage() {
  clearStoredActiveTenantId();
  clearLastActivity();
  clearSupabaseAuthCookies();
  try {
    for (const key of storedAuthKeys()) window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { mutate: globalMutate } = useSWRConfig();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [allTenants, setAllTenants] = useState(false);
  const [loading, setLoading] = useState(true);

  const activeFetchRef = useRef<Promise<void> | null>(null);
  const lastFetchedUserIdRef = useRef<string | null>(null);
  // Snapshot de los últimos datos aplicados al estado. Sirve para comparar antes
  // de setState y así no recrear referencias de `tenants`/`tenant`/`profile`
  // cuando los datos no cambiaron (p.ej. al volver a la pestaña el navegador
  // re-emite SIGNED_IN/TOKEN_REFRESHED con el mismo usuario).
  const lastLoadedRef = useRef<{
    profileId: string | null;
    profileEmail: string | null;
    tenantId: string | null;
    tenantName: string | null;
    tenantPlan: string | null;
    tenantStatus: string | null;
    role: string | null;
    allTenants: boolean;
    tenants: TenantInfo[];
  } | null>(null);
  // Espejo de `user` para que el callback de revalidacion pueda consultarlo.
  // Va en un ref y no como dependencia del efecto porque `user` en la lista
  // reiniciaria el efecto completo (volveria a correr `init()`) y la revalidacion
  // volveria a disparar su propio cambio de estado, en bucle.
  const userRef = useRef<User | null>(null);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const loadProfileAndTenant = useCallback(async () => {
    if (activeFetchRef.current) return activeFetchRef.current;

    const promise = (async () => {
      try {
        const storedId = localStorage.getItem('vynko_active_tenant_id');
        const isAll = storedId === '__all__';
        const activeTenantId = !isAll ? getStoredActiveTenantId() : null;

        const headers: Record<string, string> = {};
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

        // La cookie de sesion puede ser HttpOnly, asi que el navegador no puede
        // leer el access token: la identidad viaja en la respuesta del servidor.
        const sessionUser = (data.user as User | null) ?? null;
        if (!sessionUser) {
          setProfile(null);
          setTenant(null);
          setTenants([]);
          setRole(null);
          lastFetchedUserIdRef.current = null;
          return;
        }

        const tenantsList: TenantInfo[] = data.tenants || [];

        let bestStatus = 'free';
        let bestPlan: string = NEW_ACCOUNT_PLAN;
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
          }
        }
        // The owner shares one subscription across all branches: the first
        // (earliest) created_at is the reference date for the trial/payment.
        for (const t of tenantsList) {
          if (t.created_at && (!bestCreatedAt || new Date(t.created_at) < new Date(bestCreatedAt))) {
            bestCreatedAt = t.created_at;
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

        const appliedTenant = isAll ? null : currentTenant;
        const nextSnapshot = {
          profileId: (data.profile as UserProfile | null)?.id ?? null,
          profileEmail: (data.profile as UserProfile | null)?.email ?? null,
          tenantId: appliedTenant?.id ?? null,
          tenantName: appliedTenant?.name ?? null,
          tenantPlan: appliedTenant?.subscription_plan ?? null,
          tenantStatus: appliedTenant?.subscription_status ?? null,
          role: (data.role as string | null) ?? null,
          allTenants: isAll,
          tenants: tenantsList,
        };

        const sameData =
          lastLoadedRef.current &&
          lastLoadedRef.current.profileId === nextSnapshot.profileId &&
          lastLoadedRef.current.profileEmail === nextSnapshot.profileEmail &&
          lastLoadedRef.current.tenantId === nextSnapshot.tenantId &&
          lastLoadedRef.current.tenantName === nextSnapshot.tenantName &&
          lastLoadedRef.current.tenantPlan === nextSnapshot.tenantPlan &&
          lastLoadedRef.current.tenantStatus === nextSnapshot.tenantStatus &&
          lastLoadedRef.current.role === nextSnapshot.role &&
          lastLoadedRef.current.allTenants === nextSnapshot.allTenants &&
          sameTenantsList(lastLoadedRef.current.tenants, nextSnapshot.tenants);

        if (sameData) {
          // Los datos ya estaban aplicados al estado; no recrear referencias
          // de arrays/objetos o los efectos de las páginas (que dependen de
          // `tenants`, `tenant`...) volverían a disparar sus fetches.
          lastFetchedUserIdRef.current = sessionUser.id;
          return;
        }
        lastLoadedRef.current = nextSnapshot;

        setProfile(data.profile);
        setTenant(isAll ? null : currentTenant);
        setTenants(tenantsList);
        setRole(data.role);
        setAllTenants(isAll);
        if (!isAll && data.tenant?.id) {
          setStoredActiveTenantId(data.tenant.id);
        }
        lastFetchedUserIdRef.current = sessionUser.id;
      } catch (err) {
        console.error('Error loading profile/tenant:', err);
      } finally {
        activeFetchRef.current = null;
      }
    })();

    // Race the whole load against a timeout so `loading` can never get stuck
    // (the init and onAuthStateChange paths both `await` this before clearing
    // `authLoading`). The underlying promise keeps running in the background
    // and applies its state whenever it finally settles.
    activeFetchRef.current = withTimeout(promise, PROFILE_LOAD_TIMEOUT_MS).catch(
      () => undefined
    ) as Promise<void>;
    return activeFetchRef.current;
  }, []);

  const switchTenant = useCallback(async (tenantId: string) => {
    setStoredActiveTenantId(tenantId);
    await loadProfileAndTenant();
  }, [loadProfileAndTenant]);

  const logout = useCallback(async () => {
    setUser(null);
    setProfile(null);
    setTenant(null);
    setTenants([]);
    setRole(null);
    setAllTenants(false);
    activeFetchRef.current = null;
    lastFetchedUserIdRef.current = null;
    lastLoadedRef.current = null;
    clearStoredAuthStorage();
    void globalMutate(() => true, undefined, { revalidate: false });
    try {
      // El borrado lo hace el servidor: con una cookie HttpOnly el navegador no
      // puede invalidarla, y `signOut` ademas revoca el refresh token.
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // El estado local ya quedo limpiado, que es lo que ve el usuario. Si el
      // request fallo, la cookie sigue viva hasta que expire: el proxy la
      // seguira aceptando, asi que solo afecta al silencio de esta pestana.
    }
  }, [globalMutate]);

  const refreshSession = useCallback(async () => {
    setLoading(true);
    const sessionUser = await resolveSessionUser();
    if (!sessionUser) {
      setUser(null);
      setLoading(false);
      return false;
    }
    setUser(sessionUser);
    await loadProfileAndTenant();
    setLoading(false);
    return true;
  }, [loadProfileAndTenant]);

  useEffect(() => {
    let mounted = true;

    const applySignedOut = () => {
      clearStaleAuthLinkError();
      setUser(null);
      setProfile(null);
      setTenant(null);
      setTenants([]);
      setRole(null);
      setAllTenants(false);
      lastFetchedUserIdRef.current = null;
      lastLoadedRef.current = null;
      activeFetchRef.current = null;
    };

    const init = async () => {
      // Si la pestana estuvo cerrada mas alla del ventana de inactividad, la
      // sesion se da por expirada sin siquiera restaurarla.
      const lastActivity = getLastActivity();
      if (lastActivity > 0 && Date.now() - lastActivity > INACTIVITY_TIMEOUT_MS) {
        await logout();
        if (mounted) {
          applySignedOut();
          setLoading(false);
        }
        return;
      }

      try {
        const sessionUser = await resolveSessionUser();
        if (!mounted) return;

        if (sessionUser) {
          setUser(sessionUser);
          if (lastFetchedUserIdRef.current !== sessionUser.id) {
            await loadProfileAndTenant();
          }
        } else {
          // Sin sesion no hay nada que restaurar: se limpian los rastros de
          // tenant/actividad del navegador para no arrastrar estado viejo.
          clearStoredActiveTenantId();
          clearLastActivity();
          applySignedOut();
        }

        if (mounted) setLoading(false);
      } catch (err) {
        console.error('Auth initialization error:', err);
        if (mounted) setLoading(false);
      }
    };

    init();

    // Sin `onAuthStateChange`: con una cookie de sesion HttpOnly el navegador
    // no puede observar la sesion, que es justamente lo que se quiere. El token
    // de acceso lo refresca el cliente de servidor de forma transparente al
    // reescribir la cookie, asi que del lado del cliente solo hace falta
    // revalidar contra `/api/session` para enterarnos de que la sesion caduco o
    // de que se cerro desde otra pestana.
    let revalidating = false;

    const revalidate = async () => {
      if (revalidating || !mounted) return;
      revalidating = true;
      try {
        const sessionUser = await resolveSessionUser();

        if (!sessionUser) {
          // Un fallo de red devuelve null igual que un cierre de sesion, asi que
          // solo se desloguea si de verdad havia una sesion abierta. Asi un
          // problema puntual de red no tira la sesion del usuario.
          if (userRef.current) applySignedOut();
          return;
        }

        const userChanged = lastFetchedUserIdRef.current !== sessionUser.id;
        setUser(sessionUser);
        if (userChanged) {
          // Cambio de cuenta en este SPA: se descarta lo cacheado de la cuenta
          // anterior para no renderizar filas suyas bajo la nueva.
          activeFetchRef.current = null;
          lastFetchedUserIdRef.current = null;
          void globalMutate(() => true, undefined, { revalidate: false });
          await loadProfileAndTenant();
        }
      } finally {
        revalidating = false;
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') void revalidate();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    // Cubre la pestana que queda en primer plano sin cambiar de pestana ni
    // hacer foco: si el refresh token fue revocado desde otro lado, la sesion se
    // cae en el servidor y hay que notarlo igual.
    const poll = setInterval(() => void revalidate(), SESSION_REVALIDATE_INTERVAL_MS);

    return () => {
      mounted = false;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      clearInterval(poll);
    };
  }, [loadProfileAndTenant, globalMutate, logout]);

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
        void logout();
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
  }, [user, logout]);

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
    refreshSession,
    switchTenant,
  };

  // Key the subtree by user id so all child components fully remount when the
  // authenticated account changes. This guarantees no stale component-local
  // state (e.g. useState, SWR per-component, useEffect-owned timers) from the
  // previous user survives into the new session.
  return (
    <AuthContext.Provider value={value}>
      <div key={user?.id ?? '__unauthenticated__'} className="contents">
        {children}
      </div>
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
