-- ============================================================
-- 031: El trial pasa de Starter a Business
--
-- El período de prueba ahora se otorga sobre el plan Business.
-- Los tenants que estaban en trial Starter (status free o
-- incomplete) migran a Business/free para conservar su trial
-- vigente sin quedar bloqueados por la nueva lógica.
-- ============================================================

UPDATE tenants
SET subscription_plan = 'business'
WHERE subscription_plan = 'starter'
  AND subscription_status IN ('free', 'incomplete');