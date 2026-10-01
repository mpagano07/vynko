-- 042: Preferencia "ocultar Primeros pasos" por cuenta
--
-- El flag vivia solo en localStorage, que es por navegador: la misma cuenta
-- veia el checklist en el celular y no en la PC, segun donde se habia
-- hecho clic en la X. Ahora la preferencia vive en la fila del usuario, asi
-- que "oculto" significa oculto en todos los dispositivos.
--
-- Es una preferencia de UI, no un permiso. La policy "Users can update their
-- own profile" (034) es por fila y los triggers de 034/038 solo bloquean
-- tenant_id e is_admin, asi que un usuario solo puede tocar su propia fila.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarding_checklist_dismissed_at timestamptz;

COMMENT ON COLUMN profiles.onboarding_checklist_dismissed_at IS
  'Momento en que el usuario oculto el checklist "Primeros pasos" del dashboard. NULL = visible.';