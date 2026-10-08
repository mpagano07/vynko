# Trabajos de fondo (background jobs)

Cola de trabajos con reintentos para todo lo que **no puede fallar silencioso**
y no puede esperar a que alguien se acuerde: la reconciliacion de
suscripciones, y cualquier cosa que se sume despues.

## Por que es una cola en Postgres

El deploy es serverless (Vercel): no hay proceso worker corriendo, no se puede
instanciar BullMQ ni un consumer de Redis. La cola es la tabla
`background_jobs` (migracion `056_background_jobs.sql`) y la "gorra" que
procesa es un cron:

```bash
curl -X POST https://<app>/api/cron/process-jobs \
  -H "Authorization: Bearer $CRON_SECRET"
```

Ese endpoint reclama los trabajos vencidos con la funcion SQL
`claim_background_jobs`, que usa `FOR UPDATE SKIP LOCKED`: dos corridas
simultaneas **nunca** ejecutan el mismo trabajo. Si la instancia muere con un
trabajo tomado, el lock vence a los 15 minutos y la proxima pasada lo
recupera.

## Cadencia: tick diario (limite de Vercel Hobby)

El plan Hobby solo admite crons de **una vez por dia** (una expresion como
`*/5 * * * *` hace **fallar el deploy**), asi que el tick es diario a las
**05:23 UTC**, justo despues de la reconciliacion de las 05:17: un trabajo que
ese cron encola sale el mismo dia.

Consecuencias a tener presentes:

- El backoff (30 s, 60 s, ...) sigue calculando `run_after`, pero la cadencia
  real es el tick: un trabajo vencido a las 05:24 sale a las 05:23 del dia
  siguiente. Con 5 intentos, un tipo que siempre falla queda `dead` en ~5 dias.
- Para no esperar 24 h se corre a mano con el `curl` de arriba: reclamar es
  idempotente y `SKIP LOCKED` evita que dos corridas se pisen.
- Si un dia hace falta mas de un tick (se subio a Pro, o hay un pinger
  externo que llama al endpoint), solo cambia la expresion de `vercel.json`;
  el endpoint no distingue quien lo llama, solo que traiga `CRON_SECRET`.

## Ciclo de vida

```
pending ──claim──> running ──ok──> succeeded
                      │
                      ├──fallo──> pending   (run_after en el futuro: backoff)
                      │
                      └──sin intentos / sin handler──> dead
```

- Reintentos: 5 por defecto, backoff exponencial **30 s, 60 s, 120 s, 240 s,
  480 s** con techo de 30 min (`computeBackoffMs`).
- Un tipo **sin handler** no reintenta: queda `dead` con el error visible,
  porque reintentarlo solo gastaria la cola.
- El `dead` no se auto-limpia; se mira y se decide (playbook 8 del runbook).

## Como se agrega un trabajo

1. Registrar el handler en `src/lib/job-handlers.ts`:

   ```ts
   registerJobHandler('mi_trabajo', async (job) => {
     // job.payload trae lo que se encolo
   });
   ```

2. Encolarlo desde donde falle (mejor esfuerzo, nunca lanza):

   ```ts
   const id = await enqueueJob({
     jobType: 'mi_trabajo',
     payload: { motivo: 'cron' },
     runAfter: new Date(Date.now() + 60_000), // opcional
   });
   ```

3. Verificar con `npm run test:run` y un caso en `src/lib/job-queue.test.ts`.

Ya hay un ejemplo real: si el cron de reconciliacion revienta, el endpoint
encola `reconcile_subscriptions` y la cola reintenta
(`src/app/api/cron/reconcile-subscriptions/route.ts`).

## Como se encola a mano

```sql
insert into public.background_jobs (job_type, payload, run_after)
values ('reconcile_subscriptions', '{"source":"manual"}'::jsonb, now());
```

## Que esta pasando con la cola

```sql
-- Cuantos hay y en que estado
select status, count(*) from public.background_jobs group by status order by 1;

-- Los que se quedaron sin reintentos: por que?
select job_type, attempts, last_error, updated_at
  from public.background_jobs
 where status = 'dead'
 order by updated_at desc
 limit 20;

-- Algo corrido hace rato y sigue `running`? (el lock vence a los 15 min)
select id, job_type, locked_at
  from public.background_jobs
 where status = 'running' and locked_at < now() - interval '15 minutes';
```

Correr la cola a mano (mismo comando de arriba) es lo que hace un deploy o un
incidente corto: los trabajos esperan y salen en la proxima pasada.

## Seguridad

- `background_jobs` es **deny-all**: RLS habilitado sin policies y
  `revoke ... from anon, authenticated`. Nadie puede leer payloads ni inventar
  trabajos con la anon key.
- `claim_background_jobs` se niega sola para todo rol que no sea
  `service_role` (mismo patron que `rate_limit_hit`, migracion 036), ademas
  de los `REVOKE` de `PUBLIC`/`anon`/`authenticated`.
- El cron responde 503 sin `CRON_SECRET` y 500 si la base no responde: nunca
  devuelve "0 trabajos" cuando en realidad no pudo consultar.

## Archivos

| Archivo | Que hace |
|---|---|
| `migrations/056_background_jobs.sql` | Tabla, índices, deny-all y `claim_background_jobs` |
| `src/lib/job-queue.ts` | Encolar, reclamar, reintentos con backoff, despacho |
| `src/lib/job-handlers.ts` | Handlers registrados |
| `src/app/api/cron/process-jobs/route.ts` | La gorra (cron diario de `vercel.json`, 05:23 UTC) |
| `src/lib/job-queue.test.ts` | Cobertura del ciclo de vida |
