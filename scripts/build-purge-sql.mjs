#!/usr/bin/env node
// Imprime el SQL del purge de usuarios de prueba, para pegar en el SQL Editor
// de Supabase. Es el mismo criterio que scripts/purge-test-user.mjs, pero via
// SQL: asi se puede correr en produccion sin traer la service role al shell,
// que es justamente lo que en Vercel esta marcado como Sensitive.
//
//   node scripts/build-purge-sql.mjs matiasmagis420@gmail.com vynko.dev@gmail.com
//   node scripts/build-purge-sql.mjs a@b.com --include-tenant-data
//   node scripts/build-purge-sql.mjs a@b.com --include-tenant-data --sql-out purgar.sql

const args = process.argv.slice(2);
const INCLUDE_TENANTS = args.includes('--include-tenant-data');
const sqlOutIndex = args.indexOf('--sql-out');
const sqlOut = sqlOutIndex >= 0 ? args[sqlOutIndex + 1] : null;
const emails = [...new Set(args.filter((a) => !a.startsWith('--') && a !== sqlOut).map((e) => e.trim().toLowerCase()).filter(Boolean))];

if (emails.length === 0) {
  console.error('Uso: build-purge-sql.mjs <email> [email...] [--include-tenant-data] [--sql-out archivo.sql]');
  process.exit(2);
}

const emailList = emails.map((e) => `'${e.replace(/'/g, "''")}'`).join(', ');

const tenantClause = INCLUDE_TENANTS
  ? `-- Datos del tenant: SE BORRAN. Esto incluye el negocio entero de esos
-- tenants (productos, ventas, stock, clientes, documentos). Es lo que pide
-- --include-tenant-data; sin el flag, abajo solo se borran las membresias y
-- el usuario queda fuera del tenant.
`
  : `  -- Datos del tenant: NO se borran. Solo se van las membresias del usuario.
  -- Para borrar tambien el negocio de sus tenants, generá el SQL con
  -- --include-tenant-data.
`;

