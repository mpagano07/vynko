-- DIAGNÓSTICO (seguro): recepción de transferencias — incidente 2026-11-11
-- (deploy 068020f; resuelto: faltaba el unique de categories). Los IDs de
-- transferencia/tenant de las secciones B y C son de ese incidente: cambialos
-- si lo reutilizás para diagnosticar otro caso. Ejecutar contra la base
-- afectada. Tres secciones:
--   A) un solo resultado con el estado completo del esquema (fácil de pegar);
--   B) los ítems de la transferencia afectada con su contexto de categoría;
--   C) PROBE con ROLLBACK: ejecuta la RPC real sin mutar nada. Si la función
--      falla, acá aparece el error EXACTO de Postgres.

-- ============ A) Estado del esquema (un solo resultado) ============
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='product_stock'
            AND column_name='category_id')                          AS columna_ok,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE p.proname='receive_transfer')                              AS total_receive_todos_esquemas,
  (SELECT coalesce(string_agg(n.nspname || '(' ||
                    pg_get_function_identity_arguments(p.oid) || ')', ' | '), '')
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE p.proname='receive_transfer')                              AS firmas_receive,
  (SELECT coalesce(bool_or(position('vynko_norm_name' in p.prosrc) > 0), false)
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='receive_transfer')       AS cuerpo_es_071,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='vynko_norm_name')        AS existe_norm_name,
  (SELECT count(*) FROM information_schema.table_constraints
   WHERE table_schema='public' AND table_name='categories'
     AND constraint_type='UNIQUE')                                  AS unique_categories,
  (SELECT count(*) FROM information_schema.table_constraints
   WHERE table_schema='public' AND table_name='product_stock'
     AND constraint_type='UNIQUE')                                  AS unique_product_stock,
  (SELECT count(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name='categories'
     AND is_nullable='NO' AND column_default IS NULL)               AS categories_notnull_sin_default,
  (SELECT string_agg(column_name, ', ' ORDER BY ordinal_position)
   FROM information_schema.columns
   WHERE table_schema='public' AND table_name='categories')         AS columnas_categories,
  (SELECT has_function_privilege('service_role',
          'public.receive_transfer(uuid, uuid)', 'EXECUTE'))        AS service_role_puede_ejecutar,
  (SELECT has_table_privilege('service_role', 'public.categories', 'INSERT'))
                                                                   AS service_role_inserta_categories,
  (SELECT count(*) FROM pg_trigger t
   JOIN pg_class c ON c.oid=t.tgrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE NOT t.tgisinternal AND n.nspname='public'
     AND c.relname IN ('categories','product_stock','stock_history','stock_transfers'))
                                                                   AS triggers_en_tablas,
  (SELECT count(*) FROM pg_stat_activity
   WHERE pid <> pg_backend_pid() AND state <> 'idle'
     AND query ILIKE '%stock_transfers%')                          AS sesiones_activas_transfer,
  (SELECT count(*) FROM pg_stat_activity
   WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock')     AS sesiones_esperando_lock;

-- ============ B) Ítems de la transferencia + contexto de categoría ============
SELECT it.product_id, it.quantity,
       ps.category_id AS categoria_en_origen,
       p.category_id  AS categoria_global_del_producto
FROM stock_transfer_items it
LEFT JOIN product_stock ps
       ON ps.product_id = it.product_id
      AND ps.tenant_id = '04c71cb4-0454-4bcc-8e5c-89cc6e779a69'
LEFT JOIN products p ON p.id = it.product_id
WHERE it.transfer_id = 'e70299e1-0d8e-459d-8e14-50333a11c2e8';

-- ============ C) PROBE seguro: corre la RPC y revierte todo ============
-- Ejecuta la misma RPC que llama la ruta, como el superusuario, dentro de una
-- transacción que SIEMPRE se revierte: no muta nada.
--  - Si falla: el mensaje de error que aparece ES la causa del 500.
--  - Si devuelve ok=true: la función está bien y el problema está entre la app
--    y la base (permisos de service_role, caché de PostgREST o entorno).
BEGIN;
SELECT * FROM public.receive_transfer(
  'e70299e1-0d8e-459d-8e14-50333a11c2e8',
  (SELECT created_by FROM stock_transfers
    WHERE id = 'e70299e1-0d8e-459d-8e14-50333a11c2e8')
);
ROLLBACK;

-- Variante del probe con el ROL que usa la app (service_role), para ver
-- errores de permisos que como superusuario no aparecen:
BEGIN;
SET LOCAL ROLE service_role;
SELECT * FROM public.receive_transfer(
  'e70299e1-0d8e-459d-8e14-50333a11c2e8',
  (SELECT created_by FROM stock_transfers
    WHERE id = 'e70299e1-0d8e-459d-8e14-50333a11c2e8')
);
ROLLBACK;
