import { logger } from '@/lib/logger';

/**
 * Allowlist de IPs de origen para los webhooks de Paddle.
 *
 * Paddle publica sus rangos en https://api.paddle.com/ips (`data.ipv4_cidrs`,
 * en formato /32 para IPv4). Ese endpoint es la ÚNICA fuente de verdad: la
 * lista cambia sin aviso, así que NUNCA se hardcodea — se baja, se cachea un
 * rato y se refresca.
 *
 * Fail-closed: si no se puede obtener la lista (endpoint caído, respuesta
 * inválida) se reporta "indisponible" y el caller rechaza la entrega. Paddle
 * reintenta las notificaciones, así que un corte momentáneo no pierde eventos.
 */

const IPS_ENDPOINT = 'https://api.paddle.com/ips';
// 1h: suficiente para no martillar el endpoint en cada delivery y corto como
// para que un cambio de rangos se refleje rápido.
const CACHE_TTL_MS = 60 * 60 * 1000;

let cached: { cidrs: string[]; fetchedAt: number } | null = null;
// Dedupe de requests concurrentes: una sola ida al endpoint por ventana.
let inflight: Promise<string[] | null> | null = null;

async function fetchPaddleCidrs(): Promise<string[] | null> {
  try {
    const res = await fetch(IPS_ENDPOINT, {
      headers: { Accept: 'application/json' },
      // Next.js: sin caché del runtime, la nuestra es explícita.
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { data?: { ipv4_cidrs?: unknown } };
    const cidrs = body.data?.ipv4_cidrs;
    if (!Array.isArray(cidrs) || cidrs.length === 0) return null;
    return cidrs.filter((c): c is string => typeof c === 'string' && c.length > 0);
  } catch (err) {
    logger.warn('No se pudo obtener la lista de IPs de Paddle', { error: err });
    return null;
  }
}

/**
 * Lista actual de CIDRs de Paddle (o `null` si no está disponible). Usa cache
 * con TTL; si el refresh falla se sirve la última lista buena mientras siga
 * dentro de TTL (y solo en ese caso: sin cache válido → `null`, fail-closed).
 */
export async function getPaddleCidrs(): Promise<string[] | null> {
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached.cidrs;

  if (!inflight) {
    inflight = fetchPaddleCidrs().then((cidrs) => {
      inflight = null;
      if (cidrs) cached = { cidrs, fetchedAt: Date.now() };
      return cidrs;
    });
  }

  const fresh = await inflight;
  if (fresh) return fresh;
  // Refresh falló: cache vencido ya no se sirve.
  return null;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** ¿`ip` cae dentro del CIDR `cidr`? Soporta `a.b.c.d` (= /32) y `a.b.c.d/n`. */
function ipInCidr(ip: string, cidr: string): boolean {
  const [base, prefixRaw] = cidr.split('/');
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === null || baseInt === null) return false;
  const prefix = prefixRaw === undefined ? 32 : Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  if (prefix === 0) return true;
  const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
  return ((ipInt & mask) >>> 0) === ((baseInt & mask) >>> 0);
}

/**
 * ¿La IP de origen es una de Paddle?
 *
 * - `ok`: está en la lista (o la lista se actualizó bien y coincide).
 * - `blocked`: la lista está disponible y la IP NO es de Paddle.
 * - `list-unavailable`: no se pudo obtener la lista → el caller debe
 *   responder 503 para que Paddle reintente (fail-closed, nunca "ok" a ciegas).
 */
export type PaddleIpCheck = 'ok' | 'blocked' | 'list-unavailable';

export async function checkPaddleSourceIp(ip: string): Promise<PaddleIpCheck> {
  const cidrs = await getPaddleCidrs();
  if (!cidrs) return 'list-unavailable';
  if (!ip) return 'blocked';
  // Normaliza IPv4-mapped IPv6 (::ffff:1.2.3.4) a IPv4 plano.
  const normalized = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  return cidrs.some((cidr) => ipInCidr(normalized, cidr)) ? 'ok' : 'blocked';
}
