import { supabaseAdmin } from '@/lib/supabaseAdmin';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export interface RateLimitResult {
  ok: boolean;
  retryAfterSeconds: number;
}

let warnedAboutE2eBypass = false;
let callsSinceCleanup = 0;

/**
 * Cada cuanto se purgan las claves vencidas, en llamadas.
 *
 * Las claves que dejan de usarse quedan en la tabla para siempre si nadie las
 * borra. No hay cron en el proyecto, asi que la purga se engancha al trafico: se
 * dispara de forma esporadica desde aca en vez de en cada request, porque pagarla
 * siempre seria un DELETE constante para Mostly claves activas.
 */
const CLEANUP_EVERY_N_CALLS = 50;

/**
 * Bypass exclusivo para la suite E2E.
 *
 * El suite corre siempre desde la misma IP y hace varios logins por corrida,
 * asi que agota rapidamente el limite por IP y empieza a recibir 429. Eso no es
 * un bug del rate limiter (funciona) sino del test: los tests fallaban de
 * forma intermitente por un control de seguridad que hacia bien su trabajo.
 *
 * Exigir las dos condiciones evita el error tipico de un flag que se filtra a
 * produccion: aunque alguien definiera E2E=1 en el server real, NODE_ENV
 * seria 'production' y el bypass no se activaria.
 */
function isE2eBypassEnabled(): boolean {
  return process.env.E2E === '1' && process.env.NODE_ENV !== 'production';
}

/**
 * Almacenes posibles.
 *
 * El default depende del entorno y no es arbitrario:
 *
 * - En desarrollo el store es `memory`. Es un proceso unico, asi que el `Map` no
 *   tiene el problema que motivationa el store compartido, y ademas permite
 *   trabajar sin tener la migracion aplicada. Importante: eso NO se traslada a
 *   produccion nunca, porque ahi el limite tiene que ser el mismo para todas las
 *   instancias.
 * - En produccion el store es `postgres` siempre, sin excepcion. Si la funcion no
 *   esta, se avisa por log y se deja pasar: un `memory` silencioso seria un
 *   limitador por proceso, o sea `limite x instancias`, que es exactamente el
 *   bug que esta migracion viene a arreglar.
 *
 * Los deploys de preview de Vercel tambien cuentan como produccion (allí
 * NODE_ENV=production), que es lo correcto: un preview corre en mas de una
 * instancia igual que produccion.
 *
 * `RATE_LIMIT_STORE` fuerza uno u otro, para tests o para depurar.
 */
type Store = 'postgres' | 'memory';

function resolveStore(): Store {
  const configured = (process.env.RATE_LIMIT_STORE ?? '').trim().toLowerCase();
  if (configured === 'memory') return 'memory';
  if (configured === 'postgres') return 'postgres';
  return process.env.NODE_ENV === 'production' ? 'postgres' : 'memory';
}

function rateLimitInMemory(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) {
      for (const [k, v] of buckets) {
        if (v.resetAt <= now) buckets.delete(k);
      }
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSeconds: 0 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  return { ok: true, retryAfterSeconds: 0 };
}

interface RateLimitRow {
  ok: boolean;
  retry_after_seconds: number;
}

async function rateLimitInPostgres(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  callsSinceCleanup += 1;
  const shouldCleanup = callsSinceCleanup >= CLEANUP_EVERY_N_CALLS;
  if (shouldCleanup) callsSinceCleanup = 0;

  const { data, error } = await supabaseAdmin.rpc('rate_limit_hit', {
    p_key: key,
    p_limit: limit,
    p_window_ms: windowMs,
    p_probabilistic_cleanup: shouldCleanup,
  });

  if (error) {
    throw new Error(`rate_limit_hit fallo: ${error.message}`);
  }

  const row = (Array.isArray(data) ? data[0] : data) as RateLimitRow | null;
  if (!row || typeof row.ok !== 'boolean') {
    throw new Error('rate_limit_hit devolvio una forma inesperada');
  }
  return { ok: row.ok, retryAfterSeconds: Number(row.retry_after_seconds) || 0 };
}

let postgresUnavailableLogged = false;

