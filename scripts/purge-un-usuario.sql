-- =============================================================================
-- PURGE DE UN USUARIO DE PRUEBA
-- Para pegar en el SQL Editor de Supabase (Dashboard > SQL Editor > New query)
-- =============================================================================
--
-- COMO SE USA
--   1. Edita SOLO la linea marcada abajo y poné el mail que querés borrar.
--   2. Seleccioná TODO este archivo y dale "Run" (o "Ejecutar").
--   3. La primera vez va a terminar con un error de "Purge CANCELADO". eso es
--      lo esperado, y el error te dice cuantas filas se borrarían. NO se borró
--      nada.
--   4. Si esos numeros te sirven, descomentá la linea del BLOQUE 2 que dice
--      SET vynko.purge_confirmado = 'si' y volvé a darle "Run" al archivo
--      ENTERO. Ahí sí se borra.
--   5. El BLOQUE 3 tiene que dar todo en 0.
--
-- POR QUE ES SEGURO
--   - Sin esa linea descomentada el script se frena solo. No se puede borrar
--     nada sin confirmar.
--   - El BLOQUE 2 va en una transaccion: si algo falla, no queda a medias.
--   - Si el usuario es dueno de un tenant con OTROS miembros adentro, el script
--     aborta: eso no es un usuario de prueba.
--   - Las tablas de clientes y proveedores NO se tocan por mail. Ahi el mail
--     es un contacto de negocio, no el del usuario. Solo se borran si el
--     usuario era de esos tenants y pusiste borrar_tenants en true.
--
-- QUE BORRA
--   - El usuario de Supabase (auth.users) y su perfil.
--   - Sus invitaciones, tokens de reset, logs de actividad y notificaciones.
--   - Sus eventos de analytics.
--   - Las ventas, compras, facturas, documentos, caja, transferencias e
--     historial de stock que EL creo, si las columnas no permiten dejarlo sin
--     autor. El BLOQUE 1 dice cuantos son.
--   - Con borrar_tenants = true, ademas TODO el negocio de sus tenants:
--     productos, stock, ventas, clientes, documentos, membresias. Eso ya se va
--     solo por cascada, no hace falta listar tabla por tabla.
-- =============================================================================


-- =============================================================================
-- >>> EDITAR EL MAIL ACÁ <<<
-- =============================================================================
DROP TABLE IF EXISTS tmp_purge_cfg;
CREATE TEMP TABLE tmp_purge_cfg (email text NOT NULL, borrar_tenants boolean NOT NULL);
INSERT INTO tmp_purge_cfg (email, borrar_tenants) VALUES ('matiasmagis420@gmail.com', true);
--                                              ^^^^^^^^^^^^^^^^^^^^^^^^^^  ^
--                                              el mail que querés borrar  ademas borrar
--                                                                       todo el negocio
--                                                                       de sus tenants?
--                                                                       false = solo
--                                                                       se va el
--                                                                       usuario y el
--                                                                       tenant queda


-- -----------------------------------------------------------------------------
-- Arma el universo del purge. NO borra nada: solo anota que filas son objetivo.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS tmp_purge_auth;
DROP TABLE IF EXISTS tmp_purge_profiles;
DROP TABLE IF EXISTS tmp_purge_tenants;

CREATE TEMP TABLE tmp_purge_auth (id uuid);
INSERT INTO tmp_purge_auth (id)
  SELECT u.id
  FROM auth.users u
  JOIN tmp_purge_cfg c ON lower(u.email) = c.email;

-- Un perfil puede existir sin usuario de auth (un alta a medias), o al reves.
CREATE TEMP TABLE tmp_purge_profiles (id uuid);
INSERT INTO tmp_purge_profiles (id)
  SELECT p.id FROM public.profiles p JOIN tmp_purge_cfg c ON lower(p.email) = c.email
  UNION
  SELECT id FROM tmp_purge_auth;

