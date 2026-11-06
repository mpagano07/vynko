# Checklist de arreglo de seguridad — Vynko

**Revisión de:** `SECURITY_FIX_PLAN.md`
**Fecha:** 2026-11-06
**Base revisada:** commit `8e2f6e1` + árbol de trabajo sin cambios
**Método:** cada ítem del plan se contrastó contra migraciones y código reales, no contra el propio plan.

---

## Veredicto

El plan sirve como inventario, pero **está desactualizado**: de sus 16 ítems, **7 ya están resueltos**, **1 no aplica** (HIGH-01), **1 solo importa en self-hosted** (MED-02) y casi todas las rutas de archivo están mal (`lib/...` → `src/lib/...`, `src/app/api/...`).

Quedan **4 arreglos reales** (1 de exposición de datos, 1 de PII, 2 de endurecimiento) y **3 pendientes menores**. La "Semana 1" del plan (CRIT-01/02/03) ya está hecha; no hay que volver a hacerla, solo verificar que las migraciones estén aplicadas en cada entorno.

### Estado verificado por ítem

| ID | Estado real | Evidencia |
|---|---|---|
| CRIT-01 | ✅ **Hecho** | 016 quita `tenant_id`/stock de `products`; 032 restringe SELECT vía `product_stock` y elimina DML; 034 revoca DML; test `tenant-isolation.products.test.ts` |
| CRIT-02 | ✅ **Hecho** | Login: límite por cuenta + por IP (`login/route.ts:8-15`); signup: por email + IP (`signup/route.ts:12-13`); forgot-password: por email + IP (`auth-service.ts:41,49`) |
| CRIT-03 | ✅ **Hecho** | 020 elimina la policy INSERT de `tenant_users`; 034 revoca INSERT/UPDATE/DELETE; la aceptación corre server-side con `supabaseAdmin` (`accept-invitations.ts`) |
| HIGH-01 | ⚪ **No aplica** | `'unsafe-eval'` está solo en dev (`csp.ts:52`, `isDev ? ...`). No existe en producción. Next dev/HMR lo necesita. No tocar |
| HIGH-02 | ✅ **Resuelto en rama** | `csp.ts` usa el host exacto del DSN (`getSentryDsn` + `new URL(dsn).host`); sin DSN no agrega ningún host. Test en `src/lib/security/csp.test.ts` |
| HIGH-03 | ✅ **Resuelto en rama** | `migrations/070_lock_invitations_select.sql` elimina la policy SELECT y revoca `SELECT` a `anon, authenticated`. `scripts/verify-rls.mjs` verifica la invitación victima |
| HIGH-04 | ✅ **Resuelto en rama** | `upload-service.ts` lee dimensiones de PNG/JPEG/GIF/WebP y rechaza > 4096 px o > 16 MP antes de subir. Tests en `security-upload-service.test.ts` |
| MED-01 | 🟡 **Vigente, riesgo humano** | `feature_flags` mezcla flags de release y kill switches con semántica invertida (`kill-switch.ts:16-29`). `/admin/ops` solo muestra kill switches, así que el riesgo está contenido |
| MED-02 | ✅ **Resuelto en rama** | `getClientIp` avisa una sola vez en producción si no es Vercel/Cloudflare y falta `RATE_LIMIT_TRUSTED_HOPS`. No lanza error. Test en `rate-limit.test.ts` |
| MED-03 | ✅ **Hecho** | 048/049 descuentan stock con `UPDATE ... WHERE stock >= qty` dentro de la transacción (lock de fila implícito). No hace falta `FOR UPDATE` explícito |
| MED-04 | ✅ **Hecho** | 029 crea `cash_register_sessions` con `tenant_id`, RLS y policies SELECT por tenant (líneas 63-107) |
| LOW-01 | ✅ **Resuelto en rama** | CSRF, aislamiento y XFF ya estaban. Se agregaron tests de CSP/Sentry (`csp.test.ts`), inactividad (`session-policy.test.ts`) e idempotencia de ventas (`sales-service.test.ts`) |
| LOW-02 | ✅ **Hecho** | `scripts/audit-prod.mjs` + paso en `.github/workflows/tests.yml` (usa npm, no pnpm) |
| LOW-03 | ✅ **Hecho** | `ggshield` en CI + `.gitguardian.yaml` (equivalente a gitleaks) |
| LOW-04 | ✅ **Resuelto en rama** | Login/signup ya no loguean el email; `auth-service` loguea `message`/`code` en vez del objeto completo. Test de PII en `security-auth-routes.test.ts` |
| LOW-05 | ✅ **Resuelto en rama** | `AuthInfo.role` es `TenantRole \| null` y `getAuth` valida con `isTenantRole` |

