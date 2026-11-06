import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { logger } from '@/lib/logger';
import {
  KILL_AREAS,
  KILL_SWITCH_ENV_NAMES,
  KILL_SWITCH_FLAG_KEYS,
  type KillArea,
  type KillSwitchEnvOverrides,
  type KillSwitchState,
} from './kill-switch-config';

export { KILL_AREAS, KILL_SWITCH_ENV_NAMES, KILL_SWITCH_FLAG_KEYS };
export type { KillArea, KillSwitchEnvOverrides, KillSwitchState };

/**
 * Kill switch de areas criticas.
 *
 * Reusa la tabla `feature_flags` (migracion 055, filas semilla en 068) pero con
 * semantica INVERTIDA respecto de los flags de release:
 *
 *   * fila ausente o `enabled = false` -> la funcionalidad esta VIVA.
 *   * `enabled = true`                  -> la funcionalidad esta MATADA.
 *
 * Por eso no usa `isFeatureEnabled()`: esa funcion devuelve `false` cuando no
 * hay fila (default apagado) y ademas aplica `rollout_percent`. Un kill switch
 * no puede depender de un porcentaje ni de que la fila exista: si algo falla,
 * se sigue operando. Para matar con la base caida estan las variables de
 * entorno, que tienen prioridad y no necesitan DB.
 *
 * Cache corto (10 s) y separado del cache de 60 s de los flags de release: un
 * incidente no puede esperar un minuto, pero tampoco queremos una query por
 * request. `invalidateKillSwitchCache()` lo limpia desde la API admin para que
 * el cambio se vea casi al instante en la instancia que recibio el PUT.
 */

export const KILL_SWITCH_CACHE_TTL_MS = 10_000;

// Alias cortos de la config compartida. Se usan en casi todas las funciones de
// abajo y repetir `KILL_SWITCH_FLAG_KEYS[key]` en cada mapa solo agrega ruido.
const FLAG_KEY = KILL_SWITCH_FLAG_KEYS;
const ENV_NAME = KILL_SWITCH_ENV_NAMES;
const MAINTENANCE_FLAG = KILL_SWITCH_FLAG_KEYS.maintenance;

const AREA_MESSAGE: Record<KillArea, string> = {
  sales: 'Las ventas están deshabilitadas temporalmente.',
  payments: 'Los cobros están deshabilitados temporalmente.',
  forecast: 'El pronóstico está deshabilitado temporalmente.',
  imports: 'La importación de productos está deshabilitada temporalmente.',
};

const ALL_FLAG_KEYS = [...KILL_AREAS.map((area) => FLAG_KEY[area]), MAINTENANCE_FLAG];

const EMPTY_STATE: KillSwitchState = Object.freeze({
  sales: false,
  payments: false,
  forecast: false,
  imports: false,
  maintenance: false,
});

let cache: { at: number; state: KillSwitchState } | null = null;
let inflight: Promise<KillSwitchState> | null = null;

// Un env mal escrito se avisa UNA vez por proceso: repetir el warn en cada
// request convertiria un error de configuracion en ruido de logs.
const warnedInvalidEnv = new Set<string>();

/** `on`/`off` (y sus alias). Un numero no tiene sentido para un kill switch. */
function readBooleanEnv(name: string): boolean | null {
  if (typeof process === 'undefined' || !process.env) return null;
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return null;

  const value = raw.trim().toLowerCase();
  if (['1', 'true', 'on', 'yes'].includes(value)) return true;
  if (['0', 'false', 'off', 'no'].includes(value)) return false;

  if (!warnedInvalidEnv.has(name)) {
    warnedInvalidEnv.add(name);
    logger.warn('kill_switch: valor de env invalido, se ignora', { env: name, value });
  }
  return null;
}

function stateFromRows(rows: Map<string, boolean>): KillSwitchState {
  return {
    sales: rows.get(FLAG_KEY.sales) === true,
    payments: rows.get(FLAG_KEY.payments) === true,
    forecast: rows.get(FLAG_KEY.forecast) === true,
    imports: rows.get(FLAG_KEY.imports) === true,
    maintenance: rows.get(MAINTENANCE_FLAG) === true,
  };
}

/**
 * Estado tal como esta en la base (sin env). Ante error de lectura conserva el
 * ultimo snapshot conocido y, si no hay ninguno, deja todo vivo.
 */
