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
| `/importar-productos-mercadolibre-tiendanube` | Importar productos de Mercado Libre o Tiendanube \| Vynko | Importá tu catálogo de Mercado Libre o Tiendanube | "importar productos de Mercado Libre", "migrar catálogo Tiendanube" | Publicada |
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

### `/importar-productos-mercadolibre-tiendanube`
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

## Diagnóstico de indexación (2026-10-22)

Search Console reportó "Descubierta: actualmente sin indexar" con motivo
"Excluida por una etiqueta 'noindex'" para las landings, las legales, `/login` y
`/auth/signup`, **todas con "Último rastreo: N/D"**. "N/D" significa que Google
**nunca las rastreó**: la URL fue descubierta (por enlaces internos o por el
sitemap) pero nunca llegó a rastrearse. Para una URL nunca rastreada, Google no
puede leer el `<meta name="robots">` de esa página, así que el motivo que
muestra es el agregado del sitio, no una directiva real de esa URL.

**Verificado contra producción (`vynko.dev`):**

- Las 6 landings, la home y las 4 legales devuelven `200`, con `<title>`,
  `canonical` y `description` propios, y **sin** `<meta name="robots">` ni
  `X-Robots-Tag`.
- `/login` y `/auth/signup` devuelven `noindex, follow`: es intencional.
- Googlebot recibe exactamente el mismo HTML que un navegador (verificado con
  seis user-agents distintos).
- El sitio **no está indexado en ningún motor**: ni Google, ni Bing, ni
  DuckDuckGo, ni Common Crawl devuelven resultados para `site:vynko.dev`.
- El dominio `vynko.dev` se registró el 2026-09-02: tiene 7 semanas.

Conclusión: el bloqueo **no es un `noindex` en el código** (no existe en
ninguna versión del repo salvo `/login` y `/auth/signup`); es que **Google
todavía no rastrea el sitio**. La etiqueta `noindex` del reporte es la de las
dos únicas páginas con `noindex` que hay en el sitio, que es lo único que
Google pudo leer.

**Acciones:**

1. ~~Mergear el PR de SEO y reenviar el sitemap desde Search Console.~~
   Hecho (PR #125 y #126 mergeados; sitemap reenviado el 2026-10-22).
2. ~~Pedir la indexación de la home y de las landings desde la URL Inspection.~~
   Hecho para la home (validación "Iniciada" el 2026-10-22). **Falta pedirla
   landing por landing**: la URL Inspection es una URL por vez, y las 6 landings
   son las que van a posicionar.
3. ~~Revisar en Vercel que no haya un Firewall con Bot Protection bloqueando a
   Googlebot.~~ Descartado empíricamente: `HEAD https://vynko.dev/` devuelve
   `200` sin `X-Robots-Tag` ni `x-vercel-protection-bypass`, y un `GET` con
   `User-Agent: Googlebot` recibe el HTML completo (no un 403 ni un challenge).
   El Firewall de Vercel bloquea bots de IA, no buscadores, y por diseño no
   bloquea a Googlebot.
4. **Pendiente:** revisar en Search Console → *Estadísticas de rastreo* que
   Googlebot no esté recibiendo errores o 5xx.
5. **Pendiente:** tener la propiedad de Search Console registrada también como
   tipo **Dominio** (`vynko.dev`), no solo como prefijo de URL. Cubre todos los
   subdominios y los dos protocolos.
6. **Pendiente:** conseguir backlinks. Un dominio de 7 semanas sin enlaces
   entrantes no recibe presupuesto de rastreo. Es la causa probable más fuerte
   de que Google no rastree el sitio todavía.
7. **Pendiente:** validar las consultas de la sección "Consultas pendientes"
   antes de abrir cualquier landing nueva.

**Guardas agregadas en código** (para que esto no se repita en silencio):

- `robotsForPath()` decide el `robots` de cada ruta y se declara **siempre**
  (también `index: true` en las indexables): ya no queda en manos de un default
  silencioso de Next.
- El `X-Robots-Tag` del proxy solo se aplica con `VERCEL_ENV === 'preview'`.
  Con `!== 'production'`, cualquier entorno donde esa variable no estuviera
  definida (self-host, `next start` propio) dejaba **todo el sitio** con
  `noindex`.
- Las landings declaran `robots: { index: true, follow: true }` explícito.
- Tests que atan sitemap, robots.txt y la clasificación de rutas: ninguna URL
  publicada en el sitemap puede ser noindexable ni estar bloqueada por
  robots.txt.

## Re-verificación (2026-10-26)

Search Console volvió a notificar "Excluida por una etiqueta 'noindex'", ahora
con **2 páginas**. No es una regresión: son exactamente las dos únicas páginas
noindexables que Google ya rastreó.

Verificado contra producción (`vynko.dev`):

| URL | Estado | `robots` |
| --- | --- | --- |
| `/login` | 200 | `noindex, follow` (intencional) |
| `/auth/signup` | 200 | `noindex, follow` (intencional) |
| `/` | 200 | `index, follow` |
| `/control-de-stock` (y las otras 5 landings) | 200 | `index, follow` |
| `/privacidad`, `/terminos`, `/reembolsos`, `/cookies` | 200 | `index, follow` |

El resto del reporte también es esperable en un dominio de 8 semanas:

- **Página con redirección (3):** `/dashboard`, `/onboarding` y `/settings`
  devuelven `307 → /login?redirect_to=...`. Van `Disallow` en robots.txt y solo
  son alcanzables con sesión; el redirect es el gate de auth, no un error SEO.
- **Descubierta: actualmente sin indexar (7):** URLs del sitemap que Google
  todavía no rastreó. Se resuelve con tiempo, sitemap reenviado y backlinks.
- **Rastreada: actualmente sin indexar (0):** ninguna página indexable está
  siendo rechazada. Es la señal de que el contenido publicado sí es indexable.

Regla para leer este reporte: el motivo "Excluida por noindex" solo es un
problema si aparece en una URL que está en `sitemap.xml` o que debería
posicionar. Para `/login` y `/auth/signup` el estado es correcto y el aviso va a
seguir apareciendo mientras esas páginas conserven el `noindex`: no hay un botón
de "marcar como intencional" que lo silencie. Lo que importa es que crezca el
número de páginas indexadas: el reporte suma 12 páginas no indexadas (3 + 2 + 7)
y ninguna de ellas es una landing ni una legal.