**Resumen:** 7 hechos · 1 no aplica · 7 resueltos en esta rama (HIGH-02/03/04, MED-02, LOW-01/04/05) · MED-01 queda como decisión documentada. La migración `070` debe aplicarse en staging/producción al desplegar.

---

## Lista de trabajo priorizada

### Bloque 0 — Verificar entorno (antes de tocar código)

> Tener la migración en el repo no significa que esté aplicada en la base. Esto es lo único que puede convertir un ítem "hecho" en una brecha real.

- [ ] **0.1 Confirmar migraciones aplicadas** en staging y producción: `020`, `032`, `034`, `048`, `049`, `053`, `067`.
  - `supabase migration list` o Dashboard → Database → Migrations.
  - Si falta alguna, aplicarla antes de cualquier otra cosa.
- [ ] **0.2 Correr el verificador de RLS** contra **staging** (crea fixtures; no correr en prod):
  - `npm run verify:rls`
  - Debe denegar lecturas/escrituras cruzadas en `products`, `suppliers`, `customers`, `documents`, `notifications`.
- [ ] **0.3 Confirmar que `SENTRY_DSN` está configurado** en producción (si no, HIGH-02 es irrelevante y no hay observabilidad de errores).

**Criterio de salida:** las 7 migraciones figuran aplicadas y `verify:rls` pasa en staging.

---

### Bloque 1 — Arreglos reales (P1)

#### 1. HIGH-03 — Cerrar SELECT de `invitations` (exposición de emails)

**Por qué:** cualquier `member`, `cashier`, `viewer` o `stock` con la anon key + su JWT puede leer por PostgREST los emails y roles de invitaciones pendientes, incluidas futuras invitaciones de owner/manager.

**Evidencia:** `migrations/005_create_invitations.sql:24-27`; `034_security_hardening.sql` revocó INSERT/UPDATE/DELETE pero no SELECT.

**Hecho relevante:** ningún código de cliente lee `invitations` directamente. `collaborator-service.ts` y `accept-invitations.ts` usan `supabaseAdmin` (service role). `supabaseAnon` solo se usa para `signInWithOtp`, no para tablas.

**Fix recomendado (denegar todo a clientes):**
```sql
-- migrations/070_lock_invitations_select.sql
DROP POLICY IF EXISTS "Users can view invitations for their tenant" ON public.invitations;
```
No hace falta crear policy de owner/manager: la app no consulta la tabla desde el cliente, y el backend con service role sigue funcionando.

> Si en el futuro se quiere lectura desde cliente, usar:
> `USING (public.current_user_tenant_role(tenant_id) IN ('owner', 'manager'))`.

**Pasos:**
1. Crear `migrations/070_lock_invitations_select.sql`.
2. Aplicar en staging.
3. Verificar con JWT `authenticated` de un `member`: `select * from invitations` → 0 filas.
4. Verificar que invitar/listar/revocar colaboradores sigue funcionando (service role).
5. Aplicar en producción.

**Tests:** agregar a `src/test/security-role-gates.test.ts` o un SQL test: `member` no lee `invitations`; `service_role` sí.

---

#### 2. LOW-04 — Sacar PII de los logs de auth

**Evidencia:** `src/app/api/auth/login/route.ts:80` y `src/app/api/auth/signup/route.ts:92`:
```ts
logger.warn(`Login failed for ${normalizedEmail}`, ...)
logger.warn(`Signup failed for ${normalizedEmail}`, ...)
```

**Fix:**
- Quitar el email del mensaje.
- Loguear `code`/`reason` y, si hace falta correlación, `requestId` (ya lo inyecta `log-context.ts`) o un hash del email.

```ts
logger.warn('Login failed', { code: error.code ?? 'unknown' });
```
```ts
logger.warn('Signup failed', { code: error.code ?? 'unknown' });
```

**Revisar también:** `auth-service.ts:65` (`logger.error('Error sending recovery email:', { error })`). Confirmar que el objeto `error` de Supabase no incluya el email; si lo incluye, pasar solo `error.message`/`error.code`.

