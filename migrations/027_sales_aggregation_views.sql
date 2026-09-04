-- ========================================
-- Migration: 027_sales_aggregation_views.sql
-- Vistas de agregación para /api/sales/summary y /api/sales/monthly.
-- Mueven el cálculo de sum/count al motor de la base (rápido y escalable)
-- y evitan depender de las funciones de agregado de PostgREST, que no
-- están habilitadas en todos los entornos.
--
-- El filtrado por tenant y por rango de fecha lo hace el endpoint sobre
-- estas vistas mediante WHERE (service_role con BYPASSRLS).
-- ========================================

-- Agregación diaria (gráfico: ventas por día en 7/30/90/365 días, y bases para
-- forecasts/analytics por rango de fechas).
CREATE OR REPLACE VIEW public.sales_daily_totals AS
SELECT
  tenant_id,
  created_at::date AS day,
  sum(total_cents) AS total,
  count(*) AS sale_count
FROM public.sales
WHERE status = 'completed'
GROUP BY tenant_id, created_at::date;

-- Agregación mensual (tarjetas: total, count, variación vs mes anterior).
CREATE OR REPLACE VIEW public.sales_monthly_totals AS
SELECT
  tenant_id,
  date_trunc('month', created_at)::date AS month,
  sum(total_cents) AS total,
  count(*) AS sale_count
FROM public.sales
WHERE status = 'completed'
GROUP BY tenant_id, date_trunc('month', created_at);

-- Permisos: service_role (admin client) consulta las vistas; anon y
-- authenticated no pueden (se agregan SOLO grants de lectura para el
-- rol de servicio, por seguridad).
GRANT SELECT ON public.sales_daily_totals TO service_role;
GRANT SELECT ON public.sales_monthly_totals TO service_role;

-- Primera actividad por tenant (ventas + stock), para /api/admin/analytics.
-- Evita escanear toda la tabla de sales/product_stock en cada carga.
CREATE OR REPLACE VIEW public.tenant_first_activity AS
SELECT tenant_id, min(created_at) AS first_activity
FROM (
  SELECT tenant_id, created_at FROM public.sales WHERE status = 'completed'
  UNION ALL
  SELECT tenant_id, created_at FROM public.product_stock WHERE active
) src
GROUP BY tenant_id;

-- Conteo de eventos de analytics por mes y tipo, para /api/admin/analytics.
-- Evita traer todos los eventos para contarlos en JS.
CREATE OR REPLACE VIEW public.analytics_events_by_month AS
SELECT
  date_trunc('month', created_at)::date AS month,
  event_type,
  count(*) AS event_count
FROM public.analytics_events
GROUP BY date_trunc('month', created_at), event_type;

GRANT SELECT ON public.tenant_first_activity TO service_role;
GRANT SELECT ON public.analytics_events_by_month TO service_role;
