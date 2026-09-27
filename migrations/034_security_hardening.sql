-- ========================================
-- Security Fix: RLS / multi-tenancy hardening
-- Migration: 034_security_hardening.sql
-- ========================================
--
-- Corrige los problemas de aislamiento entre tenants detectados en la
-- auditoria de seguridad:
--
-- 1. `022` ancla el aislamiento de suppliers / purchase_order_items /
--    stock_movements en `profiles.tenant_id`, una columna que el usuario
--    podia cambiar a su voluntad (la policy de UPDATE de profiles no tenia
--    WITH CHECK). Ahora todo el aislamiento se ancla en `tenant_users`,
--    que es la unica fuente de verdad de pertenencia.
-- 2. Policies de escritura abiertas a `anon`/`authenticated` (notifications,
--    analytics_events, invitations) que se evaluaban sin restriccion de rol.
-- 3. `profiles.tenant_id` pasa a ser inmutable para cualquier rol distinto
--    de service_role (policy + trigger).
-- 4. Toda escritura de datos pasa por API routes con service_role (el patron
--    que ya usa la app), asi que se eliminan las policies de DML accesibles
--    con la anon key + JWT del usuario.
-- 5. Las vistas de agregacion (027) solo se leen con service_role.
-- 6. El bucket `product-images` pasa a privado, con limites de tamano/MIME
--    y policies de Storage ancladas en el prefijo del tenant.
-- 7. Se documenta por que NO se aplica FORCE ROW LEVEL SECURITY (seccion 9).
--
-- Idempotente: se puede re-aplicar sin efectos duplicados.
--
-- Verificacion: `node scripts/verify-rls.mjs` prueba el aislamiento con la
-- anon key + un JWT de usuario real (41 aserciones sobre la base de test).
-- ========================================

-- ========================================
-- 1. Helpers de pertenencia (SECURITY DEFINER)
-- ========================================
-- Se usan en las policies para:
--   a) evitar recursion de RLS (la policy de una tabla no consulta otra
--      tabla gobernada por la misma policy),
--   b) evitar el costo de un subquery por fila,
--   c) anclar el aislamiento en tenant_users y no en profiles.tenant_id.
CREATE OR REPLACE FUNCTION public.current_user_tenant_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_user_tenant_role(target_tenant uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role
  FROM public.tenant_users
  WHERE user_id = auth.uid() AND tenant_id = target_tenant;
$$;

-- is_admin() viene de 026 con search_path mutable; se recrea fijado.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE auth.users.id = auth.uid()
      AND auth.users.email = 'matias.pagano07@gmail.com'
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_tenant_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_tenant_role(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_tenant_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_tenant_role(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- ========================================
-- 2. profiles: tenant_id inmutable
-- ========================================
-- La policy anterior (002) era `FOR UPDATE USING (id = auth.uid())` sin
-- WITH CHECK: Postgres tombaba el USING tambien como WITH CHECK para UPDATE,
-- asi que un usuario podia mover su propio perfil al tenant de una victima
-- y, desde ahi, las policies que confian en profiles.tenant_id le abrian
-- ese tenant.
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND tenant_id IN (SELECT public.current_user_tenant_ids())
  );

-- La creacion de perfiles la hace el backend (onboarding / aceptacion de
-- invitacion) con service_role. Se elimina el INSERT del cliente.
DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;

-- Backstop a nivel motor: aunque una policy quedara mal escrita, el
-- tenant_id no se puede cambiar desde el cliente.
CREATE OR REPLACE FUNCTION public.enforce_profile_tenant_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin')
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'profiles.tenant_id no puede modificarse'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_tenant_id_immutable ON profiles;
CREATE TRIGGER profiles_tenant_id_immutable
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_profile_tenant_immutability();

-- ========================================
-- 3. Re-aislamiento de las policies de 022
-- ========================================
-- suppliers / purchase_order_items / stock_movements: se reemplaza el
-- "Tenant isolation" FOR ALL (basado en profiles.tenant_id y con DML
-- abierto) por lectura acotada al tenant + service_role para escritura.
DROP POLICY IF EXISTS "Tenant isolation" ON suppliers;
DROP POLICY IF EXISTS "Tenant isolation" ON purchase_order_items;
DROP POLICY IF EXISTS "Tenant isolation" ON stock_movements;

CREATE POLICY "Users can view their tenant suppliers" ON suppliers
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "Users can view their tenant purchase order items" ON purchase_order_items
  FOR SELECT TO authenticated
  USING (
    purchase_order_id IN (
      SELECT purchase_orders.id FROM purchase_orders
      WHERE purchase_orders.tenant_id IN (SELECT public.current_user_tenant_ids())
    )
  );

CREATE POLICY "Users can view their tenant stock movements" ON stock_movements
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

-- ========================================
-- 4. Escrituras solo por service_role
-- ========================================
-- Toda mutacion de la app pasa por API routes con service_role (BYPASSRLS).
-- Las policies de DML accesibles con la anon key quedan solo como red de
-- contencion si alguien reutiliza el cliente del navegador contra PostgREST.
DROP POLICY IF EXISTS "Users can insert product stock in their tenant" ON product_stock;
DROP POLICY IF EXISTS "Users can update product stock in their tenant" ON product_stock;
DROP POLICY IF EXISTS "Authenticated users can insert products" ON products;
DROP POLICY IF EXISTS "Authenticated users can update products" ON products;
DROP POLICY IF EXISTS "Authenticated users can delete products" ON products;
DROP POLICY IF EXISTS "All authenticated users can view products" ON products;

DROP POLICY IF EXISTS "Users can insert documents in their tenant" ON commercial_documents;
DROP POLICY IF EXISTS "Users can update documents in their tenant" ON commercial_documents;
DROP POLICY IF EXISTS "Users can delete documents in their tenant" ON commercial_documents;
DROP POLICY IF EXISTS "Users can insert document items in their tenant" ON commercial_document_items;
DROP POLICY IF EXISTS "Users can delete document items in their tenant" ON commercial_document_items;
DROP POLICY IF EXISTS "Users can insert document sequences in their tenant" ON commercial_document_sequences;
DROP POLICY IF EXISTS "Users can update document sequences in their tenant" ON commercial_document_sequences;

DROP POLICY IF EXISTS "Users can insert electronic invoices in their tenant" ON electronic_invoices;
DROP POLICY IF EXISTS "Users can update electronic invoices in their tenant" ON electronic_invoices;
DROP POLICY IF EXISTS "Users can insert invoice items in their tenant" ON invoice_items;
DROP POLICY IF EXISTS "Users can insert invoice sequences in their tenant" ON invoice_sequences;
DROP POLICY IF EXISTS "Users can update invoice sequences in their tenant" ON invoice_sequences;

DROP POLICY IF EXISTS "Only owners can insert invitations" ON invitations;

-- notifications: el INSERT era WITH CHECK (true) sin restriccion de rol, o
-- sea que cualquier cliente (incluido anon) podia crear notificaciones.
DROP POLICY IF EXISTS "Service role can insert notifications" ON notifications;
CREATE POLICY "Service role can insert notifications" ON notifications
  FOR INSERT TO service_role
  WITH CHECK (true);

-- Marcar como leida: solo sobre las notificaciones propias o las
-- broadcasts del tenant (user_id IS NULL).
DROP POLICY IF EXISTS "Users can update notifications" ON notifications;
CREATE POLICY "Users can update notifications" ON notifications
  FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT public.current_user_tenant_ids())
    AND (user_id IS NULL OR user_id = auth.uid())
  )
  WITH CHECK (
    tenant_id IN (SELECT public.current_user_tenant_ids())
    AND (user_id IS NULL OR user_id = auth.uid())
  );

