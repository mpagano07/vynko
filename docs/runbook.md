# Runbook operativo

Para quien tiene que responder a un incidente un domingo a las 3 AM. Todo lo
que esta aca sale de codigo o de docs que ya existen; nada es inventado en el
momento.

## Primeros 5 minutos

1. **¿Esta caida del todo o es una feature?**
   ```bash
   curl -s https://<app>/api/health          # 200 = proceso vivo + version
   curl -s https://<app>/api/health?check=db # 503 = no lee/escribe Supabase
   ```
2. **Errores**: Sentry (`docs/observability.md` → dashboard de errores). Un
   pico de un solo issue es mejor señal que "hay muchos logs en rojo".
3. **Logs**: Vercel → Logs. Son JSON: filtrar por `level:error` o por
   `tenantId` del cliente afectado. El `requestId` cruza un log con el
   `x-vercel-id` del request.
4. **¿Que cambio?**: Vercel → Deployments (ultimo deploy, quien lo hizo) y
   `git log --oneline -10`.

## Severidades

| Sev | Definicion | Reaccion | Ejemplo |
|---|---|---|---|
| S1 | No se puede vender o hay fuga de datos/dinero | 15 min | app 500, ventas que no graban, cobros duplicados |
| S2 | Feature rota con workaround o errores masivos | 2 h | import de productos falla, webhook de MP rechazado |
| S3 | Bug puntual, no bloquea | siguiente ciclo | un validation message mal escrito |

Todo S1/S2 se anota en el canal con: que se ve, cuando empezo, ultimo deploy,
accion tomada.

## Playbooks

### 1. Deploy malo (rollback)

El deploy es inmutable: **revertir es publicar el anterior**, no recompilar.

1. Vercel → proyecto → **Deployments** → el ultimo bueno → `...` →
   **Promote to Production**.
2. Verificar `GET /api/health` (la respuesta trae el `version` = commit SHA).
3. Si el problema es de codigo y no conviene dejar el `main` apuntando a algo
   viejo: `git revert <sha>` en `main` y dejar que el deploy normal lo
   publique.

**Ojo con migraciones**: `migrations/NNN_*.sql` son **forward-only**. Si el
deploy que rompio incluyo una migracion, no alcanza con el rollback de la app:
o se aplica una migracion correctiva nueva (numero mas alto) o se restaura la
DB desde el ultimo dump (`docs/continuity.md`). Por eso las migraciones van en
el commit ANTES de usarlas (expand/contract), nunca en el mismo deploy que las
consuma.

### 2. La base no responde (`?check=db` → 503)

1. Supabase → Dashboard → Status / el mail de incidente de Supabase.
2. Si es de Supabase: no hay rollback posible, toca esperar o restaurar en
   otra instancia (`docs/continuity.md` → Restore).
3. Si es de nosotros (RLS nuevo, migracion mal aplicada): mirar el ultimo
   `migrations/` aplicado y corregir con uno nuevo encima.
4. Mientras este caida, las ventas del cliente no se guardan: avisar
   comunicacion breve ("estamos con un problema de base de datos").

### 3. Cobros / webhooks (MercadoPago y Paddle)

- **Webhook rechazado (401)**: firma invalida. Revisar el secreto del
  destination del proveedor y rotarlo con `docs/security-secrets-rotation.md`:
  - MercadoPago: `MERCADOPAGO_WEBHOOK_SECRET` (Vercel env + panel de MP → Webhooks).
  - Paddle: `PADDLE_WEBHOOK_SECRET` (Vercel env + Paddle → Developer tools →
    Notifications → destination `/api/webhooks/paddle`).
- **Suscripciones desincronizadas**: correr el cron a mano y leer el reporte.
  Reconcilia las dos pasarelas y devuelve `{ mercadopago, paddle }`:
  ```bash
  curl -X POST https://<app>/api/cron/reconcile-subscriptions \
    -H "Authorization: Bearer $CRON_SECRET"
  ```
  `CRON_SECRET` esta en los envs de Vercel; el mismo endpoint acepta GET (es
  el que usa el cron programado de `vercel.json`, diario 05:17 UTC). En cada
  reporte, `inSync + repaired + unreachable` tiene que cuadrar con `checked`.
