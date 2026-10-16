export type CountryCode =
  | 'AR'
  | 'BO'
  | 'BR'
  | 'CL'
  | 'CO'
  | 'CR'
  | 'CU'
  | 'DO'
  | 'EC'
  | 'GT'
  | 'HN'
  | 'MX'
  | 'NI'
  | 'PA'
  | 'PE'
  | 'PY'
  | 'SV'
  | 'UY'
  | 'VE'
  | 'DEFAULT'

/**
 * Lee una cookie del header `Cookie` sin depender del parseo de Next.
 *
 * `getCountryFromHeaders` corre tanto en Server Components (donde `headers()`
 * trae las cookies) como en route handlers de `/api`. El proxy excluye `/api`
 * de su matcher, así que en esas rutas NO existe `x-vynko-country`; la cookie
 * `vynko_country` (que el proxy escribe en cada request de página) queda como
 * único rastro del país resuelto por el proxy. Se usa solo como fallback
 * DESPUÉS de los headers de IP, para no habilitar la manipulación de la
 * cookie en producción (Vercel siempre manda `x-vercel-ip-country`). Sin este
 * fallback, en local el checkout caía siempre a AR y Paddle no se podía probar.
 */
function getCookieValue(headers: Headers, name: string): string | null {
  const raw = headers.get('cookie')
  if (!raw) return null
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    if (part.slice(0, idx).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(idx + 1).trim())
    } catch {
      return part.slice(idx + 1).trim()
    }
  }
  return null
}

export function getCountryFromHeaders(headers: Headers): CountryCode {
  const c =
    headers.get('x-vynko-country') ||
    headers.get('x-vercel-ip-country') ||
    headers.get('cf-ipcountry') ||
    headers.get('x-country') ||
    getCookieValue(headers, 'vynko_country') ||
    'AR'

  const code = c.toUpperCase().slice(0, 2)
  const allowed: CountryCode[] = [
    'AR',
    'BO',
    'BR',
    'CL',
    'CO',
    'CR',
    'CU',
    'DO',
    'EC',
    'GT',
    'HN',
    'MX',
    'NI',
    'PA',
    'PE',
    'PY',
    'SV',
    'UY',
    'VE',
  ]
  if (allowed.includes(code as CountryCode)) return code as CountryCode
  return 'DEFAULT'
}
