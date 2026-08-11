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

## Prerrequisitos

- La columna `mercadopago_preapproval_id` debe existir en la tabla `tenants` (migración `migrations/008_mercadopago.sql`).
- Variables en `.env.local`: `MERCADOPAGO_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL` (y `NEXT_PUBLIC_CURRENCY`, por defecto `ARS`).
- El webhook de Mercado Pago debe apuntar a `/api/webhooks/mercadopago` para que las suscripciones nuevas guarden su id de preaprobación.

