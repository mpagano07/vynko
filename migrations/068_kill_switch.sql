-- ============================================================
-- 068: kill switch de areas criticas
-- ============================================================
--
-- Filas semilla para `feature_flags` (055). No cambia el esquema: reusa la
-- tabla y la API admin que ya existen.
--
-- Semantica INVERTIDA a proposito respecto de los flags de release:
--
--   * fila ausente o enabled = false  -> la funcionalidad esta VIVA.
--   * enabled = true                  -> la funcionalidad esta MATADA.
--
-- Un kill switch no puede depender de `rollout_percent` ni de que alguien se
-- acuerde de crear la fila: si no existe, la app sigue operando (fail open).
-- El helper `src/lib/kill-switch.ts` lee solo `enabled` y le da prioridad a la
-- variable de entorno `FEATURE_KILL_<AREA>` (o `MAINTENANCE_MODE`), que
-- funciona incluso si la base no responde.
--
-- `maintenance_mode` es un superset: bloquea las cuatro areas y manda las
-- paginas de la app a /maintenance. No bloquea auth, health, version, cron ni
-- los webhooks de pago (Paddle/MercadoPago son la fuente de verdad de la
-- suscripcion: bloquearlos genera reintentos y desincronizacion).
--
-- `on conflict do nothing` es deliberado: si alguien ya mato un area, volver a
-- correr esta migracion no la revive.

insert into public.feature_flags (flag_key, enabled, rollout_percent, description)
values
  ('kill_sales',        false, 100, 'Kill switch: bloquea POST /api/sales (nuevas ventas).'),
  ('kill_payments',     false, 100, 'Kill switch: bloquea checkout, portal y downgrade de Paddle.'),
  ('kill_forecast',     false, 100, 'Kill switch: bloquea GET /api/forecast.'),
  ('kill_imports',      false, 100, 'Kill switch: bloquea POST /api/products/import.'),
  ('maintenance_mode',  false, 100, 'Mantenimiento global: paginas a /maintenance y escrituras bloqueadas.')
on conflict (flag_key) do nothing;
