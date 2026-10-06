# Secretos — inventario y checklist de rotación

Auditoría Fase 4.3. Estado al cierre de la auditoría: **no hay secretos
commiteados**. El único `.env*` versionado es `.env.example` (raíz) y
`scripts/.env.db.example` (template del sync/backup); `.env`, `.env*.local`,
`.env*.development`, `.env*.production` y `.env.db` están en `.gitignore`, y
los dumps del backup caen en `scripts/dumps/`, también ignorado. ggshield
(`GitGuardian/ggshield-action@v1`) corre en CI sobre el historial completo
(`fetch-depth: 0`).

## Inventario

| Secreto | Variable | Dónde vive | Quién lo consume | Quién lo rota |
|---|---|---|---|---|
| Service role de Supabase | `SUPABASE_SERVICE_ROLE_KEY` | Vercel env + `.env.local` local | `src/lib/supabaseAdmin.ts`, `src/proxy.ts`, scripts (backup/load-test/verify-rls) | Supabase Dashboard → Project → API keys |
| Anon key de Supabase | `SUPABASE_ANON_KEY` | Vercel env + `.env.local` | cliente SSR (auth), scripts | Supabase Dashboard |
| URL de Supabase | `NEXT_PUBLIC_SUPABASE_URL` | Vercel env | toda la app | n/a (no es secreta, pero no debe apuntar a un proyecto viejo) |
| Access Token de Mercado Pago | `MERCADOPAGO_ACCESS_TOKEN` | Vercel env + `.env.local` | `mercadopago-*.ts` (cobros, refunds) | https://www.mercadopago.com.ar/developers → Credenciales |
| Clave pública de Mercado Pago | `NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY` | Vercel env | charge-button en el browser | Mercado Pago (no sensible, pero rotarla junto con las credenciales) |
| Webhook secret de Mercado Pago | `MERCADOPAGO_WEBHOOK_SECRET` | Vercel env + `.env.local` | `mercadopago-webhook-service.ts` | Mercado Pago → Webhooks |
| API key de Google AI | `GOOGLE_AI_API_KEY` | Vercel env + `.env.local` | `src/lib/ai-service.ts` | https://aistudio.google.com/apikey |
| DSN de Sentry | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Vercel env | `instrumentation.ts`, `sentry.client.ts` | Sentry → Project → Client Keys |
| Credenciales E2E | `E2E_USER_EMAIL`, `E2E_USER_PASSWORD`, `E2E_NEW_USER_*`, `E2E_MEMBER_USER_*` | `.env.local`, secreto de CI | Playwright, load test | cuenta Supabase dedicada |
| Guard de secrets en CI | `GITGUARDIAN_API_KEY` | Secreto de GitHub Actions | ggshield-action | GitGuardian Dashboard |
| URL de la DB (session pooler) | `PROD_DB_URL`, `DEV_DB_URL` en `scripts/.env.db` | fuera del repo (`.env.db` ignorado); nunca en Vercel | `sync-prod-to-dev.ps1`, `backup-db.ps1` | Supabase → Project Settings → Connect (regenera la password del pooler) |

## Reglas

1. Las claves con prefijo `NEXT_PUBLIC_` NO son secretas (llegan al bundle del
   browser): que no sea necesario cambiarlas no las vuelve "públicas con
   protección". Service role, access token, webhook secret y Google AI **nunca**
   pueden usar el prefijo.
2. `src/test/security-service-role-boundary.test.ts` falla si el service role
   aparece fuera de `supabaseAdmin.ts`, `proxy.ts` y los tests: si una rotación
   o un refactor lo hacen aparecer en el bundle del cliente, el pipeline lo
   marca.
3. gitleaks guard local (si se instala) y ggshield en CI aplican sobre el
   historial: un secreto ya commiteado se considera filtrado y se rota, no se
   "borra con un nuevo commit" (sigue en el historial de git).

## Checklist de rotación (para cualquier secreto del inventario)

1. **Crear** la nueva credencial en el proveedor (no reusar la marca webhook /
   subcuenta de otra app).
2. **Aplicar** en todos los consumidores:
   - Vercel → Project → Settings → Environment Variables (re-autenticar
     deployment o redeploy con `--env` para que tome el valor);
   - `.env.local` de cada desarrollador (pull del .env de Vercel o edición a
     mano);
   - secreto de CI si aplica (GitHub → Settings → Secrets).
3. **Verificar** antes de revocar el valor viejo:
   - `GET /api/health` con `?check=db` → 200 (valida supabase service role);
   - cobro real de prueba (o endpoint de refund) contra producción puntual;
   - webhook: re-enviar un evento de prueba desde el panel de MP;
   - `GOOGLE_AI_API_KEY`: `POST /api/ai/suggest` manual o test spot;
   - run corto de `node scripts/load-test-sales.mjs` con `DURATION=10`.
4. **Rotar la sign-session en Supabase** cuando se rote service role/anon:
   el viejo sigue válido si el proyecto lo permite en modo simultáneo; revocar
   con la confirmación del dashboard una vez que producción firmó OK.
5. **Revocar** la credencial vieja en el proveedor (deja de aceptar requests).
6. **Registrar** la rotación (fecha, qué se rotó, DSN/ref del reemplazo) en el
   changelog de la PR. Si la rotación es por sospecha de filtrado, abrir una
   instant review en GitGuardian del rango de commits previo.