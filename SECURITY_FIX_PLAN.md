# Plan de Arreglo de Seguridad — Vynko

**Generado:** 2026-11-06  
**Basado en:** Auditoría completa de seguridad y calidad

---

## 🔴 NIVEL CRÍTICO — Bloquean release / Riesgo de brecha inmediata

### CRIT-01: Verificar y corregir RLS en tabla `products` (Global vs Tenant-scoped)
**Riesgo:** Cross-tenant data leak si `products` no tiene `tenant_id` pero la policy lo asume.  
**Archivos:** `migrations/001_initial_schema.sql:78-95`, `lib/product-service.ts:114-121`  
**Acción:**
1. Verificar esquema actual de `products` en Supabase Dashboard → Table Editor.
2. Si `products` **no tiene `tenant_id`** (catálogo global):
   - Dropear policies actuales de `products`.
   - Crear policies que hagan JOIN con `product_stock` para scope por tenant.
   - O mover todo acceso a `products` vía RPCs server-side (`lib/product-service.ts` ya lo hace).
3. Si `products` **sí tiene `tenant_id`**: confirmar que migraciones 003+ no la removieron.
**Tests:** Test de integración: User A en Tenant 1 NO ve productos de Tenant 2.

---

### CRIT-02: Rate limit por cuenta (email/user) en endpoints de auth
**Riesgo:** Fuerza bruta distribuida evade límite por IP.  
**Endpoints afectados:** `/api/auth/login`, `/api/auth/signup`, `/api/auth/forgot-password`, `/api/auth/oauth`  
**Archivos:** `lib/rate-limit.ts`, `src/app/api/auth/*/route.ts`  
**Acción:**
```typescript
// En cada endpoint de auth sensible, ANTES de procesar:
const email = body?.email?.toLowerCase?.() ?? 'unknown';
const rl = await rateLimit(`auth:login:email:${email}`, 5, 15 * 60 * 1000);
if (!rl.ok) return 429 con Retry-After;
```
**Tests:** Simular 6 requests con mismo email desde IPs distintas → 6to debe devolver 429.

---

### CRIT-03: Endurecer policy `tenant_users` INSERT — Validar invitación
**Riesgo:** Usuario autenticado puede auto-asignarse a cualquier tenant insertando fila en `tenant_users`.  
**Archivo:** `migrations/002_fix_rls_recursion.sql:37-38`  
**Acción (opción A — Policy con check de invitación):**
```sql
DROP POLICY "Users can insert their own tenant membership" ON tenant_users;
CREATE POLICY "Users can insert their own tenant membership via invitation" ON tenant_users
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM invitations i
      WHERE i.tenant_id = tenant_users.tenant_id
        AND i.email = (SELECT email FROM auth.users WHERE id = auth.uid())
        AND i.accepted_at IS NULL
    )
  );
```
**Acción (opción B — RPC server-only, RECOMENDADA):**
- Dropear policy INSERT.
- Crear RPC `accept_invitation(invitation_id UUID)` con `SECURITY DEFINER` que valide e inserte en `tenant_users`.
- Endpoint `/api/invitations/accept` llama al RPC.
**Tests:** Intentar `INSERT INTO tenant_users` directo como user autenticado sin invitación → debe fallar.

---

## 🟠 NIVEL ALTO — Deben arreglarse antes de próximo deploy a prod

### HIGH-01: Eliminar `'unsafe-eval'` de CSP en desarrollo
**Riesgo:** XSS en dev permite `eval()` / `new Function()`.  
**Archivo:** `lib/security/csp.ts:52`  
**Acción:**
```typescript
// Verificar si Next.js 15+ HMR funciona sin 'unsafe-eval'
// Si sí, remover:
${isDev ? " 'unsafe-eval' https://va.vercel-scripts.com" : ''}
// → dejar solo https://va.vercel-scripts.com si Vercel Analytics lo requiere
```
**Tests:** `npm run dev` → verificar HMR, React DevTools, Vercel Analytics funcionan.

---

### HIGH-02: Restringir `connect-src` de Sentry a DSN específico
**Riesgo:** Wildcard `*.ingest.sentry.io` permite exfiltración si subdominio comprometido.  
**Archivo:** `lib/security/csp.ts:60`  
**Acción:**
```typescript
// Obtener DSN de env (ej: https://abc123@o456.ingest.sentry.io)
// Extraer host: o456.ingest.sentry.io
const sentryDsnHost = process.env.SENTRY_DSN?.match(/https?:\/\/[^@]+@([^/]+)/)?.[1];
// Usar en CSP:
connect-src 'self' ... ${sentryDsnHost ? `https://${sentryDsnHost}` : ''}
```
**Tests:** Deploy a preview → verificar que errores llegan a Sentry (Replay/Error tracking).

---

### HIGH-03: Restringir SELECT en `invitations` a roles owner/manager
**Riesgo:** Miembros (`member`, `cashier`, `viewer`, `stock`) ven emails de invitaciones pendientes (incluye futuros admins).  
**Archivo:** `migrations/005_create_invitations.sql:24-27`  
**Acción:**
```sql
DROP POLICY "Users can view invitations for their tenant" ON invitations;
CREATE POLICY "Owners and managers can view invitations" ON invitations
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
  );
