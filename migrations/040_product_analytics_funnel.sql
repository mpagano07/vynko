-- ========================================
-- Migration: 040_product_analytics_funnel.sql
-- Eventos de producto para medir el embudo de activacion.
--
-- Que hace:
--   1. Amplia el CHECK de analytics_events.event_type, que en 026 solo
--      aceptaba 'signup' y 'payment' y por lo tanto rechazaba con error
--      cualquier evento nuevo.
--   2. Agrega user_id, porque el embudo se mide por persona y no por
--      empresa: un usuario puede tener varias sucursales (tenants) y el
--      mismo email puede haber creado mas de una. Sin user_id el unico
--      identificador era user_email, que ademas cambia si el usuario
--      modifica su correo y le parte la continuidad de la cohorte.
--   3. Agrega app_return, que es el paso de retencion del embudo
--      (100 registros -> 80 empresa -> 65 productos -> 40 venta ->
--      25 vuelven -> 8 pagan). Ningun evento de producto distingue una
--      vuelta de una sesion mas larga.
--
-- Que NO hace:
--   - No backfillea eventos historicos. El embudo arranca vacio a partir
--     del deploy. Reconstruir el pasado desde activity_logs seria
--     aproximado: activity_logs guarda acciones por tenant y usuario, no
--     el alta real de la persona, y no distingue la primera venta de la
--     quinta. Inventar esas fechas produce un embudo que parece real y
--     no lo es, que es peor que no tener embudo.
--   - No toca la policy de lectura: sigue siendo solo admin
--     (recreada en 034 y 038 sobre profiles.is_admin).
--   - No abre INSERT a authenticated. Los inserts siguen siendo
--     service_role unicamente (034 la revoco), asi que ningun tenant
--     puede fabricar eventos, ni de otro ni propios.
--
-- ROLLBACK:
--   DROP VIEW IF EXISTS public.analytics_funnel;
--   DROP VIEW IF EXISTS public.analytics_event_totals;
--   DROP INDEX IF EXISTS public.idx_analytics_events_tenant;
--   DROP INDEX IF EXISTS public.idx_analytics_events_first_unique;
--   DROP INDEX IF EXISTS public.idx_analytics_events_user;
--   ALTER TABLE public.analytics_events DROP COLUMN IF EXISTS user_id;
--   ALTER TABLE public.analytics_events
--     DROP CONSTRAINT IF EXISTS analytics_events_event_type_check;
--   ALTER TABLE public.analytics_events
--     ADD CONSTRAINT analytics_events_event_type_check
--     CHECK (event_type IN ('signup', 'payment'));
--
-- ORDEN DE DESPLIEGUE: migracion primero, deploy despues. Si corre el
-- codigo antes de aplicar esta migracion, el insert de los eventos
-- nuevos revienta el CHECK y el evento se pierde. Por eso el helper
-- trackEvent loguea el error en vez de tragarselo.
-- ========================================

-- ---------------------------------------------------------------
-- 1. Ampliar el dominio de event_type
-- ---------------------------------------------------------------
-- 026 lo definio con dos valores porque solo esos dos se usaban. Se
-- reemplaza la constraint en vez de agregar otra: Postgres no admite
-- dos CHECK sobre la misma columna.
--
-- 'signup' y 'payment' se conservan porque hay filas historicas con
-- esos valores y el panel los cuenta.
ALTER TABLE public.analytics_events
  DROP CONSTRAINT IF EXISTS analytics_events_event_type_check;

ALTER TABLE public.analytics_events
  ADD CONSTRAINT analytics_events_event_type_check
  CHECK (event_type IN (
    -- ciclo de vida de la cuenta
    'signup',
    'company_created',
    'trial_started',
    'payment',
    'subscription_started',
    'subscription_cancelled',
    -- carga de datos inicial
    'product_created',
    'excel_import',
    -- operacion diaria
    'first_sale',
    'first_cash_open',
    'first_purchase',
    'forecast_opened',
    'document_created',
    'whatsapp_ticket',
    -- retencion
    'app_return'
  ));

-- ---------------------------------------------------------------
-- 2. user_id
-- ---------------------------------------------------------------
-- Sin REFERENCES a auth.users a proposito. La FK agregaria una
-- dependencia de orden de despliegue (auth.users debe existir antes)
-- que no aporta nada: un evento no necesita que la persona siga
-- existiendo. Si la cuenta se borra el evento queda, y eso es lo
-- correcto para analytics, porque el funnel historico no se reescribe.
--
-- Nullable a proposito tambien: las filas anteriores a esta migracion
-- no lo tienen y backfillear el user_id desde profiles por email seria
-- una conjetura (el email pudo cambiar y profiles.tenant_id es el tenant
-- principal, no necesariamente donde ocurrio el evento). Esas filas se
-- cuentan como historico y las nuevas ya llegan completas.
ALTER TABLE public.analytics_events
  ADD COLUMN IF NOT EXISTS user_id UUID;

