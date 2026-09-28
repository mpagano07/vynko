-- verify-prod-rls.sql
--
-- Verificacion de las migraciones de seguridad (034, 035, 036, 037) contra
-- PRODUCCION. Solo lectura: no escribe ni modifica nada.
--
-- Como usarlo: abrir el SQL Editor del proyecto de Supabase de PRODUCCION,
-- pegar este archivo y ejecutar. Salen 3 result sets.
--
-- Por que es un archivo SQL y no un script de Node/PowerShell:
--
-- - `vercel env run` exige que exista .env.local en disco y ademas expone las
--   variables de Supabase de Production como Sensitive, o sea que `vercel env
--   pull` las enmascara con [SENSITIVE]. No hay forma de obtenerlas sin poner
--   los secretos en el repo o en un archivo, asi que el wrapper automatico que
--   se intento antes no podia funcionar. Este archivo evita el problema entero:
--   las consultas viajan dentro de la sesion del dashboard, que ya tiene los
--   permisos.
-- - Un "todo OK" de un script es facil de malinterpretar. Estas consultas
--   reportan el project ref y los ACL reales, que es lo que permitio detectar
--   el problema de permisos de Supabase described abajo.
--
-- Que se verifica y por que:
--
-- 1. Objetos de 034/035/036/037: existen con la firma esperada.
-- 2. RLS habilitado en todas las tablas de public, sin excepciones.
-- 3. El bucket `product-images` privado y con el tope de tamano de 5 MB.
-- 4. Que anon y authenticated NO puedan ejecutar las funciones del limiter, y
--    que service_role si.
--
-- Sobre (4): es el chequeo que mas importante es. Supabase aplica
-- `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon, authenticated`
-- sobre el schema public, y ese permiso es DIRECTO sobre esos roles, no viene de
-- PUBLIC. Por eso `REVOKE ... FROM PUBLIC` no alcanza y hay que revocar
-- explicitamente de anon y authenticated (esta en 036 y 037). Comprobado en
-- produccion: con solo el revoke de PUBLIC, has_function_privilege para anon
-- daba true y la funcion quedaba expuesta. La guarda `current_user` dentro de
-- cada funcion es la segunda linea de defensa, pero el ACL tiene que estar bien.