```
**Tests:** Login como `member` → GET `/api/invitations` → 403 o array vacío.

---

### HIGH-04: Validar dimensiones de imagen en upload + malware scan
**Riesgo:** DoS por imágenes gigantes descomprimidas (ej. 50000x50000px PNG = GBs en memoria).  
**Archivo:** `lib/upload-service.ts:130-138`  
**Acción:**
```typescript
// Después de detectar MIME y magic bytes:
const sharp = await import('sharp'); // o usar biblioteca nativa
const metadata = await sharp(buffer).metadata();
if (metadata.width > 4096 || metadata.height > 4096) {
  return { ok: false, error: 'Imagen demasiado grande (máx 4096x4096)', status: 400 };
}
// Opcional: ClamAV scan si bucket público
```
**Tests:** Subir imagen 5000x5000px → rechazo 400. Subir imagen válida → OK.

---

## 🟡 NIVEL MEDIO — Arreglar en próximo sprint

### MED-01: Separar kill switches de feature flags (tabla o columna distinta)
**Riesgo:** Semántica invertida confusa (`enabled=true` = MATADO vs ACTIVO). Error humano al togglear.  
**Archivos:** `lib/kill-switch.ts:19-29`, `lib/feature-flags.ts`  
**Acción (opción A — Columna `killed` en misma tabla):**
```sql
ALTER TABLE feature_flags ADD COLUMN killed BOOLEAN DEFAULT FALSE;
-- Migrar datos: UPDATE feature_flags SET killed = enabled WHERE flag_key IN ('kill_sales', 'kill_payments', ...);
-- Código: kill switch lee `killed`, feature flags lee `enabled`
```
**Acción (opción B — Tabla separada `kill_switches`):**
```sql
CREATE TABLE kill_switches (
  flag_key TEXT PRIMARY KEY,
  killed BOOLEAN DEFAULT FALSE,
  description TEXT,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```
**Tests:** Toggle kill switch en `/admin/ops` → verificar que NO afecta feature flags normales.

---

### MED-02: Requerir `RATE_LIMIT_TRUSTED_HOPS` en prod self-hosted
**Riesgo:** Sin env var, `getClientIp` toma último hop de `x-forwarded-for` → evasible.  
**Archivo:** `lib/rate-limit.ts:353-357`  
**Acción:**
```typescript
function parseTrustedHops(): number {
  const raw = (process.env.RATE_LIMIT_TRUSTED_HOPS ?? '').trim();
  if (process.env.NODE_ENV === 'production' && !raw) {
    logger.error('RATE_LIMIT_TRUSTED_HOPS no configurado en producción — rate limit por IP INSEGURO');
    // En prod, mejor fail closed que inseguro:
    throw new Error('RATE_LIMIT_TRUSTED_HOPS requerido en producción');
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
```
**Tests:** Deploy a prod sin env var → crash al inicio (visible en logs).

---

### MED-03: Verificar RPC `adjust_stock_atomic` y `create_sale_atomic` usan locks correctos
**Riesgo:** Race condition en stock si RPC no usa `FOR UPDATE` / serializable.  
**Archivos:** Migraciones 048, 049 (no leídas), `lib/sales-service.ts:773-803`, `lib/product-service.ts:1248-1254`  
**Acción:**
1. Leer migraciones 048 (`create_sale_atomic`) y 049 (`adjust_stock_atomic`).
2. Verificar que usan `SELECT ... FOR UPDATE` en `product_stock` antes de actualizar.
3. Verificar que transacción es `REPEATABLE READ` o `SERIALIZABLE`.
**Tests:** Simular 20 ajustes concurrentes al mismo producto → stock final = inicial + suma(ajustes), sin negativos.

---

### MED-04: Verificar RLS en `cash_register_sessions`
**Riesgo:** Tabla referenciada en `sales-service.ts:565-570` pero no visible en migraciones leídas.  
**Acción:** Buscar migración que crea `cash_register_sessions` y auditar sus policies. Debe tener `tenant_id` y policies equivalentes a `sales`.

---

## 🟢 NIVEL BAJO — Deuda técnica / Mejora continua

### LOW-01: Tests de seguridad automatizados
**Objetivo:** Prevenir regresiones.  
**Tests a crear:**
| Test | Qué valida |
|------|------------|
| `csp-nonce.test.ts` | Cada response HTML tiene `script[nonce]` que coincide con CSP header |
| `rls-isolation.test.ts` | User A no lee datos de Tenant B (products, sales, customers, etc.) |
| `csrf-origin.test.ts` | POST cross-origin rechazado, same-origin aceptado |
| `rate-limit-bypass.test.ts` | IP spoofing via `x-forwarded-for` no evade límite |
| `session-inactivity.test.ts` | Cookie robada sin `vynko_last_seen` expira a los 30 min |
| `idempotency-sales.test.ts` | Mismo `idempotency-key` + mismo body → 1 sola venta |

---

### LOW-02: Dependency audit (`npm audit` / `pnpm audit`)
**Frecuencia:** Semanal en CI.  
**Acción:** Configurar `pnpm audit --prod --audit-level=high` en pipeline. Bloquear merge si vulnerabilidades `high`/`critical` en deps de prod.

---

### LOW-03: Secrets scanning en git history
**Acción:** `git log --all --full-history --oneline --grep="secret\|password\|key\|token"` + herramienta tipo `gitleaks` / `trufflehog` en CI.

---

### LOW-04: Structured logging sin PII
**Archivo:** `lib/logger.ts` (auditar)  
**Regla:** Logs en prod NO contienen emails, nombres, IDs de usuario reales. Usar `userId` hasheado o `requestId` para correlacionar.

---

### LOW-05: Type safety en `api-auth.ts` role
**Archivo:** `lib/api-auth.ts:99`  
**Fix:**
```typescript
// Cambiar:
role: (tu ?? []).find((t) => t.tenant_id === tenantId)?.role ?? null,
// Por:
role: ((tu ?? []).find((t) => t.tenant_id === tenantId)?.role as import('@/lib/roles').TenantRole) ?? null,
```

---

## 📋 ORDEN DE EJECUCIÓN SUGERIDO

| Semana | Foco | Entregables |
|--------|------|-------------|
| **1** | CRIT-01, CRIT-02, CRIT-03 | RLS `products` fix, rate limit por email, policy `tenant_users` |
| **2** | HIGH-01, HIGH-02, HIGH-03, HIGH-04 | CSP unsafe-eval, Sentry DSN, invitations RLS, upload dims |
| **3** | MED-01, MED-02, MED-03, MED-04 | Kill switch separation, TRUSTED_HOPS, RPC locks, cash_register RLS |
| **4+** | LOW-01 a LOW-05 | Tests seguridad, audit CI, secrets scan, logging, types |

---

## ✅ CRITERIOS DE ACEPTACIÓN POR NIVEL

### Crítico — **Bloquea deploy a prod si no está done**
- [ ] CRIT-01: Test cross-tenant `products` pasa (User A no ve Tenant B)
- [ ] CRIT-02: 6to login con mismo email desde IP distinta → 429
- [ ] CRIT-03: INSERT directo en `tenant_users` sin invitación → falla

### Alto — **Debe estar en próximo release**
- [ ] HIGH-01: `npm run dev` funciona sin `'unsafe-eval'`
- [ ] HIGH-02: Errores llegan a Sentry con DSN restringido
- [ ] HIGH-03: `member` no ve invitaciones (403 o vacío)
- [ ] HIGH-04: Imagen 5000x5000px → 400

### Medio — **Sprint siguiente**
- [ ] MED-01: Kill switch toggle no rompe feature flags
- [ ] MED-02: Prod sin `RATE_LIMIT_TRUSTED_HOPS` → crash visible
- [ ] MED-03: 20 ajustes concurrentes → stock consistente
- [ ] MED-04: `cash_register_sessions` tiene RLS auditado

### Bajo — **Continuo**
- [ ] LOW-01: 6 tests seguridad en CI (verde)
- [ ] LOW-02: `pnpm audit` pasa en CI
- [ ] LOW-03: `gitleaks` pasa en CI
- [ ] LOW-04: Logs prod sin PII (spot-check)
- [ ] LOW-05: TypeScript compila sin `any` en `api-auth.ts`

---

## 🔄 PRÓXIMOS PASOS

1. **Revisar este plan** — confirmar prioridades / añadir contexto faltante.
2. **Asignar owners** por ticket (CRIT → backend lead, HIGH → backend/frontend, MED → backend/DevOps).
3. **Crear issues/PRs** en GitHub con labels `security`, `priority:critical|high|medium|low`.
4. **Ejecutar Semana 1** — arrancar con CRIT-01 (verificar esquema `products` en Supabase Dashboard).

---

¿Querés que cree los issues en GitHub, que empiece con CRIT-01 (verificar esquema `products`), o que detalle el fix de alguno en código?