-- Los tenants salen de las membresias, o del tenant_id directo del perfil si la
-- membresia nunca llego a crearse.
CREATE TEMP TABLE tmp_purge_tenants (tenant_id uuid);
INSERT INTO tmp_purge_tenants (tenant_id)
SELECT DISTINCT tenant_id
FROM (
  SELECT tu.tenant_id FROM public.tenant_users tu WHERE tu.user_id IN (SELECT id FROM tmp_purge_auth)
  UNION
  SELECT p.tenant_id FROM public.profiles p
  WHERE p.id IN (SELECT id FROM tmp_purge_profiles) AND p.tenant_id IS NOT NULL
) s
WHERE (SELECT borrar_tenants FROM tmp_purge_cfg);


-- =============================================================================
-- BLOQUE 1: QUE HAY PARA BORRAR. Solo lectura.
-- =============================================================================
SELECT
  'usuario de auth'        AS que, count(*) AS filas FROM auth.users                WHERE id IN (SELECT id FROM tmp_purge_auth)
UNION ALL SELECT 'perfil',                 count(*) FROM public.profiles           WHERE id IN (SELECT id FROM tmp_purge_profiles)
UNION ALL SELECT 'membresia de tenant',    count(*) FROM public.tenant_users        WHERE user_id IN (SELECT id FROM tmp_purge_auth)
UNION ALL SELECT 'tenants a borrar',       count(*) FROM tmp_purge_tenants
UNION ALL SELECT 'analytics (por mail)',   count(*) FROM public.analytics_events a  JOIN tmp_purge_cfg c ON lower(a.user_email) = c.email
UNION ALL SELECT 'analytics (por tenant)', count(*) FROM public.analytics_events    WHERE tenant_id IN (SELECT tenant_id FROM tmp_purge_tenants)
UNION ALL SELECT 'invitaciones',           count(*) FROM public.invitations i       JOIN tmp_purge_cfg c ON lower(i.email) = c.email
UNION ALL SELECT 'tokens de reset',        count(*) FROM public.password_reset_tokens t JOIN tmp_purge_cfg c ON lower(t.email) = c.email
ORDER BY filas DESC;


-- Los tenants que caen con todo su negocio.
SELECT t.name AS tenant, t.slug
FROM public.tenants t
WHERE t.id IN (SELECT tenant_id FROM tmp_purge_tenants)
ORDER BY t.name;


-- Documentos que se BORRAN porque su autor es este usuario. Son columnas NOT
-- NULL: no hay forma de conservarlos y borrar al usuario. Las dos que si
-- admiten NULL se nullean y por eso NO aparecen aca.
SELECT 'ventas' AS documento, count(*) AS filas FROM public.sales s
  WHERE s.created_by IN (SELECT id FROM tmp_purge_auth)
UNION ALL SELECT 'compras',            count(*) FROM public.purchase_orders       WHERE created_by IN (SELECT id FROM tmp_purge_auth)
UNION ALL SELECT 'facturas',           count(*) FROM public.electronic_invoices    WHERE created_by IN (SELECT id FROM tmp_purge_auth)
UNION ALL SELECT 'documentos',         count(*) FROM public.commercial_documents   WHERE created_by IN (SELECT id FROM tmp_purge_auth)
UNION ALL SELECT 'transferencias',     count(*) FROM public.stock_transfers        WHERE created_by IN (SELECT id FROM tmp_purge_auth)
UNION ALL SELECT 'movimientos de caja', count(*) FROM public.cash_movements         WHERE created_by IN (SELECT id FROM tmp_purge_auth)
UNION ALL SELECT 'sesiones de caja',    count(*) FROM public.cash_register_sessions WHERE opened_by  IN (SELECT id FROM tmp_purge_auth)
UNION ALL SELECT 'historial de stock',  count(*) FROM public.stock_history          WHERE created_by IN (SELECT id FROM tmp_purge_auth)
ORDER BY filas DESC;


-- =============================================================================
-- BLOQUE 2: BORRAR
-- =============================================================================
-- Descomenta esta linea SOLO cuando el paso 3 te haya dado numeros OK.
-- SET vynko.purge_confirmado = 'si';

BEGIN;

