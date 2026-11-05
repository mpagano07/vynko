'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, Lock, Power, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { isAdminProfile } from '@/lib/admin';
import { authFetch } from '@/lib/fetchWithTenant';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  KILL_AREAS,
  KILL_SWITCH_DESCRIPTIONS,
  KILL_SWITCH_ENV_NAMES,
  KILL_SWITCH_FLAG_KEYS,
  KILL_SWITCH_LABELS,
  type KillSwitchEnvOverrides,
  type KillSwitchState,
} from '@/lib/kill-switch-config';

/**
 * Panel de incidentes.
 *
 * No es un CRUD de feature flags: muestra SOLO los kill switches y usa la misma
 * API admin (`PUT /api/admin/feature-flags`) para prenderlos. La semantica es
 * la inversa de un flag de release:
 *
 *   * `enabled = true`  -> el area esta MATADA.
 *   * `enabled = false` -> el area esta VIVA.
 *
 * Matar una funcion rompe el flujo de alguien en ese momento, asi que matar
 * pide confirmacion y revivir no. Los overrides por variable de entorno se
 * muestran como candados: la env solo puede forzar ON, y desde el panel no se
 * puede deshacer (hay que sacar la variable en Vercel).
 */

type AreaKey = keyof KillSwitchState;

const ORDER: AreaKey[] = ['maintenance', ...KILL_AREAS];

const CONFIRMATION: Record<AreaKey, string> = {
  sales: '¿Matar las ventas? Nadie va a poder registrar ventas nuevas hasta que lo revivas.',
  payments: '¿Matar los pagos? Se van a bloquear checkout, portal y downgrade de Paddle.',
  forecast: '¿Matar el pronóstico? La pantalla de pronóstico va a devolver 503.',
  imports: '¿Matar las importaciones? No se van a poder importar productos.',
  maintenance:
    '¿Activar el mantenimiento global? Las páginas de la app van a mostrar /maintenance y se bloquean ventas, pagos, pronóstico e importaciones.',
};

interface FlagRow {
  flag_key: string;
  enabled: boolean;
  rollout_percent: number;
}

interface StatusResponse {
  kill_switches: KillSwitchState;
  env_overrides: KillSwitchEnvOverrides;
}

const EMPTY_STATE: KillSwitchState = {
  sales: false,
  payments: false,
  forecast: false,
  imports: false,
  maintenance: false,
};

