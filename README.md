This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
# vynko

## Cambiar el precio de los planes (inflación)

Los precios viven en un único lugar: `src/lib/prices.json`. Cambiar el precio ahí actualiza las suscripciones **nuevas**; para que los clientes existentes pasen a pagar el nuevo monto en el siguiente cobro, hay que sincronizar en Mercado Pago con el script `update-prices`.

### 1. Editar el precio

En `src/lib/prices.json`, actualizá el plan que quieras:

```json
{
  "starter": 19900,
  "business": 34900,
  "enterprise": 0
}
```

### 2. Revisar qué se va a actualizar

```bash
npm run update-prices -- --dry-run
```

Muestra los tenants activos, su plan y el monto destino, sin modificar nada.

### 3. Aplicar

```bash
npm run update-prices
```

El nuevo monto aplica al **siguiente cobro recurrente**. Es recomendable avisar a los clientes del aumento.

### Comandos útiles

| Comando | Qué hace |
| --- | --- |
| `npm run update-prices` | Actualiza el monto de todas las suscripciones activas según `prices.json` |
| `npm run update-prices -- --dry-run` | Simula sin aplicar cambios |
| `npm run update-prices -- --business=39900` | Sobreescribe el precio de un plan solo para esta corrida |
| `npm run update-prices -- --backfill` | Recupera el id de preaprobación de clientes activos que no lo tengan guardado (necesario una vez al migrar la columna, o si se dieron de alta antes del webhook) |

### Tests