async function loadBaseState(): Promise<KillSwitchState> {
  if (cache && Date.now() - cache.at < KILL_SWITCH_CACHE_TTL_MS) return cache.state;
  if (inflight) return inflight;

  inflight = (async () => {
    let state: KillSwitchState;
    try {
      const { data, error } = await supabaseAdmin
        .from('feature_flags')
        .select('flag_key, enabled')
        .in('flag_key', ALL_FLAG_KEYS);
      if (error) throw error;

      const rows = new Map<string, boolean>();
      for (const row of (data ?? []) as Array<{ flag_key: string; enabled: boolean }>) {
        rows.set(row.flag_key, row.enabled);
      }
      state = stateFromRows(rows);
    } catch (error) {
      logger.error('kill_switch: no se pudieron leer los flags, se usa el ultimo estado conocido', {
        error,
      });
      state = cache?.state ?? EMPTY_STATE;
    }

    cache = { at: Date.now(), state };
    return state;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/**
 * La env solo puede FORZAR el kill, nunca revivirlo.
 *
 * Si `FEATURE_KILL_SALES=off` pudiera pisar la base, un `off` viejo que quedo
 * en Vercel dejaria el toggle de la base sin efecto para siempre: el incidente
 * se ve, se mata desde /admin/ops, y la app sigue vendiendo. Para revivir se
 * apaga la fila en la base o se saca la variable. Con la base caida, un
 * redeploy arranca sin cache y el default es "vivo".
 */
function applyEnv(base: KillSwitchState): KillSwitchState {
  const forcedOn = (key: keyof KillSwitchState) => readBooleanEnv(ENV_NAME[key]) === true;

  return {
    sales: forcedOn('sales') || base.sales,
    payments: forcedOn('payments') || base.payments,
    forecast: forcedOn('forecast') || base.forecast,
    imports: forcedOn('imports') || base.imports,
    maintenance: forcedOn('maintenance') || base.maintenance,
  };
}

/** Estado efectivo (env > base > vivo). */
export async function getKillSwitchState(): Promise<KillSwitchState> {
  return applyEnv(await loadBaseState());
}

/**
 * ¿Esta area esta matada? `maintenance_mode` mata todas.
 *
 * La env se resuelve ANTES de tocar la base: si alguien mato todo desde Vercel
 * porque la base esta lenta o caida, el 503 tiene que salir igual.
 */
export async function isKilled(area: KillArea): Promise<boolean> {
  if (readBooleanEnv(ENV_NAME[area]) === true) return true;
  if (readBooleanEnv(ENV_NAME.maintenance) === true) return true;

  const state = await loadBaseState();
  return state.maintenance || state[area];
}

export async function isMaintenanceMode(): Promise<boolean> {
  if (readBooleanEnv(ENV_NAME.maintenance) === true) return true;
  return (await loadBaseState()).maintenance;
}

/** Devuelve el 503 listo para responder, o `null` si el area sigue viva. */
export async function guardKill(area: KillArea): Promise<NextResponse | null> {
  let killed: boolean;
  try {
    killed = await isKilled(area);
  } catch (error) {
    // Fail open tambien aca: un bug del propio guard no puede tumbar la venta.
    logger.error('kill_switch: fallo al evaluar el flag, se deja pasar', { area, error });
    return null;
  }

  if (!killed) return null;

  logger.warn('kill_switch activo', { area });
  return NextResponse.json(
    { error: AREA_MESSAGE[area], code: `KILL_SWITCH_${area.toUpperCase()}` },
    { status: 503, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } }
  );
}

/** Que claves estan forzadas a ON por env (para avisar en /admin/ops). */
export function getKillSwitchEnvOverrides(): KillSwitchEnvOverrides {
  const overrides: KillSwitchEnvOverrides = {};
  for (const key of Object.keys(ENV_NAME) as Array<keyof KillSwitchState>) {
    if (readBooleanEnv(ENV_NAME[key]) === true) overrides[key] = true;
  }
  return overrides;
}

/** Se llama despues de un PUT admin para no esperar el TTL. */
export function invalidateKillSwitchCache(): void {
  cache = null;
}

export function __resetKillSwitchCacheForTests(): void {
  cache = null;
  inflight = null;
  warnedInvalidEnv.clear();
}