export default function AdminOpsPage() {
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const [killSwitches, setKillSwitches] = useState<KillSwitchState>(EMPTY_STATE);
  const [envOverrides, setEnvOverrides] = useState<KillSwitchEnvOverrides>({});
  const [dbEnabled, setDbEnabled] = useState<Partial<Record<AreaKey, boolean>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<AreaKey | null>(null);

  const fetchStatus = useCallback(async () => {
    const response = await authFetch('/api/kill-switch/status', { cache: 'no-store' });
    const json = (await response.json()) as StatusResponse & { error?: string };
    if (!response.ok) throw new Error(json.error ?? 'No se pudo leer el estado');
    setKillSwitches(json.kill_switches);
    setEnvOverrides(json.env_overrides ?? {});
  }, []);

  const fetchFlags = useCallback(async () => {
    const response = await authFetch('/api/admin/feature-flags', { cache: 'no-store' });
    const json = (await response.json()) as { flags?: FlagRow[]; error?: string };
    if (!response.ok) throw new Error(json.error ?? 'No se pudieron leer los flags');

    const next: Partial<Record<AreaKey, boolean>> = {};
    for (const row of json.flags ?? []) {
      const key = (Object.keys(KILL_SWITCH_FLAG_KEYS) as AreaKey[]).find(
        (candidate) => KILL_SWITCH_FLAG_KEYS[candidate] === row.flag_key
      );
      if (key) next[key] = row.enabled;
    }
    setDbEnabled(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      await Promise.all([fetchStatus(), fetchFlags()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    }
  }, [fetchStatus, fetchFlags]);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !isAdminProfile(profile)) {
      router.replace('/dashboard');
      return;
    }
    // `refresh` es async: los setState ocurren despues del await, no durante el
    // render. La regla no distingue ese caso y marca la llamada.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();

    // El cache del servidor es de 10 s; 15 s alcanza para que el panel no
    // muestre un estado viejo si alguien mato algo desde otra pestaña.
    const timer = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(timer);
  }, [authLoading, user, profile, router, refresh]);

  async function toggle(key: AreaKey) {
    const next = !(dbEnabled?.[key] ?? killSwitches[key]);
    if (next && !window.confirm(CONFIRMATION[key])) return;

    setPending(key);
    setError(null);
    try {
      const response = await authFetch('/api/admin/feature-flags', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flag_key: KILL_SWITCH_FLAG_KEYS[key],
          enabled: next,
          rollout_percent: 100,
        }),
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(json.error ?? 'No se pudo guardar el flag');

      setDbEnabled((prev) => ({ ...prev, [key]: next }));
      await fetchStatus();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setPending(null);
    }
  }

  if (authLoading || dbEnabled === null) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-56 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-40 bg-gray-200 dark:bg-gray-700 rounded-lg" />
          <div className="h-40 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!user || !isAdminProfile(profile)) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <Card className="p-8 text-center">
          <p className="text-red-500 dark:text-red-400 text-lg font-medium">Acceso denegado</p>
          <Link href="/dashboard" className="text-cyan-600 hover:text-cyan-700 text-sm mt-2 inline-block">
            Volver al dashboard
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard"
          className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Operaciones</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Kill switches para cortar un área sin deploy
          </p>
        </div>
      </div>

      <Card className="p-5">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="text-sm text-gray-600 dark:text-gray-300 space-y-1">
            <p>
              Matar un área hace que el servidor responda <code>503</code> con{' '}
              <code>Retry-After</code>. El cambio se ve en ~10 segundos.
            </p>
            <p>
              Nunca se bloquean auth, health, cron ni los webhooks de Paddle y MercadoPago: son la
              fuente de verdad de las suscripciones.
            </p>
          </div>
        </div>
      </Card>

      {error && (
        <Card className="p-4 border border-red-200 dark:border-red-900">
          <p className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </p>
        </Card>
      )}

      {ORDER.map((key) => {
        const killed = killSwitches[key];
        const forcedByEnv = envOverrides[key] === true;
        const isPending = pending === key;
        const isMaintenance = key === 'maintenance';

        return (
          <Card
            key={key}
            className={
              isMaintenance
                ? 'p-5 border-2 border-amber-300 dark:border-amber-700'
                : 'p-5'
            }
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                    {KILL_SWITCH_LABELS[key]}
                  </h2>
                  <span
                    className={
                      killed
                        ? 'rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300'
                        : 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950 dark:text-green-300'
                    }
                  >
                    {killed ? 'MATADO' : 'VIVO'}
                  </span>
                  {forcedByEnv && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                      <Lock className="h-3 w-3" />
                      Forzado por {KILL_SWITCH_ENV_NAMES[key]}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {KILL_SWITCH_DESCRIPTIONS[key]}
                </p>
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  Flag: <code>{KILL_SWITCH_FLAG_KEYS[key]}</code>
                </p>
              </div>

              <Button
                variant={killed ? 'secondary' : isMaintenance ? 'outline' : 'primary'}
                size="sm"
                disabled={isPending || forcedByEnv}
                onClick={() => void toggle(key)}
                title={
                  forcedByEnv
                    ? `Definido por ${KILL_SWITCH_ENV_NAMES[key]}; sacá la variable para controlarlo desde acá.`
                    : undefined
                }
              >
                <Power className="mr-2 h-4 w-4" />
                {isPending ? 'Guardando…' : killed ? 'Revivir' : isMaintenance ? 'Activar' : 'Matar'}
              </Button>
            </div>
          </Card>
        );
      })}

      <p className="text-xs text-gray-500 dark:text-gray-400">
        La variable de entorno solo puede forzar el kill. Para revivir un área forzada por env hay
        que sacar <code>FEATURE_KILL_*</code> o <code>MAINTENANCE_MODE</code> del deploy.
      </p>
    </div>
  );
}