Los tests corren con [Vitest](https://vitest.dev). Están separados del código de producción: cada suite vive en un archivo `*.test.ts` al lado del módulo o ruta que cubre, y el mock de Supabase está en `src/test/supabase-mock.ts`.

### Correr toda la suite

```bash
npm run test:run
```

### Modo watch (se re-ejecutan al guardar)

```bash
npm run test:run -- --watch
```

### Correr un archivo o grupo

```bash
npm run test:run -- src/lib/stock.test.ts
npm run test:run -- src/app/api/products/route.test.ts
```

### Ver cobertura

```bash
npm run test:run -- --coverage
```

Los tests no requieren base de datos ni variables de entorno: las rutas API se prueban con un mock encadenable de `supabaseAdmin`.

#### Suites de Vitest

- `src/lib/mercadopago.test.ts` — Verificación de firma HMAC-SHA256 de webhooks de MercadoPago (10 tests)
- `src/app/api/webhooks/mercadopago/route.test.ts` — Handler de webhooks: autorizado, cancelado, pausado, firma inválida (12 tests)
- `src/lib/checkSubscription.test.ts` — Lógica de bloqueo de suscripción por trial vencido / pago vencido (15 tests)
- `src/proxy.test.ts` — Middleware: auth, onboarding, subscription gate (9 tests)
- `src/app/api/settings/tenant/route.test.ts` — Guard owner-only de PATCH /api/settings/tenant (6 tests)
- `src/app/api/activity-logs/route.test.ts` — Guard owner/manager de GET /api/activity-logs (6 tests)

### Tests E2E (Playwright)

Los E2E corren con [Playwright](https://playwright.dev) contra la app real levantada en el puerto 3000 (la levanta sola). Viven en `e2e/`.

#### Correr todos los tests E2E

```bash
npm run test:e2e
```

#### Modo interactivo (UI con inspector)

```bash
npm run test:e2e:ui
```

#### Modo headed (ver navegador mientras se ejecutan)

```bash
npx playwright test --headed
```

#### Correr un archivo específico

```bash
npx playwright test e2e/login.spec.ts
npx playwright test e2e/products.spec.ts
npx playwright test e2e/sales.spec.ts
npx playwright test e2e/stock.spec.ts
npx playwright test e2e/onboarding.spec.ts
npx playwright test e2e/sucursales.spec.ts
npx playwright test e2e/dashboard.spec.ts
npx playwright test e2e/sales-history.spec.ts
npx playwright test e2e/import-export.spec.ts
npx playwright test e2e/billing.spec.ts
npx playwright test e2e/permissions.spec.ts
```

#### Correr un solo test por nombre

```bash
npx playwright test --grep "login exitoso"
npx playwright test --grep "crear producto"
npx playwright test --grep "buscar"
npx playwright test --grep "dashboard carga correctamente"
npx playwright test --grep "historial"
npx playwright test --grep "importar"
npx playwright test --grep "billing"
npx playwright test --grep "planes"
npx playwright test --grep "permisos"
npx playwright test --grep "member"
npx playwright test --grep "owner"
```

#### Correr tests con un solo worker (serial)

Todos los specs comparten la misma base y mutan datos (crear/editar/eliminar
productos, ajustar stock), por lo que el config ya corre todo en serie con
`workers: 1`. También se puede forzar explícitamente:

```bash
npx playwright test --workers=1
```

#### Listar todos los tests disponibles

```bash
npx playwright test --list
```

#### Batería de tests disponible

**Autenticación** (`e2e/login.spec.ts`):
- Muestra el formulario de login
- Login con credenciales inválidas
- Login exitoso → redirección a dashboard
- Campos obligatorios (error si están vacíos)
- Logout → redirección a login
- Usuario no autenticado → redirección a login
- Sesión persiste al recargar página

**Productos** (`e2e/products.spec.ts`):
- Listar productos (tabla visible + columnas correctas)
- Buscar producto (filtrar y limpiar búsqueda)
- Crear producto exitoso
- Crear producto con datos inválidos
- Editar producto
- Eliminar/desactivar producto
- Producto desactivado no usable en venta
- Filtrar productos por categoría

**Onboarding** (`e2e/onboarding.spec.ts`):
- Usuario nuevo sin empresa es redirigido a onboarding

**Ventas** (`e2e/sales.spec.ts`):
- Setup: crea productos con precios y stock conocidos
- Flujo completo: buscar, agregar al carrito, modificar cantidad, verificar subtotal/total, confirmar, venta exitosa, carrito vacío y stock actualizado
- Venta de varios productos: total sumado y stock descontado de cada uno
- Modificar cantidad (subir/bajar) y eliminar producto del carrito
- Cancelar una venta (salir sin confirmar): no se registra nada
- Intentar vender sin stock suficiente: error y stock sin cambios; producto sin stock deshabilitado
- Vender hasta agotar stock: stock 0, badge crítico y tarjeta deshabilitada
- Historial: las ventas aparecen en "Últimas Ventas" con su detalle (items, cantidades, total)
- Cleanup: borra las ventas de prueba (service role, por la FK de `sale_items`) y los productos

> Nota: la caja (`/sales`) hace fetch sin el header `x-active-tenant-id`, así que
> opera sobre la primera sucursal del usuario. En un contexto nuevo de Playwright
> `/products` usa esa misma sucursal por defecto, por lo que los tests son
> consistentes sin cambiar de sucursal.

**Stock** (`e2e/stock.spec.ts`):
- Setup: crea un producto con stock inicial para las pruebas
- Visualizar stock actual (badge de estado)
- Aumentar stock (ajuste con motivo que suma)
- Disminuir stock (ajuste con motivo que resta)
- Verificación de actualización en tabla e historial de `/loss-prevention`
- Retirar más stock del disponible → error y stock sin cambios
- Stock 0 → badge crítico y no permite negativos
- Stock crítico/bajo se reflejan en badges y filtros
- Aislamiento de stock por sucursal
- Cleanup: elimina el producto de prueba

**Dashboard** (`e2e/dashboard.spec.ts`):
- Setup: verifica múltiples sucursales y crea producto de prueba
- Dashboard carga correctamente: saludo, nombre de sucursal, 4 tarjetas KPI, botones de acción
- Dashboard muestra la sucursal activa correcta: coincide con sidebar, cambia al switchear sucursal
- Datos principales: cada tarjeta KPI (Ventas hoy, Ingresos del mes, Stock crítico, Estado) muestra un valor
- Después de una venta los indicadores se actualizan: de "Sin ventas" a tener ventas, estado cambia
- Cambio de sucursal muestra datos diferentes: Branch A con ventas vs Branch B sin ventas, aislamiento verificado
- Cleanup: elimina productos de prueba

**Stock** (`e2e/stock.spec.ts`):
- Setup: crea un producto con stock inicial para las pruebas
- Visualizar stock actual (badge de estado)
- Aumentar stock (ajuste con motivo que suma)
- Disminuir stock (ajuste con motivo que resta)
- Verificación de actualización en tabla e historial de `/loss-prevention`
- Retirar más stock del disponible → error y stock sin cambios
- Stock 0 → badge crítico y no permite negativos
- Stock crítico/bajo se reflejan en badges y filtros
- Aislamiento de stock por sucursal
- Cleanup: elimina el producto de prueba

**Historial de ventas** (`e2e/sales-history.spec.ts`):
- Setup: crea dos productos de prueba con precios conocidos
- Ver historial: sección "Últimas Ventas" se expande y muestra tabla con columnas Folio/Cliente/Productos/Total/Fecha
- Registrar ventas de prueba para tener datos en el historial
- Venta recién creada aparece en el historial con total y cantidad correctos
- Abrir detalle de venta: click en fila muestra panel con folio y badge "Completada"
- Ver total: el total de la venta aparece formateado en verde en el detalle
- Ver productos vendidos: tabla de items muestra ambos productos con cantidades, precios unitarios y subtotales
- Ver fecha: formato dd/mm/yyyy en la tabla y formato largo "dd de month de yyyy" en el detalle
- Ver cliente o "Mostrador" tanto en la tabla como en el detalle
- Cleanup: borra ventas y productos de prueba

**Importación / Exportación** (`e2e/import-export.spec.ts`):
- Importar archivo válido: crea productos con SKU, precio, stock y categoría
- Importar archivo sin columna nombre: omite filas sin nombre requerido
- Rechazar archivo inválido (.txt): muestra toast de error
- Importar archivo vacío: muestra toast de "vacío"
- Exportar productos: genera .xlsx con columnas Nombre, SKU, Precio Venta, Stock
- Info de columnas aceptadas: panel de ayuda muestra todas las columnas válidas
- Cleanup: elimina productos importados

**Facturación / Mercado Pago** (`e2e/billing.spec.ts`):
- Billing page muestra planes, precios ARS y features
- Plan actual con badge y nombre visible
- Checkout Starter: intercepta redirect a MercadoPago (sin pago real)
- Checkout Business: intercepta redirect a MercadoPago (sin pago real)
- Sin sesión: redirige a login
- Cancelar suscripción: modal de confirmación → API → toast éxito
- Downgrade Business a Starter: modal de warning con feature loss
- Billing status API: retorna plan, status y features
- Billing status sin autenticación: retorna 401
- Enterprise: botón "Próximamente" deshabilitado
- Link de soporte visible
- Cleanup: restaura tenant a free/starter

**Permisos y Roles** (`e2e/permissions.spec.ts`):
- Owner: sidebar muestra todos los nav items
- Owner: puede acceder a /billing, /settings, /activity-logs
- Member: sidebar NO muestra Pronóstico, Historial, Planes, Configuración
- Member: sidebar SÍ muestra Dashboard, Ventas, Productos, Proveedores, Clientes, Documentos
- Member: /billing redirige a /dashboard
- Member: /settings redirige a /dashboard
- Member: /activity-logs muestra "No tienes permisos"
- Member: /forecast redirige a /dashboard
- Member: GET /api/activity-logs retorna 403
- Member: GET /api/settings/collaborators retorna 403
- Member: PATCH /api/settings/tenant retorna 403

> Nota: los tests de billing interceptan la redirección a MercadoPago con
> `page.route()` para evitar pagos reales. Las API routes internas se testean
> contra el servidor real pero sin completar el flujo de pago.

#### Requisitos

- Primera vez: `npx playwright install chromium`.
- Los tests que usan credenciales reales leen `E2E_USER_EMAIL` y `E2E_USER_PASSWORD` desde `.env.local` (ya están configurados para el usuario de prueba). Si faltan, ese test se salta.
- Los tests de permisos usan `E2E_MEMBER_USER_EMAIL` y `E2E_MEMBER_USER_PASSWORD` para autenticar un usuario con rol member.
- El `webServer` del config levanta `npm run dev` automáticamente; si ya tenés el server corriendo en `:3000`, reutiliza esa instancia.

#### Helpers y Fixtures

Los tests de productos, stock y ventas usan helpers reutilizables definidos en `e2e/fixtures.ts`:
- `authenticatedPage`: Fixture que proporciona una página autenticada (se autentica una sola vez)
- `memberPage`: Fixture que proporciona una página autenticada como usuario member (se autentica una sola vez)
- `getSidebarNavItems()`: Leer los items de navegación visibles en el sidebar desktop
- `createProductViaUI()`: Crear producto llenando formulario
- `editProductViaUI()`: Editar producto
- `deleteProductViaUI()`: Eliminar producto con confirmación
- `searchProduct()`: Buscar en listado
- `filterByCategory()`: Filtrar por categoría
- `countProductsInTable()`: Contar filas en tabla
- `isProductVisibleInTable()`: Verificar si producto está visible
- `getStockInfo()`: Leer stock y badge de estado de un producto
- `adjustStockViaLossPrevention()`: Aplicar un ajuste de stock vía `/loss-prevention`
- `getCurrentTenantName()` / `getTenantNames()`: Leer la sucursal activa y las disponibles
- `switchTenantByName()`: Cambiar de sucursal desde el sidebar
- `formatARSTest()`: Formatear pesos (es-AR) para comparar totales del checkout
- `addProductToCart()` / `getCartItem()`: Agregar un producto al carrito de `/sales` y obtener su ítem
- `openSalesHistory()` / `getNewestSaleRowText()`: Abrir "Últimas Ventas" y leer la venta más reciente
- `cleanupSalesData()`: Borrar ventas (service role) y productos de prueba de la batería de ventas
- `mockMercadoPagoCheckout()`: Interceptar redirect a MercadoPago para evitar pagos reales
- `cleanupBillingData()`: Restaurar estado de billing del tenant vía service role

#### Prerequisitos adicionales

- La columna `mercadopago_preapproval_id` debe existir en la tabla `tenants` (migración `migrations/008_mercadopago.sql`).
- Variables en `.env.local`: `MERCADOPAGO_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL` (y `NEXT_PUBLIC_CURRENCY`, por defecto `ARS`).
- El webhook de Mercado Pago debe apuntar a `/api/webhooks/mercadopago` para que las suscripciones nuevas guarden su id de preaprobación.

