# Onboarding

Lo que ve una cuenta nueva, de la creacion hasta el "Primeros pasos" del
dashboard.

## Flujo

```
POST /api/auth/signup          profile.onboarding_pending = true
        |
        v
   /dashboard  --(sin tenant activo)-->  /onboarding
        |                                     |
        |                            nombre de empresa + dueño
        |                                     |
        |                            POST /api/onboarding
        |                            = completeOnboarding()
        |                                     |
        v                                     v
   checklist "Primeros pasos"     tenant + profile + tenant_user
                                  company_created, trial_started
```

### 1. Alta de la persona

`POST /api/auth/signup` crea el usuario y graba el evento `signup` (un evento
por persona, no por empresa: ver `docs/product-metrics.md`). El perfil nace
con `onboarding_pending: true` (`src/lib/session-service.ts`).

### 2. La puerta del dashboard

`src/app/dashboard/page.tsx` manda a `/onboarding` cuando el usuario no tiene
sucursal activa. Excepciones cubiertas por tests de regresion
(`dashboard/page.test.tsx` -> "compuerta de onboarding"):

- con sucursales pero sin tenant activo, **no** redirige: auto-selecciona la
  primera;
- un colaborador que llega a medias (ya hay memberships) tampoco rebota.

`session-service` ademas auto-limpia `onboarding_pending` cuando detecta que
ya tiene memberships, asi que el flag no se queda pegado.

### 3. El formulario `/onboarding`

De una sola vuelta: nombre de la empresa y nombre del dueño. Pasa por
`POST /api/onboarding`, que valida el `Origin` (`isSameOriginRequest`) y llama
a `completeOnboarding` (`src/lib/onboarding-service.ts`), que:

1. rechaza si el usuario ya tiene empresa (dos personas con el mismo mail no
   pueden crear dos);
2. crea el tenant con plan **Business de 45 dias** (`NEW_ACCOUNT_PLAN`);
3. upsert de `profile` (`onboarding_pending: false`) y de `tenant_user` del
   dueno;
4. emite `company_created` y `trial_started` (son dos hechos distintos: hay
   gente que completa el onboarding mucho despues de que arranco el trial, y
   esa diferencia es justo lo que se quiere ver en el embudo);
5. loguea en pantalla el cartel de exito.

`completeOnboarding` autentica por su cuenta y acepta Bearer para el flujo
movil; el unico POST que no pasa por `getAuth` es por eso que lleva la
comprobacion de Origin aparte.

### 4. Checklist "Primeros pasos"

Widget del dashboard (`src/components/dashboard/OnboardingChecklist.tsx`),
dentro de `StockAndActivity`, montado con `LazyMount`.

| Paso | `done` cuando | Fuente del dato |
|---|---|---|
| Cargá tu primer producto | hay al menos un producto | `productCount > 0` |
| Registrá tu primera venta | el mes tiene ventas | `monthlyData.saleCount > 0` |
| Revisá las alertas de stock | algun producto con `min_stock`/`max_stock` > 0 | `alertsConfigured` |
| Creá una orden de compra | hay una orden **pendiente** | `pendingOrders.length > 0` (lo calcula `StockAndActivity`, no la pagina) |

Se oculta cuando esta todo completo o cuando el usuario lo descarto. Para
volver a verlo: `localStorage` con
`vynko_onboarding_force_show_<userId> = 'true'`.

**Descartar es una preferencia de la cuenta**, no del navegador: el click en
la X dispara `PATCH /api/onboarding/checklist` (CSRF + sesion por `getAuth`) y
`setChecklistDismissed` escribe `profiles.onboarding_checklist_dismissed_at`
**acotado al propio usuario**. Si el PATCH falla (offline), el estado local de
la sesion respeta lo que acaba de elegir y se reintenta en el proximo intento.

> Conocido: el cuarto paso mide una orden *pendiente*, no una orden creada.
> Si se crea y se recibe, la casilla vuelve a quedar sin marcar. Es el
> comportamiento actual, documentado a proposito: cambiarlo significa decidir
> si "crear la primera orden" es un hito unico (y ahi habria que contar
> eventos, no filas).

## Cobertura

| Test | Que protege |
|---|---|
| `src/app/onboarding/page.test.tsx` | Formulario, exito, reintentos |
| `src/app/api/onboarding/checklist/route.test.ts` | PATCH: auth, validaciones, fallos |
| `src/components/dashboard/OnboardingChecklist.test.tsx` | Pasos, progreso, descarte, force show |
| `src/app/dashboard/page.test.tsx` | Puerta a `/onboarding` (regresion) |

No hay test de `src/lib/onboarding-service.ts` en si: su comportamiento se
cubre desde la pagina y desde los tests de metricas (`track-event`), y es el
hueco mas util de cerrar si se toca esa funcion.

## Verificacion rapida

```bash
npx vitest run src/app/onboarding src/components/dashboard/OnboardingChecklist.test.tsx src/app/dashboard/page.test.tsx src/app/api/onboarding
```