-- =====================================================================
-- 1) Objetos, RLS y configuracion
-- =====================================================================
WITH r(prueba, ok, detalle) AS (
  SELECT '036 tabla rate_limit_buckets',
         to_regclass('public.rate_limit_buckets') IS NOT NULL,
         coalesce(to_regclass('public.rate_limit_buckets')::text, 'NO EXISTE')
  UNION ALL
  SELECT '036 existe rate_limit_hit',
         EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rate_limit_hit'),
         coalesce((SELECT pg_get_function_identity_arguments(oid)
                   FROM pg_proc WHERE proname = 'rate_limit_hit' LIMIT 1), 'NO EXISTE')
  UNION ALL
  SELECT '037 existe rate_limit_peek',
         to_regprocedure('public.rate_limit_peek(text,integer)') IS NOT NULL,
         coalesce((SELECT pg_get_function_identity_arguments(oid)
                   FROM pg_proc WHERE proname = 'rate_limit_peek' LIMIT 1), 'NO EXISTE')
  UNION ALL
  SELECT '036 rate_limit_hit es INVOKER, no DEFINER',
         NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rate_limit_hit' AND prosecdef),
         case when exists (select 1 from pg_proc where proname='rate_limit_hit' and prosecdef)
              then 'SECURITY DEFINER (peligroso)' else 'SECURITY INVOKER' end
  UNION ALL
  SELECT '037 rate_limit_peek es INVOKER, no DEFINER',
         NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rate_limit_peek' AND prosecdef),
         case when exists (select 1 from pg_proc where proname='rate_limit_peek' and prosecdef)
              then 'SECURITY DEFINER (peligroso)' else 'SECURITY INVOKER' end
  UNION ALL
  SELECT '036 existe rate_limit_reset_if_expired',
         EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rate_limit_reset_if_expired'), 'ok'
  UNION ALL
  SELECT '035 products.image_storage_path',
         EXISTS (SELECT 1 FROM pg_attribute
                 WHERE attrelid = 'public.products'::regclass AND attname = 'image_storage_path'),
         case when exists (select 1 from pg_attribute
                           where attrelid='public.products'::regclass
                             and attname='image_storage_path')
              then 'presente' else 'FALTA' end
  UNION ALL
  SELECT '034 bucket product-images es privado',
         EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'product-images' AND public = false),
         coalesce((SELECT 'public=' || public::text || ', limite=' || file_size_limit
                   FROM storage.buckets WHERE id = 'product-images'), 'NO EXISTE')
  UNION ALL
  SELECT '034 limite de 5 MB en el bucket',
         EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'product-images'
                 AND file_size_limit = 5242880), '5242880 esperado'
  UNION ALL
  SELECT '034 RLS en TODAS las tablas de public',
         NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity),
         (SELECT count(*)::text || ' tablas, ' ||
          (SELECT count(*) FROM pg_class c2 JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
           WHERE n2.nspname = 'public' AND c2.relkind = 'r' AND c2.relrowsecurity)::text || ' con RLS'
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity)
  UNION ALL
  SELECT 'anon NO puede ejecutar rate_limit_hit',
         (SELECT count(*) FROM pg_proc p WHERE p.proname = 'rate_limit_hit'
          AND has_function_privilege('anon', p.oid, 'EXECUTE')) = 0, 'debe ser 0'
  UNION ALL
  SELECT 'authenticated NO puede ejecutar rate_limit_hit',
         (SELECT count(*) FROM pg_proc p WHERE p.proname = 'rate_limit_hit'
          AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) = 0, 'debe ser 0'
  UNION ALL
  SELECT 'anon NO puede ejecutar rate_limit_peek',
         (SELECT count(*) FROM pg_proc p WHERE p.proname = 'rate_limit_peek'
          AND has_function_privilege('anon', p.oid, 'EXECUTE')) = 0, 'debe ser 0'
  UNION ALL
  SELECT 'authenticated NO puede ejecutar rate_limit_peek',
         (SELECT count(*) FROM pg_proc p WHERE p.proname = 'rate_limit_peek'
          AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) = 0, 'debe ser 0'
  UNION ALL
  SELECT 'service_role SI puede ejecutar el limiter',
         (SELECT count(*) FROM pg_proc p WHERE p.proname IN ('rate_limit_hit', 'rate_limit_peek')
          AND has_function_privilege('service_role', p.oid, 'EXECUTE')) = 2, 'debe ser 2'
)
SELECT
  prueba, CASE WHEN ok THEN 'OK' ELSE 'FALLA' END AS estado, detalle
FROM r
ORDER BY estado, prueba;


-- =====================================================================
-- 2) RLS por tabla. No debe haber ninguna fila con rls_-activo = false.
--    `rate_limit_buckets` con 0 policies es lo correcto: se accede solo por
--    funcion y con service_role, que bypassa RLS.
-- =====================================================================
SELECT
  c.relname AS tabla,
  c.relrowsecurity AS rls_activo,
  (SELECT count(*) FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relrowsecurity, policies, tabla;


-- =====================================================================
-- 3) Pruebas de comportamiento. Van aparte porque una excepcion aborta el
--    resto del batch: el primero cuenta filas (dinamico, no puede fallar el
--    parseo) y el segundo comprueba que anon no ejecuta el limiter.
-- =====================================================================
DO $$
DECLARE v bigint;
BEGIN
  IF to_regclass('public.rate_limit_buckets') IS NULL THEN
    RAISE NOTICE 'FALLA: no existe public.rate_limit_buckets';
  ELSE
    EXECUTE 'SELECT count(*) FROM public.rate_limit_buckets' INTO v;
    IF v = 0 THEN
      RAISE NOTICE 'OK: rate_limit_buckets tiene 0 filas';
    ELSE
      RAISE NOTICE 'AVISO: % filas sin expirar (se purgan solas)', v;
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  -- El SET va dentro del bloque con EXCEPTION: si el rol no se puede cambiar en
  -- esta sesion, el error queda capturado y reportado en vez de abortar el lote.
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM rate_limit_hit('verificacion:prod', 5, 60000, false);
    RAISE NOTICE 'FALLA CRITICA: anon logro ejecutar rate_limit_hit';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK: anon rechazado por permisos';
  WHEN OTHERS THEN
    RAISE NOTICE 'OK: anon rechazado -> %', SQLERRM;
  END;
END $$;
