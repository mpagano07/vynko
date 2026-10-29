-- ============================================================
-- 062: refresh tokens de Google Drive por usuario
-- ============================================================
--
-- La integración con Drive usa el scope NO sensible `drive.file`, que da acceso
-- sólo a los archivos que el usuario elige con Google Picker. Para no pedirle
-- consentimiento en cada importación/exportación guardamos el refresh token de
-- Google y lo canjeamos por un access token de corta duración cuando hace falta.
--
-- El refresh token es una credencial de larga duración: se guarda cifrado con
-- AES-256-GCM (ver `src/lib/google/token-crypto.ts`) y la tabla queda en
-- deny-all. Sólo la toca el service role desde `src/lib/google/token-store.ts`;
-- PostgREST con la anon key no puede leerla ni escribirla.

create table if not exists public.google_drive_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token_encrypted text not null,
  refresh_token_iv text not null,
  refresh_token_tag text not null,
  scope text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.google_drive_tokens is
  'Refresh tokens de Google Drive (scope drive.file) cifrados por usuario. Sólo service role.';

alter table public.google_drive_tokens enable row level security;
revoke all on public.google_drive_tokens from anon, authenticated;