const sql = `-- ===========================================================================
-- Purge de usuarios de prueba
-- ===========================================================================
-- Generado por scripts/build-purge-sql.mjs. Pegar en el SQL Editor de Supabase
-- del proyecto de PRODUCTION.
--
-- Objetivos (${emails.length}):
${emails.map((e) => `--   - ${e}`).join('\n')}
--
${tenantClause}--
-- COMO USARLO
--   1. Correr el BLOQUE 1 entero. Es solo lectura. LEER la salida: confirma que
--      los tenants que van a caer son los de prueba y no un negocio real, y
--      mira el 1e para ver cuantos documentos se borran por ser de estos
--      usuarios.
--   2. Correr el BLOQUE 2. Asi como esta, NO borra nada: se detiene pidiendo
--      confirmacion. Si estas seguro, al principio del bloque va:
--        SET vynko.purge_confirmado = 'si';
--      tiene que ir en la MISMA transaccion, o sea en el mismo "Run".
--   3. Correr el BLOQUE 3 para confirmar que no quedo nada (todo en 0).
--
-- El bloque 2 va en transaccion: si algo falla, no queda a medias, se revierte
-- entero.
--
-- El SQL Editor corre como postgres, asi que ve todas las filas y no le
-- importan las policies de RLS. Eso es lo que permite limpiar datos que RLS
-- todavia protege.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOQUE 1: diagnostico. SOLO LECTURA, no cambia nada. Correr esto primero.
-- ---------------------------------------------------------------------------

-- 1a. Que usuarios de auth existen con esos emails.
SELECT
  id                                   AS auth_user_id,
  email,
  created_at
FROM auth.users
WHERE lower(email) IN (${emailList})
ORDER BY email;


-- 1b. Perfiles y membresias. Un perfil puede existir sin usuario de auth
--     (alta a medias): se listan igual para saber que se va a borrar.
WITH objetivos AS (
  SELECT id FROM auth.users WHERE lower(email) IN (${emailList})
)
SELECT
  p.id                    AS profile_id,
  p.email,
  p.role,
  p.tenant_id             AS tenant_directo,
  tu.tenant_id            AS tenant_por_membresia,
  tu.role                 AS rol_en_el_tenant,
  t.name                  AS nombre_del_tenant
FROM public.profiles p
LEFT JOIN public.tenant_users tu ON tu.user_id = p.id
LEFT JOIN public.tenants     t  ON t.id = COALESCE(tu.tenant_id, p.tenant_id)
WHERE p.id IN (SELECT id FROM objetivos)
   OR lower(p.email) IN (${emailList})
ORDER BY t.name;


-- 1c. Tamano de lo que cuelga de esos tenants${INCLUDE_TENANTS ? ' (SE VA A BORRAR)' : ' (NO se borra en este SQL)'}.
WITH tenants_objetivo AS (
  SELECT tu.tenant_id
  FROM public.tenant_users tu
  JOIN auth.users u ON u.id = tu.user_id
  WHERE lower(u.email) IN (${emailList})
)
SELECT 'products'      AS tabla, count(*) AS filas FROM public.products      p WHERE p.id IN (SELECT product_id FROM public.product_stock WHERE tenant_id IN (SELECT tenant_id FROM tenants_objetivo))
UNION ALL SELECT 'product_stock',    count(*) FROM public.product_stock    WHERE tenant_id IN (SELECT tenant_id FROM tenants_objetivo)
UNION ALL SELECT 'categories',       count(*) FROM public.categories       WHERE tenant_id IN (SELECT tenant_id FROM tenants_objetivo)
UNION ALL SELECT 'customers',        count(*) FROM public.customers        WHERE tenant_id IN (SELECT tenant_id FROM tenants_objetivo)
UNION ALL SELECT 'suppliers',        count(*) FROM public.suppliers        WHERE tenant_id IN (SELECT tenant_id FROM tenants_objetivo)
UNION ALL SELECT 'providers',        count(*) FROM public.providers        WHERE tenant_id IN (SELECT tenant_id FROM tenants_objetivo)
UNION ALL SELECT 'sales',            count(*) FROM public.sales            WHERE tenant_id IN (SELECT tenant_id FROM tenants_objetivo)
UNION ALL SELECT 'sale_items',       count(*) FROM public.sale_items       WHERE sale_id IN (SELECT id FROM public.sales WHERE tenant_id IN (SELECT tenant_id FROM tenants_objetivo))
UNION ALL SELECT 'stock_movements',  count(*) FROM public.stock_movements  WHERE tenant_id IN (SELECT tenant_id FROM tenants_objetivo)
UNION ALL SELECT 'stock_history',    count(*) FROM public.stock_history    WHERE tenant_id IN (SELECT tenant_id FROM tenants_objetivo)
UNION ALL SELECT 'stock_transfers',  count(*) FROM public.stock_transfers  WHERE from_tenant_id IN (SELECT tenant_id FROM tenants_objetivo) OR to_tenant_id IN (SELECT tenant_id FROM tenants_objetivo)
UNION ALL SELECT 'purchase_orders',  count(*) FROM public.purchase_orders  WHERE tenant_id IN (SELECT tenant_id FROM tenants_objetivo)
UNION ALL SELECT 'commercial_documents', count(*) FROM public.commercial_documents WHERE tenant_id IN (SELECT tenant_id FROM tenants_objetivo)
UNION ALL SELECT 'electronic_invoices',  count(*) FROM public.electronic_invoices  WHERE tenant_id IN (SELECT tenant_id FROM tenants_objetivo)
UNION ALL SELECT 'cash_movements',   count(*) FROM public.cash_movements   WHERE tenant_id IN (SELECT tenant_id FROM tenants_objetivo)
UNION ALL SELECT 'cash_register_sessions', count(*) FROM public.cash_register_sessions WHERE tenant_id IN (SELECT tenant_id FROM tenants_objetivo)
UNION ALL SELECT 'sale_payments',    count(*) FROM public.sale_payments    WHERE tenant_id IN (SELECT tenant_id FROM tenants_objetivo)
UNION ALL SELECT 'activity_logs',    count(*) FROM public.activity_logs    WHERE tenant_id IN (SELECT tenant_id FROM tenants_objetivo)
UNION ALL SELECT 'notifications',    count(*) FROM public.notifications    WHERE tenant_id IN (SELECT tenant_id FROM tenants_objetivo)
UNION ALL SELECT 'invitations',      count(*) FROM public.invitations      WHERE tenant_id IN (SELECT tenant_id FROM tenants_objetivo)
UNION ALL SELECT 'analytics_events', count(*) FROM public.analytics_events WHERE tenant_id IN (SELECT tenant_id FROM tenants_objetivo)
UNION ALL SELECT 'tenant_users',     count(*) FROM public.tenant_users     WHERE tenant_id IN (SELECT tenant_id FROM tenants_objetivo)
ORDER BY filas DESC;


-- 1d. Eventos de analytics de esos usuarios. El pedido original era limpiar
--     tambien esto, asi que se lista siempre, haya o no flag de tenants.
SELECT
  event_type,
  user_email,
  count(*) AS eventos,
  min(created_at) AS primero,
  max(created_at) AS ultimo
FROM public.analytics_events
WHERE lower(user_email) IN (${emailList})
GROUP BY event_type, user_email
ORDER BY eventos DESC;


-- 1e. Documentos que se van a BORRAR porque su autor es uno de estos usuarios.
--     Son las 8 FKs NOT NULL hacia auth.users: no hay forma de conservar el
--     documento y borrar al usuario. Sin --include-tenant-data, ademas, estos
--     documentos son de un tenant que SOBREVIVE. Si aqui sale algo que no es
--     basura de prueba, frena y revisa.
WITH objetivos AS (
  SELECT id FROM auth.users WHERE lower(email) IN (${emailList})
)
SELECT 'commercial_documents.created_by' AS columna, count(*) AS filas FROM public.commercial_documents WHERE created_by IN (SELECT id FROM objetivos)
UNION ALL SELECT 'electronic_invoices.created_by',  count(*) FROM public.electronic_invoices  WHERE created_by IN (SELECT id FROM objetivos)
UNION ALL SELECT 'stock_transfers.created_by',       count(*) FROM public.stock_transfers      WHERE created_by IN (SELECT id FROM objetivos)
UNION ALL SELECT 'cash_movements.created_by',        count(*) FROM public.cash_movements       WHERE created_by IN (SELECT id FROM objetivos)
UNION ALL SELECT 'stock_history.created_by',         count(*) FROM public.stock_history        WHERE created_by IN (SELECT id FROM objetivos)
UNION ALL SELECT 'sales.created_by',                 count(*) FROM public.sales                WHERE created_by IN (SELECT id FROM objetivos)
UNION ALL SELECT 'purchase_orders.created_by',       count(*) FROM public.purchase_orders      WHERE created_by IN (SELECT id FROM objetivos)
UNION ALL SELECT 'cash_register_sessions.opened_by', count(*) FROM public.cash_register_sessions WHERE opened_by IN (SELECT id FROM objetivos)
UNION ALL SELECT '~ closed_by (se nullean, no se borra)', count(*) FROM public.cash_register_sessions WHERE closed_by IN (SELECT id FROM objetivos) AND opened_by NOT IN (SELECT id FROM objetivos)
UNION ALL SELECT '~ stock_movements.created_by (se nullean)', count(*) FROM public.stock_movements WHERE created_by IN (SELECT id FROM objetivos)
ORDER BY filas DESC;


-- 1f. Aclaracion importante: en customers, suppliers y providers el email es
--     un CONTACTO de negocio, no el del usuario. Este SQL no los toca por
--     email, solo por tenant_id${INCLUDE_TENANTS ? ' (o sea, si se borran los tenants)' : ' (que NO se borran)'}.
SELECT 'customers' AS tabla, c.email, count(*) AS filas
FROM public.customers c
WHERE lower(c.email) IN (${emailList})
GROUP BY c.email
UNION ALL
SELECT 'suppliers', s.email, count(*) FROM public.suppliers s WHERE lower(s.email) IN (${emailList}) GROUP BY s.email
UNION ALL
SELECT 'providers', pr.email, count(*) FROM public.providers pr WHERE lower(pr.email) IN (${emailList}) GROUP BY pr.email
ORDER BY tabla, email;

${
  INCLUDE_TENANTS
    ? `

