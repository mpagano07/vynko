import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { logger } from '@/lib/logger';

/**
 * Feature flags de RELEASE (tabla `feature_flags`, migracion 055).
 *
 * Encender/apagar una funcionalidad sin deploy y con rollout por porcentaje.
 * No reemplaza a los flags por tenant (`tenants.settings`, ver
 * `src/lib/tenant-config.ts`): esos son de la EMPRESA, estos son del
 * DESPLIEGUE.
 *
 * Precedencia, de mas a menos:
 *   1. Variable de entorno `FEATURE_<CLAVE>` (`on`/`off`/0..100) — para cortar
 *      o forzar algo desde Vercel sin tocar la base.
 *   2. Fila en `feature_flags` (kill switch `enabled` + `rollout_percent`).
 *   3. Default: APAGADO. Un flag desconocido no enciende nada.
 *
 * El rollout es deterministico por sujeto: el mismo usuario siempre cae en el
 * mismo bucket, asi nadie ve la funcion "y despues desaparece".
 */

export interface FeatureFlagRow {
  flag_key: string;
  enabled: boolean;
  rollout_percent: number;
  description?: string | null;
  updated_by?: string | null;
  updated_at?: string;
}

export interface FlagSubject {
  userId?: string | null;
  tenantId?: string | null;
}

const CACHE_TTL_MS = 60_000;
let cache: { at: number; flags: Map<string, FeatureFlagRow> } | null = null;
// Lectura en vuelo: sin esto, N requests que llegan con el cache frio hacen N
// selects y el ultimo en resolver pisa el cache con su propio resultado.
let inflight: Promise<Map<string, FeatureFlagRow>> | null = null;

function envNameFor(flagKey: string): string {
  return 'FEATURE_' + flagKey.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

/** `on`/`off` = siempre; un numero 0..100 = rollout forzado. */
function readEnvOverride(flagKey: string): boolean | number | null {
  if (typeof process === 'undefined' || !process.env) return null;
  const name = envNameFor(flagKey);
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return null;

  const value = raw.trim().toLowerCase();
  if (['1', 'true', 'on', 'yes'].includes(value)) return true;
  if (['0', 'false', 'off', 'no'].includes(value)) return false;

  const percent = Number(value);
  if (Number.isFinite(percent) && percent >= 0 && percent <= 100) return percent;

  logger.warn('feature flag: valor de env invalido, se ignora', { flag: flagKey, env: name, value });
  return null;
}

async function loadFlags(): Promise<Map<string, FeatureFlagRow>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.flags;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const { data, error } = await supabaseAdmin.from('feature_flags').select('*');
      if (error) throw error;

      const flags = new Map<string, FeatureFlagRow>();
      for (const row of (data ?? []) as FeatureFlagRow[]) flags.set(row.flag_key, row);

      cache = { at: Date.now(), flags };
      return flags;
    } catch (error) {
      // Falla de lectura: se usa el ultimo snapshot conocido. Caer a "todo
      // apagado" romperia una funcionalidad ya encendida por un incidente de
      // la base; caer a "todo encendido" expondria algo no probado.
      logger.error('feature_flags: no se pudieron leer, se usa el cache', { error });
      return cache?.flags ?? new Map();
    }
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/**
 * Bucket estable 0..99 por sujeto (FNV-1a).
 *
 * No es criptografico: solo hace falta que sea estable y uniforme, para que
 * el 10% de rollout sea el mismo 10% de usuarios mañana.
 */
function bucket(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

function resolve(
  flagKey: string,
  subject: FlagSubject,
  flags: Map<string, FeatureFlagRow>,
  override: boolean | number | null
): boolean {
  // `FEATURE_X=off` corta el flag por completo; `FEATURE_X=25` es rollout.
  if (typeof override === 'boolean') return override;

  let enabled: boolean;
  let rollout: number;

  if (override !== null) {
    enabled = true;
    rollout = override;
  } else {
    const row = flags.get(flagKey);
    if (!row) return false;
    enabled = row.enabled;
    rollout = row.rollout_percent;
  }

  if (!enabled) return false;
  if (rollout >= 100) return true;
  if (rollout <= 0) return false;

  const subjectKey = subject.userId ?? subject.tenantId ?? 'anonymous';
  return bucket(`${flagKey}|${subjectKey}`) < rollout;
}

export async function isFeatureEnabled(flagKey: string, subject: FlagSubject = {}): Promise<boolean> {
  const override = readEnvOverride(flagKey);
  const flags = override !== null ? new Map() : await loadFlags();
  return resolve(flagKey, subject, flags, override);
}

/** Evalua varios flags con UNA sola lectura de la base. */
export async function getFeatureFlags(
  flagKeys: string[],
  subject: FlagSubject = {}
): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  if (flagKeys.length === 0) return out;

  const overrides = new Map<string, boolean | number | null>();
  const needsDb: string[] = [];
  for (const key of flagKeys) {
    const override = readEnvOverride(key);
    overrides.set(key, override);
    if (override === null) needsDb.push(key);
  }

  const flags = needsDb.length > 0 ? await loadFlags() : new Map<string, FeatureFlagRow>();
  for (const key of flagKeys) out[key] = resolve(key, subject, flags, overrides.get(key) ?? null);
  return out;
}

export async function listFeatureFlags(): Promise<FeatureFlagRow[]> {
  const flags = await loadFlags();
  return [...flags.values()].sort((a, b) => a.flag_key.localeCompare(b.flag_key));
}

/**
 * Alta o cambio de un flag. Devuelve la fila resultante.
 *
 * Se hace upsert y no update: el flujo normal es crear el flag apagado en la
 * migracion/desarrollo y encenderlo despues desde el panel o esta API.
 */
export async function setFeatureFlag(
  input: Pick<FeatureFlagRow, 'flag_key' | 'enabled' | 'rollout_percent'> &
    Partial<Pick<FeatureFlagRow, 'description' | 'updated_by'>>
): Promise<{ ok: true; flag: FeatureFlagRow } | { ok: false; error: string }> {
  const row = {
    flag_key: input.flag_key,
    enabled: input.enabled,
    rollout_percent: input.rollout_percent,
    description: input.description ?? null,
    updated_by: input.updated_by ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from('feature_flags')
    .upsert(row)
    .select()
    .single();

  if (error) {
    logger.error('feature_flags: no se pudo guardar', { flag: input.flag_key, error });
    return { ok: false, error: 'No se pudo guardar el flag.' };
  }

  // El cache es por proceso: invalidarlo aca hace que el proximo evaluate vea
  // el cambio (en Vercel cada instancia lo hace en su propio cache).
  cache = null;
  return { ok: true, flag: data as FeatureFlagRow };
}

export function __resetFeatureFlagCacheForTests(): void {
  cache = null;
}