- **Cobro no reflejado en la app**: los eventos son at-least-once y con
  dedupe; un reintento de MP/Paddle llega igual. Recien despues de dos
  reintentos mirar logs con `job:mercadopago-webhook` o `job:paddle-webhook`.
- **Alta de Paddle en un entorno nuevo**: `PADDLE_ENVIRONMENT`
  (`sandbox`|`production`), `PADDLE_API_KEY` y `PADDLE_PRICE_IDS` (JSON por
  moneda). Los `pri_` de sandbox NO sirven en produccion: hay que correr
  `node scripts/paddle-bootstrap.mjs --env <archivo>` contra la cuenta de ese
  entorno para crear productos, precios y el destination del webhook.
- **Probar el cobro internacional (Paddle) en sandbox**: en local no hay
  headers de IP, asi que el pais se fuerza con la cookie `vynko_country` (el
  mismo valor que el proxy escribe en produccion).
  1. Precondiciones: `PADDLE_ENVIRONMENT=sandbox`, `PADDLE_API_KEY`
     (`pdl_sdbx_...`), `PADDLE_PRICE_IDS` (al menos `USD`; idealmente las
     monedas locales) y `PADDLE_WEBHOOK_SECRET`. Generar catalogo y secreto:
     `node scripts/paddle-bootstrap.mjs --env .env.local --webhook https://<host>/api/webhooks/paddle`.
     Correr `npm run dev`.
  2. **Pais**: en DevTools → Application → Cookies crear `vynko_country=CO`
     (o `MX`/`BR`/`CL`/`PE`). `/api/*` no pasa por el proxy, pero la cookie
     viaja en el fetch del checkout y en local es el unico rastro del pais.
  3. **Display**: en `/` y `/billing` el precio tiene que salir en la moneda
     local configurada (p. ej. `$ 69.900 COP`). Si la moneda del pais NO esta
     en `PADDLE_PRICE_IDS`, se muestra en USD. La cookie
     `vynko_paddle_currencies` lista las monedas con `price_id`; la nota al pie
     de la landing ("Fuera de Argentina el cobro se procesa...") aparece para
     no-AR.
  4. **Checkout**: iniciar Starter/Business en `/billing` → redirige al checkout
     de Paddle sandbox por el importe mostrado. Tarjeta de prueba:
     `4242 4242 4242 4242`, cualquier vencimiento futuro y CVC.
  5. **Webhook**: al pagar, Paddle manda `transaction.completed` +
     `subscription.created/activated`. Verificar en `tenants`:
     `billing_provider='paddle'`, `subscription_status='active'`,
     `subscription_plan=<plan>`, `paddle_subscription_id='sub_...'`,
     `paddle_customer_id='ctm_...'`; una fila en `webhook_events` con
     `provider='paddle'` y `outcome='processed'`; y un evento
     `subscription_started`. Antes del webhook la cuenta queda con
     `paddle_pending_transaction_id` (aviso de "pago pendiente" en `/billing`).
  6. **Replay**: reenviar el MISMO evento desde el panel de Paddle → 200 sin
     duplicar (dedupe por `event_id`, o `duplicate` por compare-and-set).
  7. **Cancelacion**: Cancelar en `/billing` → `next_billing_period`; la DB
     queda `subscription_status='canceled'`, `subscription_plan='free'`,
     `paddle_subscription_id=NULL`; evento `subscription_cancelled`
     (`source: portal`).
  8. **Reconciliacion**: `curl -X POST <app>/api/cron/reconcile-subscriptions
     -H "Authorization: Bearer $CRON_SECRET"`; el bloque `paddle` tiene que
     cuadrar (`inSync + repaired + unreachable == checked`). Para forzar un
     `repaired`: desincronizar a mano (`update tenants set
     subscription_status='active' where id=...` con la suscripcion ya cancelada
     en Paddle) y correr el cron.
  9. **Firma invalida**: un POST a `/api/webhooks/paddle` sin
     `Paddle-Signature` (o con firma mala) devuelve 401. Requiere
     `PADDLE_WEBHOOK_SECRET`: sin el, el webhook se rechaza SIEMPRE (tambien en
     desarrollo). Para probar el flujo local sin firma hay que pedirlo explicito
     con `WEBHOOK_ALLOW_UNVERIFIED=1` y solo funciona con
     `NODE_ENV=development`.
  10. Argentina siempre cae a MercadoPago (ARS): para probar Paddle hay que
      usar un pais no-AR.