-- analytics_events: los eventos los graba el backend (signup/payment) con
-- service_role. El INSERT abierto a `authenticated` permitia poisoning de
-- analytics e inyeccion de PII desde el navegador.
DROP POLICY IF EXISTS "Authenticated users can insert analytics events" ON analytics_events;
DROP POLICY IF EXISTS "Admin can read analytics events" ON analytics_events;
CREATE POLICY "Admin can read analytics events" ON analytics_events
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- ========================================
-- 5. Policies de service_role para toda tabla de negocio
-- ========================================
-- Red de contencion: si alguna vez se fuerza RLS o se revoca BYPASSRLS, la
-- app sigue escribiendo por la via explicita en vez de quedar sin acceso.
-- La lista cubre todas las tablas de public con datos de tenants.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants', 'profiles', 'tenant_users',
    'categories', 'products', 'product_stock',
    'stock_history', 'customers', 'sales', 'sale_items',
    'providers', 'purchase_orders', 'po_items',
    'suppliers', 'purchase_order_items', 'stock_movements',
    'commercial_documents', 'commercial_document_items', 'commercial_document_sequences',
    'electronic_invoices', 'invoice_items', 'invoice_sequences',
    'notifications', 'invitations', 'activity_logs',
    'sale_payments', 'cash_register_sessions', 'cash_movements',
    'stock_transfers', 'stock_transfer_items',
    'analytics_events', 'password_reset_tokens'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'service_role_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      'service_role_all', t
    );
  END LOOP;
END $$;

-- RLS explicito en todas las tablas de negocio.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants', 'profiles', 'tenant_users', 'categories', 'products',
    'product_stock', 'stock_history', 'customers', 'sales', 'sale_items',
    'providers', 'purchase_orders', 'po_items', 'suppliers',
    'purchase_order_items', 'stock_movements', 'commercial_documents',
    'commercial_document_items', 'commercial_document_sequences',
    'electronic_invoices', 'invoice_items', 'invoice_sequences',
    'notifications', 'invitations', 'activity_logs', 'sale_payments',
    'cash_register_sessions', 'cash_movements', 'stock_transfers',
    'stock_transfer_items', 'analytics_events', 'password_reset_tokens'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ========================================