-- Verificacion de la confirmacion. Si falta, aborta aqui y no se borra nada.
-- El mensaje lleva los numeros, asi no hay que depender de ver el BLOQUE 1.
DO $$
DECLARE
  v_auth       int;
  v_perfiles   int;
  v_membresias int;
  v_tenants    int;
  v_analytics  int;
  v_documentos int;
BEGIN
  IF current_setting('vynko.purge_confirmado', true) IS DISTINCT FROM 'si' THEN
    SELECT count(*) INTO v_auth       FROM tmp_purge_auth;
    SELECT count(*) INTO v_perfiles   FROM tmp_purge_profiles;
    SELECT count(*) INTO v_membresias FROM public.tenant_users WHERE user_id IN (SELECT id FROM tmp_purge_auth);
    SELECT count(*) INTO v_tenants    FROM tmp_purge_tenants;
    SELECT count(*) INTO v_analytics  FROM public.analytics_events
      WHERE lower(user_email) = (SELECT email FROM tmp_purge_cfg)
         OR tenant_id IN (SELECT tenant_id FROM tmp_purge_tenants);
    SELECT count(*) INTO v_documentos FROM (
      SELECT id FROM public.sales                  WHERE created_by IN (SELECT id FROM tmp_purge_auth)
      UNION ALL SELECT id FROM public.purchase_orders      WHERE created_by IN (SELECT id FROM tmp_purge_auth)
      UNION ALL SELECT id FROM public.electronic_invoices   WHERE created_by IN (SELECT id FROM tmp_purge_auth)
      UNION ALL SELECT id FROM public.commercial_documents  WHERE created_by IN (SELECT id FROM tmp_purge_auth)
      UNION ALL SELECT id FROM public.stock_transfers       WHERE created_by IN (SELECT id FROM tmp_purge_auth)
      UNION ALL SELECT id FROM public.cash_movements        WHERE created_by IN (SELECT id FROM tmp_purge_auth)
      UNION ALL SELECT id FROM public.cash_register_sessions WHERE opened_by  IN (SELECT id FROM tmp_purge_auth)
      UNION ALL SELECT id FROM public.stock_history         WHERE created_by IN (SELECT id FROM tmp_purge_auth)
    ) d;

    RAISE EXCEPTION
      'Purge CANCELADO: falta la confirmacion. NO se borro nada. Se borrarian: % usuario(s) de auth, % perfil(es), % membresia(s), % tenant(s) con todo su negocio, % evento(s) de analytics, % documento(s) que se borran por ser de este usuario. Si te sirven esos numeros, descomenta la linea SET vynko.purge_confirmado = ''si'' y volve a ejecutar el archivo entero.',
      v_auth, v_perfiles, v_membresias, v_tenants, v_analytics, v_documentos;
  END IF;
END $$;


-- Si alguno de los tenants a borrar tiene miembros que NO son este usuario, no
-- es un usuario de prueba: mejor frenar que llevarse el negocio de otro.
DO $$
DECLARE
  riesgos text;
BEGIN
  SELECT string_agg(DISTINCT tu.tenant_id::text, ', ') INTO riesgos
  FROM public.tenant_users tu
  WHERE tu.tenant_id IN (SELECT tenant_id FROM tmp_purge_tenants)
    AND tu.user_id NOT IN (SELECT id FROM tmp_purge_auth);

  IF riesgos IS NOT NULL THEN
    RAISE EXCEPTION 'ABORTO: los tenants % tienen miembros ajenos a este usuario. No es un usuario de prueba.', riesgos;
  END IF;
END $$;


-- Estas dos columnas admiten NULL, asi que se nullean en vez de borrar el
-- documento entero. Perder una venta o un movimiento de stock solo porque su
-- autor se va no corresponde.
UPDATE public.cash_register_sessions SET closed_by = NULL
  WHERE closed_by IN (SELECT id FROM tmp_purge_auth)
    AND opened_by NOT IN (SELECT id FROM tmp_purge_auth);

UPDATE public.stock_movements SET created_by = NULL
  WHERE created_by IN (SELECT id FROM tmp_purge_auth);

