-- ============================================================
-- 030: Flag explícito de onboarding pendiente/completado
--
-- Fuente de verdad directa para decidir si mostrar el onboarding
-- (true) u ocultarlo (false), sin depender de interpretar el
-- estado de las membresías:
--   TRUE  -> el usuario aún debe completar el onboarding (mostrar)
--   FALSE -> el usuario ya tiene empresa / completó el onboarding
--            (nunca mostrar)
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarding_pending BOOLEAN NOT NULL DEFAULT TRUE;

-- Backfill: todo usuario que ya pertenezca a una empresa no debe
-- ver el onboarding. Los que no tienen membresías quedan en TRUE.
UPDATE profiles
SET onboarding_pending = FALSE
WHERE onboarding_pending = TRUE
  AND EXISTS (
    SELECT 1 FROM tenant_users tu WHERE tu.user_id = profiles.id
  );

COMMENT ON COLUMN profiles.onboarding_pending IS
  'TRUE si el usuario aún debe completar el onboarding (crear/entrar a una empresa). El proxy y /api/session muestran /onboarding solo si es TRUE y además el usuario no tiene membresías.';