CREATE INDEX IF NOT EXISTS idx_analytics_events_user
  ON public.analytics_events (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analytics_events_tenant
  ON public.analytics_events (tenant_id, created_at DESC)
  WHERE tenant_id IS NOT NULL;

-- ---------------------------------------------------------------
-- 3. Unicidad para los eventos "primera vez"
-- ---------------------------------------------------------------
-- first_sale, first_cash_open y first_purchase solo pueden ocurrir una
-- vez por usuario. Sin esta restriccion, dos ventas simultaneas (dos
-- cajas abiertas al mismo tiempo, o un doble submit del formulario)
-- generan dos eventos y el embudo cuenta a la misma persona dos veces.
--
-- Indice unico PARCIAL: solo aplica a los first_*, porque el resto de
-- los eventos se repite a proposito (cada venta, cada import, cada
-- documento) y un indice unico plano los rechazaria.
CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_events_first_unique
  ON public.analytics_events (user_id, event_type)
  WHERE event_type IN ('first_sale', 'first_cash_open', 'first_purchase');

-- ---------------------------------------------------------------
-- 4. Conteos sueltos por evento
-- ---------------------------------------------------------------
-- counting distinct users, no rows: app_return y excel_import se
-- repiten y para saber "cuanta gente importo un Excel" lo que importa
-- es la gente, no cuantas veces lo hizo.
--
-- Esta vista NO es el embudo. Aca cada evento se cuenta por separado,
-- sin cadena, porque varios de ellos son acciones optativas y no
-- puertas: no todos los que venden abren caja, no todos abren el
-- pronostico, no todos comparten por WhatsApp. Encadenarlos daria una
-- progresion descendente falsa.
CREATE OR REPLACE VIEW public.analytics_event_totals AS
SELECT
  event_type,
  count(DISTINCT user_id) AS users,
  count(*)                AS total,
  min(created_at)         AS first_at,
  max(created_at)         AS last_at
FROM public.analytics_events
WHERE user_id IS NOT NULL
GROUP BY event_type;

-- ---------------------------------------------------------------
-- 5. El embudo, con las unicas 6 puertas reales
-- ---------------------------------------------------------------
-- Solo estos 6 eventos son gates: para pasar al siguiente hace falta
-- haber pasado el anterior. Son los que escribio el analisis original
-- (80 crean empresa, 65 cargan productos, 40 hacen primera venta,
-- 25 vuelven, 8 pagan) mas el registro inicial.
--
-- El paso N cuenta personas que hicieron el evento N DESPUES de haber
-- hecho TODOS los anteriores, no solo los que tenga.
--
-- No se puede resolver con GREATEST(a, b, c) sobre columnas opcionales:
-- GREATEST ignora los NULL, asi que un usuario sin app_return que igual
-- tiene company_created y first_sale pasaria a contar en subscription_started
-- y el embudo mostraria un salto de 0 a N personas en el ultimo paso. Por eso
-- cada paso exige que existan todos los anteriores y que el actual no sea
-- anterior a ninguno. Los NULL no explicitados dan NULL en la comparacion y
-- el FILTER los deja fuera.
CREATE OR REPLACE VIEW public.analytics_funnel AS
WITH per_user AS (
  SELECT
    user_id,
    min(created_at) FILTER (WHERE event_type = 'signup')               AS t1,
    min(created_at) FILTER (WHERE event_type = 'company_created')      AS t2,
    min(created_at) FILTER (WHERE event_type = 'product_created')      AS t3,
    min(created_at) FILTER (WHERE event_type = 'first_sale')           AS t4,
    min(created_at) FILTER (WHERE event_type = 'app_return')           AS t5,
    min(created_at) FILTER (WHERE event_type = 'subscription_started') AS t6
  FROM public.analytics_events
  WHERE user_id IS NOT NULL
  GROUP BY user_id
),
sec AS (
  -- Compara a nivel de segundo, no de milisegundo. Ver la nota del CASE
  -- in_order: el alta de la cuenta y la creacion de la empresa caen en el
  -- mismo segundo en orden inverso, y comparar a milisegundos rompe el
  -- paso 2 para todo cliente con signup historico.
  SELECT
    user_id,
    date_trunc('second', t1) AS t1,
    date_trunc('second', t2) AS t2,
    date_trunc('second', t3) AS t3,
    date_trunc('second', t4) AS t4,
    date_trunc('second', t5) AS t5,
    date_trunc('second', t6) AS t6
  FROM per_user
),
steps(step, event_type) AS (
  VALUES
    (1, 'signup'),
    (2, 'company_created'),
    (3, 'product_created'),
    (4, 'first_sale'),
    (5, 'app_return'),
    (6, 'subscription_started')
),
resolved AS (
  SELECT
    s.step,
    s.event_type,
    u.user_id,
    CASE s.step
      WHEN 1 THEN u.t1
      WHEN 2 THEN u.t2
      WHEN 3 THEN u.t3
      WHEN 4 THEN u.t4
      WHEN 5 THEN u.t5
      WHEN 6 THEN u.t6
    END AS reached_at,
    CASE s.step
      -- Existencia de todos los anteriores mas orden creciente.
      --
      -- u ya viene truncado al segundo por el CTE sec, asi que comparar
      -- u.tN contra u.tN-1 alcanza. El alta de una cuenta y la creacion de su
      -- empresa ocurren en la misma request y sus timestamps quedan en el
      -- mismo segundo pero en orden inverso: el evento signup viejo se
      -- escribia desde el navegador, despues de que el servidor ya habia
      -- creado el tenant. Comparando a nivel de milisegundo eso se lee como
      -- "creo la empresa antes de registrarse" y el paso 2 se cae para todos
      -- los clientes con signup historico. A nivel de segundo no se pierde
      -- informacion real: nadie crea un producto y hace una venta dentro del
      -- mismo segundo.
      WHEN 1 THEN u.t1 IS NOT NULL
      WHEN 2 THEN u.t1 IS NOT NULL AND u.t2 IS NOT NULL AND u.t2 >= u.t1
      WHEN 3 THEN u.t2 IS NOT NULL AND u.t3 IS NOT NULL
                AND u.t3 >= u.t1 AND u.t3 >= u.t2
      WHEN 4 THEN u.t3 IS NOT NULL AND u.t4 IS NOT NULL
                AND u.t4 >= u.t1 AND u.t4 >= u.t2 AND u.t4 >= u.t3
      WHEN 5 THEN u.t4 IS NOT NULL AND u.t5 IS NOT NULL
                AND u.t5 >= u.t1 AND u.t5 >= u.t2
                AND u.t5 >= u.t3 AND u.t5 >= u.t4
      WHEN 6 THEN u.t5 IS NOT NULL AND u.t6 IS NOT NULL
                AND u.t6 >= u.t1 AND u.t6 >= u.t2
                AND u.t6 >= u.t3 AND u.t6 >= u.t4 AND u.t6 >= u.t5
    END AS in_order
  FROM steps s
  CROSS JOIN sec u
)
SELECT
  step,
  event_type,
  -- reached: personas que hicieron este evento en algun momento, sin
  -- importarle el orden. Es el techo del paso.
  count(*) FILTER (WHERE reached_at IS NOT NULL) AS users,
  -- ordered: de esas, las que lo hicieron despues de haber pasado
  -- todos los pasos anteriores. Es el piso, y el que usa el embudo,
  -- porque una empresa creada despues de su primera venta es ruido y
  -- contarla haria crecer un paso que deberia bajar.
  count(*) FILTER (WHERE in_order IS TRUE) AS ordered_users
FROM resolved
GROUP BY step, event_type
ORDER BY step;

-- ---------------------------------------------------------------
-- 6. Permisos
-- ---------------------------------------------------------------
-- 034 revoco INSERT/UPDATE/DELETE a anon y authenticated, pero
-- Supabase aplica ALTER DEFAULT PRIVILEGES sobre el schema public, asi
-- que se repite el REVOKE explicito. Sin esto, un authenticated podria
-- insertar eventos arbitrarios (incluido subscription_started) y
-- falsear el embudo desde el navegador.
REVOKE INSERT, UPDATE, DELETE ON public.analytics_events FROM PUBLIC, anon, authenticated;

-- Las vistas heredan los permisos de la tabla base. Se deja explicito
-- para que un GRANT accidental posterior sobre la vista no abra la
-- lectura de eventos de otros tenants a un usuario normal.
REVOKE ALL ON public.analytics_event_totals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.analytics_funnel FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.analytics_event_totals TO service_role;
GRANT SELECT ON public.analytics_funnel TO service_role;
