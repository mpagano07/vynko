# Autenticacion: sesiones, permisos y revocacion

Como se resuelven las sesiones y los permisos en Vynko, y que se espera que pase
cuando algo cambia. Rama: `security/audit-hardening`.

## Dónde vive cada decisión

| Decisión | Dónde se resuelve | Por qué |
|---|---|---|
| ¿Hay sesión? | Supabase (cookie HttpOnly) + `supabase.auth.getUser()` en servidor | El token nunca es legible por JS |
| ¿Qué rol tiene? | `tenant_users`, leído en **cada** request a `/api/session` | No hay snapshot del rol en la sesión |
| ¿Puede tocar este recurso? | RLS de Postgres + checks por rol en cada API route | La defense real, no la UI |
| ¿Puede ver analytics de admin? | `profiles.is_admin` + policy de `analytics_events` | Ningún dato de negocio se filtra por ser admin |
| ¿Vio la app hace rato? | Cookie `vynko_last_seen` (HttpOnly) en `src/proxy.ts` | El cierre por inactividad no puede depender solo del navegador |

## Permisos: se resuelven por request, no por sesión

El token de Supabase **no lleva roles**. El rol vive en la tabla `tenant_users` y
`getSessionData` (`src/lib/session-service.ts`) lo consulta en cada llamada a
`/api/session`.

Consecuencias Practicas:

- Bajar a un `member` a `owner`, o sacarlo de la empresa, se refleja en su
  **próximo request**. No hace falta cerrar sesión ni esperar un TTL de cache.
- Las sesiones de otros dispositivos no necesitan "reinventarse": comparten la
  fila de `tenant_users`, así que ven el cambio también.
- Un usuario en dos empresas tiene un rol **por empresa**. `x-active-tenant-id`
  elige cuál; si el id no está en sus membresías se ignora y se usa la primera, así
  que esa header no es vector de escalada.
- Quitarle todas las membresías activas no es un cambio silencioso: dispara
  `revoke_user_sessions_if_no_active_membership` (migración 067), que cierra las
  sesiones de auth de esa persona. Es best-effort: si la RPC falla, la
  membresía igual quedó inactiva/eliminada y el backend le sigue negando el
  tenant; si la sesión sobrevive, `NoTenantAccessGuard` la manda a `/no-access`.
  El proxy no expulsa por membresía vacía a propósito: una lectura transitoria
  fallida de `tenant_users` no debe sacar de la app a un cliente que sí tiene
  empresa; por eso la decisión vive en el cliente, sobre una segunda lectura.
- Un miembro con `status = 'inactive'` tampoco conserva acceso directo por
  PostgREST ni por Storage: las policies de 067 filtran `status = 'active'`, así
  que la anon key + su JWT dejan de ver el tenant.

Fijado en `src/test/security-session-resolution.test.ts`.

## Revocación: qué se cae y cuándo

| Acción | Alcance | Otros dispositivos |
|---|---|---|
| `POST /api/auth/password` (cambio con la actual) | **Global** | Se caen |
| `POST /api/auth/recover` (recuperación) | **Global** | Se caen |
| `POST /api/auth/invitation-password` (alta por invitación) | **Global** | Se caen |
| `POST /api/auth/logout` | Local | No se caen |
| Cierre por inactividad (30 min) | Local | No se caen |
| Cambio de rol o alta/baja de una sucursal conservando otra activa | No revoca | No hace falta: se resuelve por request |
| Desactivar o quitar la última membresía activa | **Global** (best-effort) | Se caen vía RPC de 067 |

El cambio y la recuperación de contraseña revocan globalmente a propósito: son el
camino para recuperar una cuenta que se sospecha que fue sustraída, y dejar viva
la sesión robada sería inútil. El aviso aparece en Ajustes **antes** del botón, no
solo en el toast de éxito, porque el efecto en los otros dispositivos no es
evidente.

`POST /api/auth/invitation-password` solo revoca cuando **efectivamente** cambia
la contraseña. Las salidas de validación (no hay invitación, la cuenta ya está en
uso, contraseña débil) devuelven sin escribir nada y **no** tocan la sesión: si
revocaran, un 403 expulsaría al usuario de una sesión que nunca estuvo
comprometida.

## Alta por invitación: la invariante

`POST /api/auth/invitation-password` existe aparte del cambio de contraseña
porque ese último exige la contraseña actual como prueba, y un usuario recién
invitado no tiene ninguna. Aflojar ese requisito para todos habría sido un
retroceso.

La prueba de identidad es la invitación pendiente **más** la condición de que la
cuenta no tenga membresías ajenas a sus invitaciones
(`getInvitationAccountScope`). Sin esa segunda mitad, "tiene una invitación
pendiente" sigue siendo cierto para un cliente que ya usa Vynko y al que un
owner acaba de sumar a otra empresa, y el endpoint le fijaba la contraseña sin
pedir la anterior: toma de cuenta permanente con una sesión robada.

Cuando el servidor rechaza por esa condición, la respuesta es un 403 con un texto
específico. El cliente redirige a `/dashboard` (no a `/settings`, que expulsa a
los `member`) y el mensaje pide iniciar sesión con la contraseña que ya se tenía.

## Lo que cada capa NO protege

- Que el sidebar esconda la sección Admin y que `/admin/analytics` redirija son
  **comodidad**, no seguridad. La decisión está en la API y en la policy de RLS.
- La cookie de inactividad evita una sesión olvidada en un equipo compartido; no
  es un control de concurrencia ni un timeout de servidor.
- El `is_admin` de `profiles` no se puede escribir desde el navegador
  (trigger `profiles_admin_immutable`, migration 038). La policy de UPDATE de
  `profiles` no restringe columnas, así que sin ese trigger la autopromoción
  sería trivial.

## Pendiente de verificación en entorno real

Estas dos cosas no están cubiertas por tests unitarios y necesitan un ambiente con
Supabase real:

1. El link de recuperación con un email y un enlace PKCE de verdad.
2. Que un `member` con una invitación nueva llegue a `/dashboard` tras el 403.