-- ---------------------------------------------------------------------------
-- BLOQUE 2: BORRADO. Va en transaccion: si algo falla, se revierte entero.
-- ---------------------------------------------------------------------------
--
-- El orden no es arbitrario. Las 25 FKs hacia tenants y las 9 hacia products ya
-- tienen ON DELETE CASCADE (o SET NULL), asi que esos padres se borran solos.
-- Las que SI bloquean son 10 FKs hacia auth.users, todas sin cascada:
--
--   stock_history.created_by          NOT NULL
--   sales.created_by                  NOT NULL
--   purchase_orders.created_by        NOT NULL
--   electronic_invoices.created_by    NOT NULL
--   commercial_documents.created_by   NOT NULL
--   stock_transfers.created_by        NOT NULL
--   cash_movements.created_by         NOT NULL
--   cash_register_sessions.opened_by  NOT NULL
--   cash_register_sessions.closed_by  nullable
--   stock_movements.created_by        nullable
--
-- Por eso se desarman esas filas antes de tocar auth.users.

BEGIN;

-- CONFIRMACION. Recien leido el bloque 1, segui los pasos de arriba y cambio
-- este FALSE por TRUE. Con FALSE el script se detiene aca y no borra nada, asi
-- que pegar el archivo entero por las dudas no destruye datos.
DO $$
BEGIN
  IF current_setting('vynko.purge_confirmado', true) IS DISTINCT FROM 'si' THEN
    RAISE EXCEPTION
      'Purge cancelado: falta la confirmacion. Correr el bloque 1, y despues SET vynko.purge_confirmado = ''si''; en la misma transaccion.';
  END IF;