-- 6. Privilegios: sin DML para anon/authenticated
-- ========================================
-- RLS ya bloquea el acceso sin policy; el REVOKE agrega una segunda barrera
-- y evita depender de una policy mal escrita.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants', 'profiles', 'tenant_users', 'categories', 'products',
    'product_stock', 'stock_history', 'customers', 'sales', 'sale_items',
    'providers', 'purchase_orders', 'po_items', 'suppliers',
    'purchase_order_items', 'stock_movements', 'commercial_documents',
    'commercial_document_items', 'commercial_document_sequences',
    'electronic_invoices', 'invoice_items', 'invoice_sequences',
    'notifications', 'invitations', 'activity_logs', 'sale_payments',
    'cash_register_sessions', 'cash_movements', 'stock_transfers',
    'stock_transfer_items', 'analytics_events', 'password_reset_tokens'
  ] LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM anon, authenticated', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END $$;

-- ========================================
-- 7. Vistas de agregacion: solo service_role
-- ========================================
-- 027 solo otorgaba SELECT a service_role, pero los GRANT por defecto de
-- Supabase sobre el schema public dejaban a anon/authenticated con acceso a
-- las vistas, que agregan ventas de todos los tenants.
REVOKE ALL ON public.sales_daily_totals FROM anon, authenticated;
REVOKE ALL ON public.sales_monthly_totals FROM anon, authenticated;
REVOKE ALL ON public.tenant_first_activity FROM anon, authenticated;
REVOKE ALL ON public.analytics_events_by_month FROM anon, authenticated;
REVOKE ALL ON public.sales_daily_totals FROM public;
REVOKE ALL ON public.sales_monthly_totals FROM public;
REVOKE ALL ON public.tenant_first_activity FROM public;
REVOKE ALL ON public.analytics_events_by_month FROM public;

-- ========================================
-- 8. Storage: bucket de imagenes privado
-- ========================================

DO $$
BEGIN
  IF to_regnamespace('storage') IS NOT NULL THEN
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES (
    'product-images', 'product-images', false, 5242880,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  )
  ON CONFLICT (id) DO UPDATE
    SET public = false,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

  -- Acceso por prefijo de tenant: `{tenant_id}/{archivo}`.
  DROP POLICY IF EXISTS "Members can read their tenant product images" ON storage.objects;
  CREATE POLICY "Members can read their tenant product images" ON storage.objects
    FOR SELECT TO authenticated
    USING (
      bucket_id = 'product-images'
      AND (storage.foldername(name))[1]::text IN (SELECT public.current_user_tenant_ids()::text)
    );

  DROP POLICY IF EXISTS "Members can upload their tenant product images" ON storage.objects;
  CREATE POLICY "Members can upload their tenant product images" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'product-images'
      AND (storage.foldername(name))[1]::text IN (SELECT public.current_user_tenant_ids()::text)
    );

  DROP POLICY IF EXISTS "Members can update their tenant product images" ON storage.objects;
  CREATE POLICY "Members can update their tenant product images" ON storage.objects
    FOR UPDATE TO authenticated
    USING (
      bucket_id = 'product-images'
      AND (storage.foldername(name))[1]::text IN (SELECT public.current_user_tenant_ids()::text)
    )
    WITH CHECK (
      bucket_id = 'product-images'
      AND (storage.foldername(name))[1]::text IN (SELECT public.current_user_tenant_ids()::text)
    );

  DROP POLICY IF EXISTS "Members can delete their tenant product images" ON storage.objects;
  CREATE POLICY "Members can delete their tenant product images" ON storage.objects
    FOR DELETE TO authenticated
    USING (
      bucket_id = 'product-images'
      AND (storage.foldername(name))[1]::text IN (SELECT public.current_user_tenant_ids()::text)
    );
  ELSE
    RAISE NOTICE 'Esquema storage ausente: se omite la seccion de Storage.';
  END IF;
END $$;

-- ========================================
-- 9. Decision consciente: NO usar FORCE ROW LEVEL SECURITY
-- ========================================
-- Se evaluo `ALTER TABLE ... FORCE ROW LEVEL SECURITY` y se descarto a
-- proposito, por una razon tecnica concreta y no por conveniencia.
--
-- Las funciones helper de la seccion 1 son SECURITY DEFINER, asi que se
-- ejecutan con los privilegios del dueno (`postgres`). Con FORCE RLS el dueno
-- tambien queda sujeto a las policies, y como `tenant_users` solo tiene la
-- policy `service_role_all` (TO service_role), `current_user_tenant_ids()`
-- devolveria el conjunto vacio. Las policies de lectura de las secciones 3-4
-- dejarian de filtrar de forma util: pasarian de "acotado al tenant" a
-- "no visible" sin que ningun test de la app lo note.
--
-- FORCE tampoco aporta defensa relevante en este esquema:
--   - La app nunca se conecta como dueno de tabla: toda operacion de negocio
--     va por API routes con `service_role` (BYPASSRLS).
--   - Si un atacante ya logra inyectar SQL con el service role key, tiene
--     acceso total con o sin FORCE, porque BYPASSRLS no se ve afectado por RLS.
--
-- Si alguna vez hiciera falta FORCE, el orden seguro es: mover los helpers a
-- un rol con BYPASSRLS, o crear la policy equivalente para el rol dueno, y
-- solo despues activar FORCE + volver a correr `scripts/verify-rls.mjs`.
-- ========================================
