-- ============================================================
-- 070: cerrar la lectura de `invitations` desde el cliente
-- ============================================================
--
-- La migracion 005 creo la policy de SELECT:
--
--   "Users can view invitations for their tenant"
--     FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM tenant_users
--                                    WHERE user_id = auth.uid()))
--
-- Esa policy permitia a CUALQUIER miembro del tenant (incluido un `viewer`)
-- leer por PostgREST la tabla completa de invitaciones: emails de personas
-- invitadas que todavia no aceptaron, su rol y quien las invito. No hace falta
-- para ninguna pantalla: `collaborator-service.ts` y `accept-invitations.ts`
-- ya leen y escriben con `supabaseAdmin` (service_role, BYPASSRLS), asi que
-- quitar el acceso del cliente no rompe ningun flujo.
--
-- El acceso por service_role lo cubre la policy `service_role_all` creada en
-- la migracion 034. Esta migracion es idempotente.
-- ============================================================

DROP POLICY IF EXISTS "Users can view invitations for their tenant" ON public.invitations;

-- Segunda barrera ademas de RLS: aunque una policy quedara mal escrita, el rol
-- del navegador no puede hacer SELECT sobre la tabla.
REVOKE SELECT ON public.invitations FROM anon, authenticated;

-- El script `scripts/verify-rls.mjs` comprueba con un JWT real que la tabla no
-- expone la invitacion de otro tenant.
