# Mapa de keywords SEO

Que busca cada página y qué tiene que responder. Sirve para decidir dónde escribir
la próxima landing y para revisar el copy cuando una consulta no posiciona.

**Importante:** las consultas de abajo son hipótesis de trabajo, no demanda
confirmada. La única fuente de verdad sobre qué busca la gente es Google Search
Console (Informes > Rendimiento > Consultas). Antes de crear una página nueva
para una consulta, hay que verificar en Search Console que existe volumen y que
no estamos compitiendo con nuestra propia landing.

## Landings publicadas

| Ruta | Title (`<title>` final) | H1 | Consulta objetivo | Estado |
|---|---|---|---|---|
| `/` | Vynko \| Sistema de gestión de stock y ventas para comercios | Sistema de gestión de stock y ventas para comercios | "sistema de gestión para comercios", "software de stock" | Genérica / marca |
| `/control-de-stock` | Control de stock e inventario en tiempo real \| Vynko | Control de stock para tu negocio: inventario en tiempo real | "cómo controlar el stock", "control de stock para comercios" | Publicada |
| `/ventas-y-caja` | Sistema de ventas y caja para pequeños comercios \| Vynko | Sistema de ventas y caja para pequeños comercios | "programa para controlar ventas y caja", "sistema de ventas" | Publicada |
| `/alternativa-a-excel` | Sistema de gestión para reemplazar Excel \| Vynko | Dejá Excel: un sistema de gestión que se actualiza solo | "cómo llevar inventario sin Excel", "alternativa a Excel" | Publicada |
| `/software-gestion-argentina` | Sistema de gestión para pequeños comercios en Argentina \| Vynko | Sistema de gestión para pequeños comercios en Argentina | "sistema de gestión para pequeños comercios en Argentina" | Publicada |
| `/importar-productos-mercadolibre-tiedenube` | Importar productos de Mercado Libre o Tiendanube \| Vynko | Importá tu catálogo de Mercado Libre o Tiendanube | "importar productos de Mercado Libre", "migrar catálogo Tiendanube" | Publicada |
| `/control-de-compras` | Control de compras y proveedores para tu negocio \| Vynko | Registrá compras, ventas y stock en un solo lugar | "cómo registrar compras, ventas y stock en un solo lugar" | Nueva |

## Consultas cubiertas por cada landing

Cada landing tiene una sección "Cómo hacer X" (`howToTitle` / `howTo`) que
responde la consulta informativa con pasos concretos. Son las que más chances
tienen de entrar en el bloque de respuesta de Google.

### `/control-de-stock`
- cómo controlar el stock de un negocio
- cómo saber cuánto stock tengo sin contar
- cómo evitar que se agote un producto
- cómo controlar el stock de varios depósitos

### `/ventas-y-caja`
- cómo registrar una venta
- cómo cerrar la caja del día
- cómo usar un lector de código de barras
- cómo saber cuánto vendí hoy

### `/alternativa-a-excel`
- cómo llevar el inventario sin Excel
- cómo dejar de usar Excel para el stock
- cómo migrar una planilla a un sistema
- cómo evitar errores de fórmulas

### `/software-gestion-argentina`
- sistema de gestión para pequeños comercios en Argentina
- software de gestión para PyMEs argentinas
- cómo controlar varias sucursales
- precios en pesos y soporte en español

### `/importar-productos-mercadolibre-tiedenube`
- cómo importar productos de Mercado Libre
- cómo pasar el catálogo de Tiendanube a otro sistema
- cómo cargar productos con código de barras sin tipear

### `/control-de-compras`
- cómo registrar compras de proveedores
- cómo llevar el control de compras y stock
- cómo saber cuánto le compré a cada proveedor
- cómo actualizar el stock cuando llega la mercadería

## Consultas pendientes (no crear página sin validar)

Estas aparecen en brainstormings pero **no** tienen página propia. Antes de
abrirlas, revisar Search Console:

- "sistema de inventario para/freezer" → encaja con `/control-de-stock`
- "programa de punto de venta" → encaja con `/ventas-y-caja`
- "control de clientes y fidelización" → hoy no hay landing de clientes
- "sistema de facturación electrónica" → módulo futuro, no es una landing
- "app para consultar el inventario con el celular" → encaja con `/control-de-stock`

Regla práctica: si la consulta se resuelve con un párrafo de la sección
"cómo hacer X" de una landing existente, se agrega ahí. Solo se abre una página
nueva cuando la consulta necesita su propia Comparativa, su propia FAQ y su
propio CTA.

## Enlazado interno

- La home tiene la sección `#soluciones`, que linkea a todas las landings.
- Cada landing tiene una sección "Otras soluciones de Vynko" (`related`) con
  tres enlaces contextuales a landings relacionadas.
- El footer de la home y de cada landing lista todas las landings.
- Los enlaces internos se declaran por `slug` (ver `SeoRelatedLink` en
  `src/lib/marketing/seo-landing.ts`), nunca por URL escrita a mano.

## Cómo se mantiene

- El registro de landings vive en `src/lib/marketing/public-routes.ts`
  (`SEO_LANDING_PAGES`). Ahí van `slug`, `label`, `summary` y `lastModified`.
- Al agregar una landing: entrada en el registro + `src/app/<slug>/page.tsx` +
  `src/app/<slug>/opengraph-image.tsx` + copy de `SeoLandingContent`.
- `lastModified` es la fecha del último cambio de contenido. Se toca cuando se
  edita el copy, no en cada build.
- `src/lib/marketing/seo-landing-content.test.ts` verifica que toda landing del
  registro tenga los textos completos, la guía con pasos, la comparativa con
  filas y los enlaces internos apuntando a landings reales.
