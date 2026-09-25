# Plan de Arquitectura — Vynko

Auditoría de arquitectura y seguridad, con plan de acción por fase.
Fecha: 2026-09-24. Rama origen: `feature/modal-gestionar-categorias`.

## Estado por punto

| # | Punto | Estado | Evidencia |
|---|-------|--------|-----------|
| 1 | Variables de entorno separadas de código | ✅ OK | Todo vía `process.env`; sin valores hardcodeados. Pendiente: `.env.example` |
| 2 | `.env` fuera de Git | 🟡 Casi | `.env.local` ignorado ✅; falta cubrir `.env` plano en `.gitignore` |
| 3 | No existen secrets hardcodeados | ✅ OK | Sin keys literales en `src/`, `scripts/`, `e2e/` |
| 4 | No existen API keys en el frontend | ✅ OK | Solo `NEXT_PUBLIC_*` públicas (anon key, MP public key). Service role solo server-side |
| 5 | Migraciones de DB versionadas | ✅ OK | `migrations/001_..031` SQL numeradas |
| 6 | Código muerto eliminado | 🟡 Hay limpieza | 4 deps sin uso (`@vercel/nft`, `@zxing/browser`, `class-variance-authority`, `date-fns`) + exports muertos |
| 7 | `console.log` innecesarios eliminados | 🟡 Hay leftover | 5 logs de DEBUG con PII en `src/app/auth/callback/route.ts:46-75` |
| 8 | Errores manejados correctamente | 🟡 Faltan | `res.json()` sin chequear `res.ok` (scanning, sales, settings, billing); errores tragados; `isError` confundido con vacío |
| 9 | Error boundaries implementados | 🟡 Incompleto | Solo `error.tsx` raíz; sin `global-error.tsx`, sin nested boundaries |
| 10 | Loading states | 🟡 Faltan | Sin `loading.tsx` de ruta; gaps en settings y dashboard |
| 11 | Empty states | 🟡 Faltan | `TransferInbox` devuelve `null`; varios placeholder |
| 12 | Estados de error amigables | 🟡 Faltan | No hay componente `ErrorState` compartido |
| 13 | Sin operaciones críticas exclusivas en cliente | 🟡 90% | Mutaciones todas server-side ✅; 1 query directa en `codigos/page.tsx`; RLS de `products` expone DML global |

## Fase 1 — Seguridad (alta)

- [x] **1.1 Migración RLS de productos** — `migrations/032_fix_products_rls.sql`
  - Quitar políticas globales de `products` (INSERT/UPDATE/DELETE "authenticated").
  - SELECT de productos restringido a tenants del usuario vía `product_stock`.
  - Las mutaciones siguen por service role (ya es así en toda la app).
- [x] **1.2 Eliminar consulta directa de categorías en cliente** — `src/app/codigos/page.tsx:46-52`
  - Reemplazar `supabase.from('categories')` por `GET /api/categories`.
- [x] **1.3 Restringir `__all__` a rol owner** — `src/lib/api-auth.ts:29-30`
  - El header `x-active-tenant-id: __all__` solo habilita `allTenants` si el usuario es `owner` en al menos una sucursal. Test actualizado.
- [x] **1.4 `.env` en `.gitignore` + `.env.example`**
  - Agregado `.env` plano al `.gitignore` (con excepción `!.env.example`).
  - Creado `.env.example` con las 14 variables documentadas.

## Fase 2 — Higiene (baja)

- [x] **2.1 Borrar `console.log` PII** — `src/app/auth/callback/route.ts:46-75` (logs de user_id/email/metadata/companyName eliminados; se conserva el `console.error`).
- [x] **2.2 Quitar deps sin uso** — `@vercel/nft`, `@zxing/browser`, `class-variance-authority`, `date-fns` (ninguna se importa en `src/`; `@zxing/library` se mantiene porque el scanner la usa).
- [ ] **2.3 Limpiar exports muertos** — Evaluado: `ReceiptModal` SÍ se usa en `sales/page.tsx` (falso positivo del plan original). Tipos `*Result` se conservan (son la API pública de los services). Punto descartado.

## Fase 3 — UX y robustez (media)

- [x] **3.1 Corregir `res.json()` antes de `res.ok`** — casos reales fixeados:
  - `scanning/page.tsx:71` (crítico: un 5xx ya no crea un producto falso; ahora `!res.ok` → estado `error`)
  - `sales/page.tsx:388` (`!res.ok` → throw → cae en toast de error, no "no encontrado")
  - `accept-invite/page.tsx:36` (`!res.ok` → `status='error'`, antes redirigía a `/dashboard`)
  - `settings` y `billing`: verificados, ya chequeaban `res.ok`
