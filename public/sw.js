// Vynko Service Worker - necesario para que el navegador (Chrome/Android)
// considere la PWA como instalable y muestre el banner de "Agregar a pantalla
// de inicio" / "Instalar". Estrategia:
//   - La navegación (documento y payloads RSC de Next.js App Router) SIEMPRE
//     va a red: así cada cambio de pantalla trae contenido fresco y no parece
//     que la app "se traba" con datos viejos hasta forzar F5.
//   - Solo se cachean assets estáticos (chunks con hash, íconos, manifest).
//   - Las peticiones a la API y con token Authorization se excluyen para
//     evitar leak de datos entre cuentas.
const CACHE_NAME = 'vynko-assets-v3';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('vynko-assets-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    request.headers.get('Authorization')
  ) {
    return;
  }

  // Payloads de navegación cliente de Next.js App Router (RSC/flight y
  // prefetch). Cachearlos devolvía contenido viejo al cambiar de pestaña, que
  // se veía como una pantalla "trabada" que solo se arreglaba con F5. Nunca
  // se interceptan: siempre van a red.
  const isNavigationBody =
    request.headers.get('RSC') === '1' ||
    request.headers.get('Next-Router-Prefetch') ||
    request.headers.get('Next-Router-State-Tree') ||
    request.headers.get('Next-Url') ||
    request.headers.get('Sec-Fetch-Dest') === 'empty';
  if (isNavigationBody) return;

  // Navegación completa del documento: network-first con fallback offline al
  // shell cacheado.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/'))
    );
    return;
  }

  // Assets estáticos con hash (/_next/static/...), íconos y manifest.
  const isStaticAsset =
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.json';
  if (!isStaticAsset) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const fetchPromise = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});