/**
 * Registra un intento contra `key` y decide si pasa.
 *
 * Es async porque el contador tiene que vivir fuera del proceso para que el
 * limite sea el mismo en todas las instancias. Con un `Map` en memoria cada
 * instancia cuenta por separado y el limite efectivo es `limite x instancias`.
 *
 * Que falle el store no significa bloquear el request. Si Postgres no responde,
 * la app entera no funciona: el login, el alta de empresa y las consultas de
 * datos pasan por el mismo Supabase. Un fail-closed converts eso en un corte
 * total de servicio por un problema que igual afecta a todo, asi que se prefiere
 * un fail-open con log una sola vez, que deja el incidente visible sin amplificar el
 * impacto. El trade-off es que durante el incidente el limite no protege: es una
 * capa de defensa en profundidad, no la unica.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  if (isE2eBypassEnabled()) {
    if (!warnedAboutE2eBypass) {
      warnedAboutE2eBypass = true;
      console.warn('[rate-limit] E2E=1 con NODE_ENV != production: rate limiting desactivado');
    }
    return { ok: true, retryAfterSeconds: 0 };
  }

  if (resolveStore() === 'memory') {
    return rateLimitInMemory(key, limit, windowMs);
  }

  try {
    return await rateLimitInPostgres(key, limit, windowMs);
  } catch (error) {
    if (!postgresUnavailableLogged) {
      postgresUnavailableLogged = true;
      console.error(
        '[rate-limit] El store distribuido no respondio; se permite el request sin limite.',
        'Sintoma tipico: falta aplicar migrations/036_rate_limit_buckets.sql.',
        error
      );
    }
    return { ok: true, retryAfterSeconds: 0 };
  }
}

/** Solo para tests: limpia el estado entre casos. */
export function __resetRateLimitStateForTests(): void {
  buckets.clear();
  callsSinceCleanup = 0;
  postgresUnavailableLogged = false;
}

/** Headers que el edge de la plataforma sobrescribe, y que el cliente no puede forjar. */
const EDGE_IP_HEADERS = ['x-vercel-forwarded-for', 'cf-connecting-ip', 'true-client-ip'];

/**
 * IP real del cliente, para usarla como clave de limite.
 *
 * Antes tomaba el PRIMER valor de `x-forwarded-for`, que es exactamente el que
 * elige el cliente: mandar `X-Forwarded-For: 1.1.1.1` en cada request daba un
 * bucket distinto y hacia evadir todos los limites por IP (login, signup, oauth,
 * recuperacion). Ese header no se puede usar tal cual porque es una cadena que
 * arma cada salto de la red.
 *
 * El orden es de mas confiable a menos confiable:
 *  1. Headers que escribe el edge (Vercel, Cloudflare) y que el cliente no puede
 *     reemplazar, porque el edge los pisa.
 *  2. El ULTIMO valor de `x-forwarded-for`, que es el que agrego el proxy mas
 *     cercano al servidor. Los valores previos son aportados por cualquiera.
 *  3. `x-real-ip`, que algunos proxies escriben ademas, tambien falsificable.
 *
 * Supuesto del punto 2: hay exactamente un proxy de confianza delante. Con varios
 * saltos, el ultimo puede ser un proxy y no el cliente, y habria que contar los
 * saltos de confianza. Si el despliegue no esta detrás de Vercel ni Cloudflare, lo
 * correcto es configurar `RATE_LIMIT_TRUSTED_HOPS` con cuantos proxies hay.
 */
export function getClientIp(request: Request): string {
  for (const header of EDGE_IP_HEADERS) {
    const value = request.headers.get(header);
    const single = value?.split(',')[0]?.trim();
    if (single) return normalizeIp(single);
  }

  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded.split(',').map((h) => h.trim()).filter(Boolean);
    if (hops.length > 0) {
      const trustedHops = parseTrustedHops();
      // Con N proxies de confianza, el cliente es el valor que esta N posiciones
      // antes del final. Si hay menos saltos que proxies, se toma el primero.
      const index = Math.max(0, hops.length - 1 - trustedHops);
      return normalizeIp(hops[index]);
    }
  }

  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return normalizeIp(realIp);

  return 'unknown';
}

function parseTrustedHops(): number {
  const raw = Number.parseInt((process.env.RATE_LIMIT_TRUSTED_HOPS ?? '').trim(), 10);
  // 0 = el ultimo salto es el cliente, que es el caso comun con un solo proxy.
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

/**
 * Normaliza la IP para que la misma persona no genere claves distintas.
 *
 * Un IPv4 mapeado en IPv6 (`::ffff:1.2.3.4`) y su forma IPv4 son el mismo
 * cliente, pero como cadenas distintas seriam dos buckets, y con eso el limite
 * por IP se divide por dos sin que nadie lo note.
 */
function normalizeIp(value: string): string {
  const trimmed = value.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  if (mapped) return mapped[1];
  return trimmed;
}
