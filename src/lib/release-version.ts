import { createHash } from 'node:crypto';

/**
 * Identificador del deploy para clientes y monitores.
 *
 * Antes `/api/version` y `/api/health` devolvían el commit SHA crudo de Vercel.
 * Es información útil para un atacante (saber exactamente qué build corre,
 * buscar el CVE o el diff correspondiente) y no hace falta para nada público:
 * el auto-reload solo necesita comparar si el valor cambió.
 *
 * Se devuelve un hash truncado del SHA. Sigue siendo estable entre requests del
 * mismo deploy y distinto entre deploys, pero no revela el commit.
 */
export function getReleaseVersion(): string {
  return (
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.SOURCE_VERSION ||
    'dev'
  );
}

export function getReleaseToken(version = getReleaseVersion()): string {
  if (version === 'dev') return 'dev';
  return createHash('sha256').update(version).digest('hex').slice(0, 16);
}
