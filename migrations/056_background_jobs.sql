-- ============================================================
-- 056: cola de trabajos de fondo (background jobs)
-- ============================================================
--
-- Motivo: hasta ahora el unico trabajo programado era el cron de
-- reconciliacion de suscripciones (vercel.json), que corre una vez por dia y
-- si falla, falla. No hay donde dejar un trabajo "intentalo de nuevo en 30 s",
-- no hay historial de lo que corrio, ni reintento con backoff.
--
-- Esta cola es el lugar para ese trabajo. Es la variante serverless: la cola
-- vive en Postgres (no hay proceso worker en Vercel), y la unica "gorra" es un
-- cron que llama a `/api/cron/process-jobs`, que reclama trabajos vencidos,
-- ejecuta el handler registrado y deja el resultado en la fila.
--
--   pendiente --> running --> succeeded
--                    |
--                    +--> pending (con run_after en el futuro: backoff)
--                    +--> dead    (se agotaron los intentos o tipo desconocido)
--
-- El claim es atomico (`FOR UPDATE SKIP LOCKED`): dos invocaciones simultaneas
-- del cron nunca ejecutan el mismo trabajo dos veces, y si una instancia muere
-- a mitad de ejecucion, el lock vence y el trabajo se recupera solo.
--
-- Convenciones de esta migracion (iguales a 036 y 053):
--   * la tabla es deny-all: solo service role, PostgREST con la anon key no
--     ve ni escribe trabajos;
--   * la funcion se niega a si misma para todo rol que no sea service_role,
--     ademas de los REVOKE: no se depende solo del ACL.

create table if not exists public.background_jobs (
  id           uuid primary key default gen_random_uuid(),
  job_type     text          not null,
  payload      jsonb         not null default '{}'::jsonb,
  tenant_id    uuid,
  status       text          not null default 'pending'
                 check (status in ('pending', 'running', 'succeeded', 'dead')),
  -- Cuanto falta para poder reclamarlo. El backoff escribe aca, no en attempts.
  run_after    timestamptz   not null default now(),
  attempts     integer       not null default 0,
  max_attempts integer       not null default 5,
  -- Marca de quien lo tiene tomado; vence a los 15 minutos (ver funcion).
  locked_at    timestamptz,
  last_error   text,
  created_at   timestamptz   not null default now(),
  updated_at   timestamptz   not null default now()
);

comment on table public.background_jobs is
  'Cola de trabajos de fondo con reintentos. Solo service role.';

-- El cron reclama "lo que vencio", asi que el indice cubre esa consulta.
create index if not exists background_jobs_due_idx
  on public.background_jobs (run_after)
  where status = 'pending';

-- Para listar trabajos de un tipo (runbook: "que quedo dead?").
create index if not exists background_jobs_type_status_idx
  on public.background_jobs (job_type, status, created_at desc);

alter table public.background_jobs enable row level security;
revoke all on public.background_jobs from anon, authenticated;

-- ============================================================
-- Reclamo atomico de trabajos vencidos
-- ============================================================
create or replace function claim_background_jobs(p_limit integer default 10)
returns setof public.background_jobs
language plpgsql
-- INVOKER a proposito: corre con los privilegios de quien la llama (el service
-- role, que ademas tiene BYPASSRLS). Con DEFINER la funcion podria reclamar
-- trabajos aunque su caller no tuviera acceso a la tabla, que es exactamente lo
-- que no se quiere.
security invoker
set search_path = public, pg_temp
as $$
BEGIN
  -- Guarda propia, misma razon que `rate_limit_hit` (036): comprobo que los
  -- REVOKE de mas abajo no alcanzan por si solos, porque Supabase otorga
  -- EXECUTE a anon/authenticated via ALTER DEFAULT PRIVILEGES. Aunque ese
  -- permiso se filtrara, la funcion se niega sola.
  IF current_user IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'claim_background_jobs: solo service_role puede llamarla (rol=%)', current_user
      USING ERRCODE = '42501';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 THEN
    p_limit := 10;
  END IF;

  -- 1) Recupera trabajos cuyo lock vencio: la instancia que los tomo murio a
  --    mitad de camino (timeout de la lambda, deploy, crash). Sin esto el
  --    trabajo quedaria `running` para siempre.
  UPDATE public.background_jobs
     SET status     = 'pending',
         locked_at  = NULL,
         updated_at = now(),
         last_error = 'lock vencido: la instancia que lo ejecutaba dejo de correr'
   WHERE status = 'running'
     AND locked_at < now() - interval '15 minutes';

  -- 2) Toma los vencidos. `SKIP LOCKED` deja pasar si otra invocacion del cron
  --    esta reclamando al mismo tiempo: nadie ejecuta el mismo trabajo dos veces
  --    y nadie espera por un lock.
  RETURN QUERY
    WITH due AS (
      SELECT id
        FROM public.background_jobs
       WHERE status = 'pending'
         AND run_after <= now()
       ORDER BY run_after
       LIMIT p_limit
         FOR UPDATE SKIP LOCKED
    )
    UPDATE public.background_jobs j
       SET status     = 'running',
           attempts   = j.attempts + 1,
           locked_at  = now(),
           updated_at = now()
      FROM due
     WHERE j.id = due.id
    RETURNING j.*;
END;
$$;

comment on function claim_background_jobs(integer) is
  'Reclama trabajos vencidos de forma atomica (SKIP LOCKED). Solo service_role.';

-- Mismo triple cierre que 036: PUBLIC, y ademas anon/authenticated, que es el
-- permiso DIRECTO que Supabase aplica por default y que un revoke sobre PUBLIC
-- no toca. La guarda de `current_user` queda como ultima linea.
revoke all on function claim_background_jobs(integer) from public;
revoke all on function claim_background_jobs(integer) from anon, authenticated;