**Criterio:** `grep -R "@"` sobre los mensajes de log de auth no devuelve emails.

---

#### 3. HIGH-04 — Validar dimensiones de imagen

**Evidencia:** `src/lib/upload-service.ts:126-138` valida MIME declarado, magic bytes y que coincidan; no mira dimensiones.

**Contexto que corrige el plan:**
- `sharp` **no es dependencia declarada** (`package.json`); la copia en `node_modules` es interna de Next y no se debe importar.
- Las imágenes van a `product-images` (privado) y se sirven por signed URL, sin `next/image` para productos. El server no las descomprime: el riesgo es del navegador del usuario, no del servidor. Sigue siendo buena práctica rechazar bombas de descompresión.

**Fix recomendado (sin dependencias nuevas):**
1. Agregar un parser de cabeceras para PNG (`IHDR`), JPEG (`SOFn`), GIF (`Logical Screen Descriptor`) y WebP (`VP8/VP8L/VP8X`), o sumar `image-size` como dependencia explícita.
2. Rechazar si `width > 4096 || height > 4096` o `width * height > 16_000_000`.
3. Devolver 400 con mensaje claro antes de subir a Storage.

**Tests:** en `src/test/security-upload-service.test.ts`:
- PNG 5000×5000 → 400.
- PNG/JPEG/WebP válidos → 200.
- Cabecera corrupta → 400.

**Nota:** el "malware scan" del plan queda fuera de alcance: bucket privado + magic bytes verificados. Si se quiere, es un ítem aparte.

---

#### 4. HIGH-02 — Restringir `connect-src` de Sentry al host del DSN

**Evidencia:** `src/lib/security/csp.ts:60` incluye `https://*.ingest.sentry.io`, `*.ingest.us...`, `*.ingest.de...`.

**Fix:**
1. Reusar `getSentryDsn()` de `src/lib/sentry/scrub.ts`.
2. Extraer el host: `new URL(dsn).host` (el DSN tiene forma `https://<key>@<host>/<project>`).
3. Agregar solo `https://${host}` a `connect-src`.
4. Si no hay DSN, no agregar ningún host de Sentry (fail closed).

**Criterio:** test unitario de `buildCsp` con DSN y sin DSN; el header no contiene `*.ingest.sentry.io`.

---

### Bloque 2 — Tests y tipos (P2)

#### 5. LOW-01 — Completar los 3 tests que faltan

Ya cubiertos: CSRF (`security-csrf.test.ts`), aislamiento por tenant (`tenant-isolation.*.test.ts`), spoofing de XFF (`rate-limit.test.ts`).

Faltan (resueltos en esta rama):

- [x] **CSP nonce:** cubierto por `src/lib/security/csp.test.ts` (host exacto del DSN, sin wildcards) además de `scripts/verify-csp.mjs`.
- [x] **Inactividad de sesión:** `isInactivityExpired` en `session-policy.ts`, usado por `proxy.ts`, con test unitario y cobertura existente en `proxy.test.ts`.
- [x] **Idempotencia de ventas:** `src/lib/sales-service.test.ts` (replay, 409 por body distinto y carrera 23505).

#### 6. LOW-05 — Tipar `role` con validación real

**Evidencia:** `api-auth.ts:31` (`role?: string | null`) y `api-auth.ts:101`.

**Fix:** no usar `as TenantRole` (el plan sugiere un cast que no valida nada). Usar el guard existente:
```ts
import { isTenantRole, type TenantRole } from '@/lib/roles';

const rawRole = (tu ?? []).find((t) => t.tenant_id === tenantId)?.role ?? null;
const role: TenantRole | null = isTenantRole(rawRole) ? rawRole : null;
```
Actualizar `AuthInfo.role` a `TenantRole | null`.

**Criterio:** `npm run typecheck` sin errores; tests de gates siguen verdes.

---

### Bloque 3 — Deuda y decisiones (P3)

#### 7. MED-01 — Separar kill switches de feature flags

**Estado:** documentado en `docs/feature-flags.md`; no requiere cambio de código en esta rama. Queda como deuda de diseño.

**Riesgo real:** error humano al togglear (`enabled = true` mata la funcionalidad). No es una vulnerabilidad.

