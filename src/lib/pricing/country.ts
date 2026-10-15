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

export function getCountryFromHeaders(headers: Headers): CountryCode {
  const c =
    headers.get('x-vynko-country') ||
    headers.get('x-vercel-ip-country') ||
    headers.get('cf-ipcountry') ||
    headers.get('x-country') ||
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