END $$;

CREATE TEMP TABLE purge_users ON COMMIT DROP AS
  SELECT id FROM auth.users WHERE lower(email) IN (${emailList});

-- Los tenants del purge salen de las membresias. Si el usuario tiene un
-- tenant_id directo en profiles pero ninguna fila en tenant_users (un alta a
-- medias), tambien entra: si no, ese negocio quedaria huerfano.
CREATE TEMP TABLE purge_tenants ON COMMIT DROP AS
SELECT DISTINCT t FROM (
  SELECT tu.tenant_id AS t
  FROM public.tenant_users tu
  WHERE tu.user_id IN (SELECT id FROM purge_users)
  UNION
  SELECT p.tenant_id
  FROM public.profiles p
  WHERE p.id IN (SELECT id FROM purge_users) AND p.tenant_id IS NOT NULL
) s;

-- Guarda de seguridad: si alguno de estos tenants tiene un miembro que NO es un
-- usuario del purge, no es un tenant de prueba. El script aborta en vez de
-- llevarse por delante el negocio de otra persona.
DO $$
DECLARE
  riesgos text;
BEGIN
  SELECT string_agg(DISTINCT tu.tenant_id::text, ', ')
  INTO riesgos
  FROM public.tenant_users tu
  WHERE tu.tenant_id IN (SELECT tenant_id FROM purge_tenants)
    AND tu.user_id NOT IN (SELECT id FROM purge_users);

  IF riesgos IS NOT NULL THEN
    RAISE EXCEPTION
      'ABORTO: los tenants % tienen miembros ajenos a los usuarios del purge. No es un tenant de prueba.', riesgos;
  END IF;
END $$;


-- 2a. Las 2 columnas que admiten NULL se nullean en vez de borrar el documento
--     entero: perder una venta o un movimiento de stock solo porque su autor se
--     va no corresponde. El bloque 1 ya listo cuantas filas son.
UPDATE public.cash_register_sessions SET closed_by = NULL WHERE closed_by IN (SELECT id FROM purge_users) AND opened_by NOT IN (SELECT id FROM purge_users);
UPDATE public.stock_movements          SET created_by = NULL WHERE created_by IN (SELECT id FROM purge_users);

