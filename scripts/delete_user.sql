-- ============================================================================
-- Borrado completo de un usuario de Vynko
--
-- Ejecutar con un rol con permisos sobre el esquema `auth`
-- (p.ej. el rol `postgres` o `service_role` en el SQL Editor de Supabase).
--
-- Uso: completar UNA de las dos variables de abajo y ejecutar.
--   * Email: SET v_email = 'usuario@ejemplo.com';
--   * ID:    SET v_id    = '00000000-0000-0000-0000-000000000000';
--
-- Importante:
--   * NO ejecutar en producción sin hacer un backup primero.
--   * No cancela suscripciones externas (Mercado Pago/Stripe): si el tenant
--     está en plan de pago, cancelar el preaprobado desde el panel antes.
--   * Si el usuario tenía un plan de pago activo, su tenant sigue existiendo
--     hasta que se borre; este script lo borra si es owner.
-- ============================================================================

DO $$
DECLARE
  v_email    text := 'EMAIL_ACA';   -- poner el email, o dejar ''
  v_id       uuid := NULL;          -- poner el UUID, o dejar NULL
  v_user_id  uuid;
  v_tenants  integer;
BEGIN
  -- 1) Resolver el usuario por email o id
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE (v_id IS NOT NULL AND id = v_id)
     OR (v_email <> '' AND lower(email) = lower(v_email))
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no encontrado. Revisá el email o el id.';
  END IF;

  RAISE NOTICE 'Borrando usuario: %', v_user_id;

  -- 2) Borrar las empresas de las que el usuario es dueño.
  --    Esto cascadea TODO el negocio: clientes, productos, stock, ventas,
  --    compras, facturas, documentos, transferencias, actividad, etc.,
  --    y además limpia las columnas created_by que apuntan a este usuario.
  DELETE FROM tenants
  WHERE id IN (
    SELECT tenant_id FROM tenant_users
    WHERE user_id = v_user_id AND role = 'owner'
  );

  GET DIAGNOSTICS v_tenants = ROW_COUNT;
  RAISE NOTICE 'Empresas (owner) eliminadas: %', v_tenants;

  -- 3) En empresas donde el usuario era solo miembro/manager, borrar los
  --    registros que él creó. Las columnas created_by (y sold_by en sales) son
  --    NOT NULL y no tienen ON DELETE CASCADE, así que bloquean el borrado de
  --    auth.users. Esquema verificado contra la base real (sales usa sold_by).
  --    (Si preferís conservar esas ventas/órdenes en la empresa, cambiá estos
  --    DELETE por un UPDATE que reasigne created_by al owner del tenant.)
  DELETE FROM stock_transfers      WHERE created_by = v_user_id;
  DELETE FROM stock_history        WHERE created_by = v_user_id;
  DELETE FROM purchase_orders      WHERE created_by = v_user_id;
  DELETE FROM electronic_invoices  WHERE created_by = v_user_id;
  DELETE FROM commercial_documents WHERE created_by = v_user_id;
  DELETE FROM sales                WHERE sold_by    = v_user_id;

  -- 4) Borrar el usuario. Esto cascadea automáticamente:
  --    profiles, tenant_users, invitations, activity_logs y notifications.
  DELETE FROM auth.users WHERE id = v_user_id;

  RAISE NOTICE 'Usuario % eliminado correctamente.', v_user_id;
END $$;