### 4. Errores masivos en Sentry

1. Triaje en `docs/observability.md` (es S1 solo si afecta datos/cobros).
2. Si es regresion de un deploy → playbook 1.
3. Si es un error esperado (401 de cliente viejo, replay de webhook):
   *ignore* en Sentry con comentario; si no, se vuelve a ignorar sin contexto.

### 5. 429 / usuarios bloqueados

El limiter es fail-open **salvo en los endpoints de credenciales**
(`src/lib/rate-limit.ts`). Si el store de Postgres está caído:

- login, alta, recuperación y cambio de contraseña responden **503** (sin
  contador no hay protección contra fuerza bruta; el 503 es corto y visible);
- el resto de los límites (imports, uploads, analytics, throttle de `/api/*`)
  deja pasar, para no amplificar la caída.

Un 503 de auth con `storeUnavailable` en los logs suele significar que falta
aplicar `036_rate_limit_buckets.sql` o `037_rate_limit_peek.sql`. Un pico de 429
con tráfico legítimo se revisa en los logs con `msg` de rate limiting; el bypass
`E2E=1` existe solo para tests con `NODE_ENV != production`.

### 6. Secretos filtrados o rotos

Inventario, rotacion y verificacion: `docs/security-secrets-rotation.md`.
No revocar antes de verificar (`/api/health?check=db` + un cobro de prueba).

### 7. Aplicar una migracion en produccion

1. Numerarla siguiente en `migrations/` y commitearla con el codigo que la
   usa (o antes).
2. Aplicar: `supabase db query --db-url $PROD_DB_URL -f migrations/NNN_x.sql`
   (o SQL editor del dashboard).
3. Verificar: `npm run verify:rls` si toca politicas RLS.
4. Si rompe, NO hay `down`: migracion correctiva nueva encima (playbook 1 si
   tambien hay que volver el deploy).

### 8. Trabajos de fondo atascados

Diseno y SQL: `docs/background-jobs.md`.

1. Correr la cola a mano y leer el reporte:
   ```bash
   curl -X POST https://<app>/api/cron/process-jobs \
     -H "Authorization: Bearer $CRON_SECRET"
   ```
   `claimed > 0` y todo `succeeded` es lo normal. `500` = la base no dejo
   reclamar (no es un problema de la cola sino del playbook 2).
2. Mirar los `dead` (se agotaron los reintentos o falta el handler):
   ```sql
   select job_type, attempts, last_error, updated_at
     from public.background_jobs
    where status = 'dead'
    order by updated_at desc limit 20;
   ```
3. Corregida la causa, reencolar (o esperar al tick diario de 05:23 UTC si
   sigue `pending`; para no esperar 24 h, correr el `curl` de `process-jobs`
   a mano):
   ```sql
   update public.background_jobs
      set status = 'pending', run_after = now(), attempts = 0, updated_at = now()
    where status = 'dead' and job_type = '<tipo>';
   ```
4. Un trabajo `running` con `locked_at` de hace mas de 15 minutos no existe:
   `claim_background_jobs` lo recupera solo en la proxima pasada.