-- 2b. Las 8 FKs NOT NULL no tienen otra salida: o se borra el documento, o el
--     usuario no se puede borrar. Se borran.
DELETE FROM public.commercial_documents  WHERE created_by IN (SELECT id FROM purge_users);
DELETE FROM public.electronic_invoices   WHERE created_by IN (SELECT id FROM purge_users);
DELETE FROM public.stock_transfers       WHERE created_by IN (SELECT id FROM purge_users);
DELETE FROM public.cash_movements        WHERE created_by IN (SELECT id FROM purge_users);
DELETE FROM public.cash_register_sessions WHERE opened_by IN (SELECT id FROM purge_users);
DELETE FROM public.stock_history         WHERE created_by IN (SELECT id FROM purge_users);
DELETE FROM public.sales                 WHERE created_by IN (SELECT id FROM purge_users);
DELETE FROM public.purchase_orders       WHERE created_by IN (SELECT id FROM purge_users);

-- 2c. Los tenants. Las 25 FKs hacia tenants tienen ON DELETE CASCADE, asi que
--     todo el negocio se va en cascada sin escribir un DELETE por tabla.
--
--     analytics_events NO se va sola: su FK es ON DELETE SET NULL, o sea que los
--     eventos sobreviven con tenant_id en NULL. Por eso se borran explicitamente
--     por tenant_id ANTES de borrar el tenant.
DELETE FROM public.analytics_events WHERE tenant_id IN (SELECT tenant_id FROM purge_tenants);

DELETE FROM public.tenants WHERE id IN (SELECT tenant_id FROM purge_tenants);


-- 2d. Datos del usuario, independientes del tenant.
DELETE FROM public.analytics_events     WHERE lower(user_email) IN (${emailList});
DELETE FROM public.password_reset_tokens WHERE lower(email) IN (${emailList});
DELETE FROM public.invitations          WHERE lower(email) IN (${emailList});
DELETE FROM public.activity_logs        WHERE user_id IN (SELECT id FROM purge_users);
DELETE FROM public.notifications        WHERE user_id IN (SELECT id FROM purge_users);
DELETE FROM public.tenant_users         WHERE user_id IN (SELECT id FROM purge_users);

-- Perfil por id o por email: puede haber un profile huerfano con email pero sin
-- usuario de auth, o al reves.
DELETE FROM public.profiles
WHERE id IN (SELECT id FROM purge_users)
   OR lower(email) IN (${emailList});


-- 2e. El usuario de auth. va al final: mientras exista, las FKs created_by de
--     las tablas de arriba lo sostienen.
DELETE FROM auth.users WHERE id IN (SELECT id FROM purge_users);

COMMIT;
`
    : `

-- ---------------------------------------------------------------------------
-- BLOQUE 2: BORRADO. Solo el usuario y sus datos personales. Los tenants
-- quedan intactos (se van las membresias nomas).
-- ---------------------------------------------------------------------------

BEGIN;

-- CONFIRMACION. Ver la nota del BLOQUE 2 con tenants: sin esto no borra nada.
DO $$
BEGIN
  IF current_setting('vynko.purge_confirmado', true) IS DISTINCT FROM 'si' THEN
    RAISE EXCEPTION
      'Purge cancelado: falta la confirmacion.';
  END IF;
END $$;

CREATE TEMP TABLE purge_users ON COMMIT DROP AS
  SELECT id FROM auth.users WHERE lower(email) IN (${emailList});

-- 2a. created_by / opened_by / closed_by apuntan a auth.users SIN cascada. Si
--     queda alguna fila de un tenant que sobrevive, el DELETE del usuario falla.
--     Las 2 que admiten NULL se nullean para no perder el documento; las 8 NOT
--     NULL se borran, que es la unica forma de poder borrar el usuario.
--
--     OJO: aca los tenants SOBREVIVEN, asi que estas filas son documentos reales
--     de un negocio que sigue en pie. El bloque 1.3 dice cuantos son. Revisalo
--     antes de correr: si son many, el camino correcto suele ser primero
--     --include-tenant-data.
UPDATE public.cash_register_sessions SET closed_by = NULL WHERE closed_by IN (SELECT id FROM purge_users) AND opened_by NOT IN (SELECT id FROM purge_users);
UPDATE public.stock_movements          SET created_by = NULL WHERE created_by IN (SELECT id FROM purge_users);