-- Las 8 que son NOT NULL no tienen otra salida: o se borra el documento, o el
-- usuario no se puede borrar. El BLOQUE 1 dice cuantas son.
DELETE FROM public.sales                  WHERE created_by IN (SELECT id FROM tmp_purge_auth);
DELETE FROM public.purchase_orders        WHERE created_by IN (SELECT id FROM tmp_purge_auth);
DELETE FROM public.electronic_invoices    WHERE created_by IN (SELECT id FROM tmp_purge_auth);
DELETE FROM public.commercial_documents   WHERE created_by IN (SELECT id FROM tmp_purge_auth);
DELETE FROM public.stock_transfers        WHERE created_by IN (SELECT id FROM tmp_purge_auth);
DELETE FROM public.cash_movements         WHERE created_by IN (SELECT id FROM tmp_purge_auth);
DELETE FROM public.cash_register_sessions WHERE opened_by  IN (SELECT id FROM tmp_purge_auth);
DELETE FROM public.stock_history          WHERE created_by IN (SELECT id FROM tmp_purge_auth);

-- Los tenants. Todas las tablas con tenant_id tienen ON DELETE CASCADE, asi que
-- el negocio se va solo. La excepcion es analytics_events, que tiene
-- ON DELETE SET NULL: sus eventos sobreviven con tenant_id en NULL si no se
-- borran antes.
DELETE FROM public.analytics_events WHERE tenant_id IN (SELECT tenant_id FROM tmp_purge_tenants);

DELETE FROM public.tenants WHERE id IN (SELECT tenant_id FROM tmp_purge_tenants);

-- Lo que es del usuario, independiente del tenant.
DELETE FROM public.analytics_events
  WHERE lower(user_email) = (SELECT email FROM tmp_purge_cfg);

DELETE FROM public.password_reset_tokens
  WHERE lower(email) = (SELECT email FROM tmp_purge_cfg);

DELETE FROM public.invitations
  WHERE lower(email) = (SELECT email FROM tmp_purge_cfg);

DELETE FROM public.activity_logs
  WHERE user_id IN (SELECT id FROM tmp_purge_auth);

DELETE FROM public.notifications
  WHERE user_id IN (SELECT id FROM tmp_purge_auth);

DELETE FROM public.tenant_users
  WHERE user_id IN (SELECT id FROM tmp_purge_auth);

DELETE FROM public.profiles
  WHERE id IN (SELECT id FROM tmp_purge_profiles);

-- El usuario de auth, al final: mientras exista, las FKs created_by de las
-- tablas de arriba lo sostienen.
DELETE FROM auth.users
  WHERE id IN (SELECT id FROM tmp_purge_auth);

COMMIT;


-- =============================================================================
-- BLOQUE 3: VERIFICAR. Todas las filas tienen que dar 0.
-- =============================================================================
SELECT
  'usuario de auth'     AS donde, count(*) AS restantes FROM auth.users             WHERE id IN (SELECT id FROM tmp_purge_auth)
UNION ALL SELECT 'perfil',              count(*) FROM public.profiles             WHERE id IN (SELECT id FROM tmp_purge_profiles)
UNION ALL SELECT 'invitaciones',        count(*) FROM public.invitations i         JOIN tmp_purge_cfg c ON lower(i.email) = c.email
UNION ALL SELECT 'tokens de reset',     count(*) FROM public.password_reset_tokens t JOIN tmp_purge_cfg c ON lower(t.email) = c.email
UNION ALL SELECT 'analytics',           count(*) FROM public.analytics_events a    JOIN tmp_purge_cfg c ON lower(a.user_email) = c.email
UNION ALL SELECT 'membresia de tenant', count(*) FROM public.tenant_users          WHERE user_id IN (SELECT id FROM tmp_purge_auth)
UNION ALL SELECT 'ventas suyas',        count(*) FROM public.sales                 WHERE created_by IN (SELECT id FROM tmp_purge_auth)
ORDER BY restantes DESC;