**Acción mínima (sin migración):**
- [x] Documentar la semántica en `docs/feature-flags.md` y en el panel.
- [ ] Impedir que el editor genérico de flags de release cree/edite claves `kill_*` (validación en `src/app/api/admin/feature-flags/route.ts`).
- Opcional a futuro: columna `killed` o tabla `kill_switches`.

#### 8. MED-02 — Aviso de `RATE_LIMIT_TRUSTED_HOPS`

**Estado:** implementado en `src/lib/rate-limit.ts`.

**Corrección al plan:** lanzar un error en producción rompería Vercel/preview, donde el header del edge es confiable y la variable no se usa.

**Fix aplicado:** advertir una sola vez, solo en producción y solo cuando **no** se confía en el edge:
```ts
if (!shouldTrustEdgeIpHeaders() && !process.env.RATE_LIMIT_TRUSTED_HOPS) {
  logger.warn('RATE_LIMIT_TRUSTED_HOPS no configurado: ...');
}
```
No lanza error. Test en `rate-limit.test.ts`.

#### 9. HIGH-01 — No hacer

`'unsafe-eval'` es solo de desarrollo y Next lo necesita para HMR. Eliminarlo no mejora la seguridad de producción y rompe la DX. Dejar una nota en `csp.ts` indicando que es intencional.

---

## Lo que NO hay que hacer (ya está resuelto)

| Ítem | Por qué no |
|---|---|
| CRIT-01 | `products` es global por diseño; 032 ya limita SELECT vía `product_stock` y 034 revoca DML. Test de aislamiento existente |
| CRIT-02 | Límites por cuenta/email ya implementados en login, signup y forgot-password |
| CRIT-03 | Policy INSERT eliminada en 020; DML revocado en 034; alta solo server-side |
| MED-03 | 048/049 usan UPDATE condicional atómico con lock de fila |
| MED-04 | 029 ya tiene `tenant_id`, RLS y policies por tenant |
| LOW-02 | `audit-prod.mjs` corre en CI |
| LOW-03 | `ggshield` corre en CI |
| HIGH-01 | Solo dev; no es riesgo de producción |

---

## Correcciones de rutas al plan

| Plan dice | Ruta real |
|---|---|
| `lib/product-service.ts` | `src/lib/product-service.ts` |
| `lib/rate-limit.ts` | `src/lib/rate-limit.ts` |
| `lib/security/csp.ts` | `src/lib/security/csp.ts` |
| `lib/upload-service.ts` | `src/lib/upload-service.ts` |
| `lib/kill-switch.ts` / `lib/feature-flags.ts` | `src/lib/kill-switch.ts` / `src/lib/feature-flags.ts` |
| `lib/logger.ts` | `src/lib/logger.ts` |
| `lib/api-auth.ts` | `src/lib/api-auth.ts` |
| `src/app/api/auth/*/route.ts` | correcto |

También: las líneas citadas del plan no coinciden con el código actual (por ejemplo, `csp.ts:52/60` sí coincide, pero `upload-service.ts:130-138` es el bloque de magic bytes, no de dimensiones).

---

## PRs sugeridos (en orden)

1. **PR-1 — RLS invitations:** `migrations/070_lock_invitations_select.sql` + verificación en staging + test.
2. **PR-2 — PII y tipos:** LOW-04 (login/signup/auth-service) + LOW-05 (`AuthInfo.role`).
3. **PR-3 — Upload:** validación de dimensiones + tests.
4. **PR-4 — CSP Sentry:** host del DSN + test de `buildCsp`.
5. **PR-5 — Tests faltantes:** CSP nonce, inactividad, idempotencia.
6. **PR-6 — Docs/decisiones:** MED-01, MED-02, HIGH-01 (nota de intencionalidad).

**Orden recomendado de ejecución:** Bloque 0 → PR-1 → PR-2 → PR-3 → PR-4 → PR-5 → PR-6.

---

## Criterio de cierre

- [ ] Las 7 migraciones críticas están aplicadas en staging y producción.
- [ ] `npm run verify:rls` pasa en staging.
- [ ] Un `member` no puede leer `invitations` por PostgREST (migración `070` aplicada).
- [x] Los logs de auth no contienen emails.
- [x] Upload rechaza imágenes > 4096 px o > 16 MP.
- [x] El CSP no tiene wildcards de Sentry cuando hay DSN.
- [ ] `npm run test:run`, `npm run lint` y `npm run typecheck` verdes.