- [x] **3.2 Agregar `.catch()`** al `Promise.all` de `documentos/page.tsx:146-166` (unhandled rejection) — añadido catch, deja lista parcial/vacía
- [x] **3.3 Distinguir error vs vacío** — `products` (ErrorState + retry con `mutateProducts`) y `codigos` (ErrorState + retry con `mutate`) en vez de trompetear "sin resultados" ante un 5xx. `loss-prevention`: el historial ya manejaba errores con toast.
- [x] **3.4 Componente `ErrorState` compartido** — creado `components/ui/error-state.tsx`; usado en `products`, `codigos`, `providers` (inline con retry vía `reloadKey`) y en los error boundaries. `dashboard` ya tenía su banner de error con retry (se conserva, es más informativo). `sales`/`settings` muestran el error vía toast.
- [x] **3.5 Error boundaries** — `global-error.tsx` (con `<html>/<body>` propio como exige la doc), `error.tsx` anidados en products/sales/dashboard, `unstable_retry` → `retry` (prop estable en Next v16.3+), componente compartido `ErrorState`.
- [x] **3.6 Loading states faltantes** — `RouteLoading` compartido (`components/ui/route-loading.tsx`) y `loading.tsx` en dashboard, settings, products, sales, documentos, providers, codigos, loss-prevention, customers, activity-logs, forecast, billing. El resto ya tenía skeletons en contenido.
- [x] **3.7 Empty states faltantes** — colaboradores en settings ahora usa `EmptyState`; `TransferInbox` muestra error + "Reintentar" cuando falla la carga (y sigue oculto cuando no hay transferencias, que es el caso normal).
- [x] **3.8 Errores silenciosos** — `billing:78` (toast si cae el status de suscripción, incluso en `!res.ok`), `TransferInbox` (estado de error con retry), `providers:153` (toast + `ErrorState`), `sales/page.tsx` (toasts en ventas, productos/clientes y ajustes de ticket; `fetchSales` ya no tira unhandled rejection).

## Fase 1.5 — Trust boundary: el backend revalida (CRÍTICA)

Auditoría de "ninguna operación sensible depende de que el frontend ya validó".
El patrón general es bueno (prices/descuentos/total/stock CAS/tenant derivado de auth),
pero hay huecos donde el cliente manda valores absolutos o estados sin revalidación:

### Stock
- [x] **1.5.1 `sales-service.ts:367`**: validar `quantity` entero positivo (`> 0`). Hoy un `quantity: -2` fabricado infla stock (CAS hace `stock - (-2)`).
- [x] **1.5.2 `updateProduct` (PATCH) `product-service.ts:201-297`**: client manda stock absoluto sin validar (negativo/fraccionario permitido, `-50`). Reutilizar `validateProduct`/`validateStock` (>= 0, entero) y escribir `stock_history`.
- [x] **1.5.3 `importProducts` `product-service.ts:370-510`**: idem — price/stock/cost sin validar; sin `stock_history`.
- [x] **1.5.4 Migración `033_stock_checks.sql`**: CHECK constraints a nivel DB como backstop (`stock >= 0`, price/cost >= 0), con `NOT VALID` para no romper con datos legados.
- [x] **1.5.5 `customer_id` en ventas `sales-service.ts:515`**: validar que el customer pertenezca al tenant activo (hoy filtra foreign names en el join).

### Estados
- [x] **1.5.6 `stock-transfer-service.ts:145-173`**: prohibir `in_transit → pending` sin revertir el stock de origen (hoy re-envío deduce el stock dos veces). Hacer send/receive transaccional (CAS con reintentos).
- [x] **1.5.7 `purchase-order-service.ts`**: state machine real en PATCH status (hoy cualquier estado → cualquier estado). `received` re-credita `quantity_ordered` completo cada vez (stock inflation). Freeze receive de órdenes ya `received`/`cancelled` y cap de `quantity_received` <= ordered.

### Permisos / ownership
- [x] **1.5.8 Role check server-side en transfers y POs**: crear/enviar/recibir/cancelar exige `owner`/`manager`. Dirección validada con el tenant activo: envía solo la sucursal origen, recibe solo la destino, cancela solo el origen. Helper compartido `membership-role.ts`.
- [x] **1.5.9 Caja registradora**: política confirmada con el dueño del proyecto: se **mantiene** que `member` puede operar caja (bloqueo solo a `viewer`). Sin cambios de código.
- [x] **1.5.10 `__all__`**: el consolidado (`tenantIds`) queda restringido a los tenants donde el usuario es `owner`, no a todos sus tenants.

### Bien cubierto (verificado)
- Ventas: precio re-leído de DB, ajustes por método desde config del tenant, split validado contra total server, stock con CAS atómico + rollback, status hardcodeado.
- `adjustPrices` y `adjustProductStock`: derivados del %/delta en server, scoped por tenant.
- Colaboradores/settings/documentos/tenants: owner-gateados y tenant-scoped server-side.
- `auth.tenantId` nunca proviene del body/query: siempre derivado de `getAuth` (miembros validados).