### 9. Cortar un area sin deploy (kill switch)

Usalo cuando una sola funcion esta causando dano (ventas duplicadas, import que
rompe stock, checkout que cobra mal) y no hay tiempo de arreglar y desplegar.
No reemplaza al rollback si el problema es de codigo: apaga el sintoma mientras
se prepara el fix.

1. **Panel**: `/admin/ops` → `Matar` en el area afectada. Confirmar.
   - `Ventas` → `POST /api/sales`
   - `Pagos (Paddle)` → checkout, portal y downgrade (los webhooks siguen)
   - `Pronóstico` → `GET /api/forecast`
   - `Importación de productos` → `POST /api/products/import`
   - `Mantenimiento global` → las cuatro areas + paginas a `/maintenance`
2. **API** (si el panel no carga): `PUT /api/admin/feature-flags` como admin:
   ```bash
   curl -X PUT https://<app>/api/admin/feature-flags \
     -H "Content-Type: application/json" -H "Cookie: <sesión admin>" \
     -d '{"flag_key":"kill_sales","enabled":true,"rollout_percent":100}'
   ```
3. **SQL** (si la API tampoco responde): el upsert funciona exista o no la
   fila semilla de la 068:
   ```sql
   insert into public.feature_flags (flag_key, enabled, rollout_percent, description)
   values ('kill_sales', true, 100, 'Kill switch manual')
   on conflict (flag_key) do update
     set enabled = excluded.enabled, updated_at = now();
   ```
4. **Env** (si la base esta caida o lenta): `FEATURE_KILL_SALES=on` (o
   `MAINTENANCE_MODE=on`) en Vercel y redeploy. La env solo fuerza ON.
5. **Verificar**: la ruta afectada responde `503` con
   `code: "KILL_SWITCH_<AREA>"` y `Retry-After: 60`; `/api/health`,
   `/api/session` y los webhooks siguen respondiendo. En el peor caso tarda
   ~10 s (cache del servidor) + 15 s (banner).
6. **Revivir**: `/admin/ops` → `Revivir` (o `enabled=false` por API/SQL). El
   panel sigue cargando aunque el mantenimiento global esté activo. Si el
   area estaba forzada por env, primero sacar la variable **en Vercel** y
   redeployar: el boton aparece bloqueado con un candado. Un `.env` local no
   cambia nada en producción.
7. **Cierre**: dejar en el canal que se corto, por que, a que hora y cuando se
   revivio. Si el corte fue por env, sacar la variable para no dejar el kill
   pegado al proximo deploy.

## Mantenimiento / tareas programadas

| Tarea | Cadencia | Como |
|---|---|---|
| Backup de prod | diario 03:30 UTC | `.github/workflows/backup.yml` (verifica estructura, publica Release cifrado y rota los viejos) |
| Reconciliacion de suscripciones | diario 05:17 UTC | cron de `vercel.json` → `/api/cron/reconcile-subscriptions` |
| Cola de trabajos de fondo | diario 05:23 UTC | cron de `vercel.json` → `/api/cron/process-jobs` (playbook 8) |
| Drill de restore | trimestral | `docs/continuity.md` → Drill |
| Rotacion de secretos | segun politica | `docs/security-secrets-rotation.md` |

## Contactos / escalamiento

| Rol | Quien | Canal |
|---|---|---|
| Responsable tecnico | _(completar)_ | _(completar)_ |
| Responsable de producto | _(completar)_ | _(completar)_ |
| Proveedor (Supabase / Vercel / Mercado Pago / Paddle) | — | status pages + soporte del plan |

## Referencias

- Logs, Sentry y alertas → `docs/observability.md`
- Trabajos de fondo y reintentos → `docs/background-jobs.md`
- Feature flags → `docs/feature-flags.md`
- Backup, restore, RPO/RTO → `docs/continuity.md`
- Secretos → `docs/security-secrets-rotation.md`
- Arquitectura y decisiones → `docs/architecture-plan.md`
