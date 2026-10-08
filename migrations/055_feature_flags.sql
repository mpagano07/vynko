-- ============================================================
-- 055: feature flags de release (globales, con rollout gradual)
-- ============================================================
--
-- Flags de RELEASE: encender/apagar una funcionalidad nueva sin deploy y con
-- rollout por porcentaje (1%, 10%, 100%).
--
-- No confundir con lo que ya existe:
--   * `tenants.settings` (JSONB, leido por `src/lib/tenant-config.ts`) son
--     modulos/ajustes POR EMPRESA: que un tenant tenga o no "compras".
--   * `profiles.is_admin` es autorizacion, no un toggle de release.
--   * `profiles.onboarding_pending` es estado de usuario.
--
-- Esta tabla es una sola copia GLOBAL por flag. Se lee con service role
-- (`src/lib/feature-flags.ts`) y con RLS deny-all: PostgREST con la anon key
-- no puede ni leer ni escribir los flags.
--
-- Semantica:
--   * enabled = false  -> APAGADO para todos (kill switch), pase lo que pase.
--   * enabled = true   -> encendido, y ademas aplica `rollout_percent` sobre
--                          el sujeto (user_id si existe, si no tenant_id).
--   * rollout_percent = 100 + enabled = true -> encendido para todos.
--
-- Ejemplo de alta (desde el SQL editor o la API admin):
--   insert into public.feature_flags (flag_key, enabled, rollout_percent, description)
--   values ('new_checkout', false, 0, 'Checkout con pasos separados');

create table if not exists public.feature_flags (
  flag_key        text primary key,
  enabled         boolean     not null default false,
  rollout_percent smallint    not null default 0
                    check (rollout_percent between 0 and 100),
  description     text,
  updated_by      text,
  updated_at      timestamptz not null default now()
);

comment on table public.feature_flags is
  'Feature flags de release globales (kill switch + rollout por porcentaje). Solo service role.';

-- Deny-all: igual que `rate_limit_buckets` (036) y `sale_idempotency_keys`
-- (048), la tabla se toca unicamente desde service role. 053 la cubre igual
-- como backstop si alguien se olvida el `enable row level security`.
alter table public.feature_flags enable row level security;
revoke all on public.feature_flags from anon, authenticated;