DELETE FROM public.commercial_documents  WHERE created_by IN (SELECT id FROM purge_users);
DELETE FROM public.electronic_invoices   WHERE created_by IN (SELECT id FROM purge_users);
DELETE FROM public.stock_transfers       WHERE created_by IN (SELECT id FROM purge_users);
DELETE FROM public.cash_movements        WHERE created_by IN (SELECT id FROM purge_users);
DELETE FROM public.cash_register_sessions WHERE opened_by IN (SELECT id FROM purge_users);
DELETE FROM public.stock_history         WHERE created_by IN (SELECT id FROM purge_users);
DELETE FROM public.sales                 WHERE created_by IN (SELECT id FROM purge_users);
DELETE FROM public.purchase_orders       WHERE created_by IN (SELECT id FROM purge_users);

-- 2b. Datos personales.
DELETE FROM public.analytics_events      WHERE lower(user_email) IN (${emailList});
DELETE FROM public.password_reset_tokens WHERE lower(email) IN (${emailList});
DELETE FROM public.invitations           WHERE lower(email) IN (${emailList});
DELETE FROM public.activity_logs         WHERE user_id IN (SELECT id FROM purge_users);
DELETE FROM public.notifications         WHERE user_id IN (SELECT id FROM purge_users);
DELETE FROM public.tenant_users          WHERE user_id IN (SELECT id FROM purge_users);

DELETE FROM public.profiles
WHERE id IN (SELECT id FROM purge_users)
   OR lower(email) IN (${emailList});

-- 2c. El usuario de auth, al final.
DELETE FROM auth.users WHERE id IN (SELECT id FROM purge_users);

COMMIT;
`
}

-- ---------------------------------------------------------------------------
-- BLOQUE 3: verificacion. Correr despues del bloque 2. Todas las filas tienen
-- que dar 0.
-- ---------------------------------------------------------------------------

SELECT 'auth.users' AS donde, count(*) AS restantes
FROM auth.users WHERE lower(email) IN (${emailList})
UNION ALL SELECT 'profiles',       count(*) FROM public.profiles        WHERE id IN (SELECT id FROM auth.users WHERE lower(email) IN (${emailList})) OR lower(email) IN (${emailList})
UNION ALL SELECT 'analytics_events', count(*) FROM public.analytics_events WHERE lower(user_email) IN (${emailList})
UNION ALL SELECT 'invitations',      count(*) FROM public.invitations      WHERE lower(email) IN (${emailList})
UNION ALL SELECT 'password_reset_tokens', count(*) FROM public.password_reset_tokens WHERE lower(email) IN (${emailList})
ORDER BY restantes DESC;


-- Si el purge incluyo tenants, esto deberia dar 0 filas. Si aparecen, son
-- tenants que NO se borraron (no eran del purge) y eso es lo esperado.
SELECT t.id, t.name, t.slug
FROM public.tenants t
WHERE t.id IN (
  SELECT DISTINCT tu.tenant_id
  FROM public.tenant_users tu
  LEFT JOIN auth.users u ON u.id = tu.user_id
  WHERE u.id IS NULL
)
ORDER BY t.name;
`;

if (sqlOut) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(sqlOut, sql, 'utf8');
  console.log(`SQL escrito en ${sqlOut}`);
  console.log(`Emails: ${emails.join(', ')}`);
  console.log(`Tenants: ${INCLUDE_TENANTS ? 'SI se borran con todo su negocio' : 'NO se borran, solo las membresias'}`);
  console.log('');
  console.log('Revisalo antes de pegarlo en el SQL Editor de produccion: el bloque 1 es de solo lectura.');
} else {
  process.stdout.write(sql);
}
