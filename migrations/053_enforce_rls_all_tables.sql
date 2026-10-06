-- ============================================================
-- 053: backstop de RLS en TODAS las tablas de public
-- ============================================================
--
-- Auditoria Fase 4.2 — "RLS sobre tablas sin policy".
--
-- Conclusion de la revision:
--
--   - Las 38 tablas creadas por las migraciones 001..052 tienen
--     `ENABLE ROW LEVEL SECURITY` en su migracion, y la 034 ademas itera
--     todas las tablas de public y habilita RLS en las que no lo tengan. O
--     sea: no queda ninguna tabla publica sin RLS en el schema actual.
--   - "Sin policy" no significa "sin RLS". Hay dos tablas sin policies y el
--     motivo es deliberado y correcto:
--       * `rate_limit_buckets` (036): RLS on + deny-all. Se escribe SOLO desde
--         las funciones `rate_limit_hit`/`rate_limit_peek`, que corren como
--         INVOKER y estan revocadas de anon/authenticated.
--       * `sale_idempotency_keys` (048): RLS on + deny-all (`REVOKE ... FROM
--         anon, authenticated`). Se escribe dentro de la transaccion de venta
--         por `create_sale_atomic` (SECURITY DEFINER) con la service role.
--     Si una de esas dos tablas recibiera policies de pronto, seria una
--     regression: el acceso tiene que pasar por RPC/service role, nunca por
--     PostgREST con la anon key.
--
-- Esta migracion es el SAFETY NET: garantiza que en el schema PUBLICO no haya
-- tablas sin RLS aunque a futuro alguien cree una tabla a mano (o en una
-- migracion que se olvide de habilitarlo). `enable_rls` a posteriori sobre una
-- tabla existente es seguro: si no hay policies, pasa a deny-all exactamente
-- como las dos excepciones documentadas arriba.
--
-- Es idempotente: correrla sobre una base donde todo ya tiene RLS no cambia
-- nada mas que un NOTICE.

DO $$
DECLARE
  t          regclass;
  toggled    int := 0;
  sin_policy record;
BEGIN
  FOR t IN
    SELECT c.oid::regclass
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      -- Las particiones heredan la flag de su tabla padre; tocarlas aparte no aporta.
      AND NOT c.relispartition
      AND NOT c.relrowsecurity
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    RAISE NOTICE '053: RLS habilitado retroactivamente en %', t;
    toggled := toggled + 1;
  END LOOP;

  RAISE NOTICE '053: % tabla(s) sin RLS pasaron a enabled (0 = ya estaba todo OK)', toggled;

  -- Inventario de tablas SIN policies sobre las que conviene una revision
  -- manual en cada entorno: por defecto deben ser las dos excepciones
  -- documentadas (rate_limit_buckets, sale_idempotency_keys). Si aparecen
  -- otras con RLS enabled y 0 policies, revisar que el acceso sea por RPC o
  -- service role y no por PostgREST.
  RAISE NOTICE '053: tablas public con RLS y 0 policies:';
  FOR sin_policy IN
    SELECT c.relname, (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS n
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relispartition AND c.relrowsecurity
    ORDER BY c.relname
  LOOP
    IF sin_policy.n = 0 THEN
      RAISE NOTICE '053:   - % (0 policies, acceso por RPC/service role)', sin_policy.relname;
    END IF;
  END LOOP;
END $$;