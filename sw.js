/**
 * Rapidito · service worker
 *
 * Estrategia:
 *  - App shell: precacheado en la instalación.
 *  - Navegación: red primero, índice cacheado como respaldo.
 *  - Datos de la ciudad: red primero, copia local para offline.
 *  - Estáticos propios: cache primero + revalidación en segundo plano.
 *  - Tiles OSM: solo los ya visitados, con tope de entradas.
 *
 * Los servicios externos (Nominatim, OSRM, DolarAPI) NO se cachean aquí:
 * las búsquedas no se almacenan en el service worker y la tasa se guarda en
 * localStorage desde la app.
 */

const VERSION = '0.3.8';
const SHELL_CACHE = `rapidito-shell-v${VERSION}`;
const TILE_CACHE = `rapidito-tiles-v${VERSION}`;
const TILE_LIMIT = 180;
const CACHE_PREFIX = 'rapidito-';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/api.js',
  './js/config.js',
  './js/geo.js',
  './js/map.js',
  './js/money.js',
  './js/router.js',
  './js/theme-init.js',
  './js/ui.js',
  './data/rutas.json',
  './data/lugares.json',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
  './assets/icons/logo-rapidito.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/rapidito-icon.svg',
];

const TILE_HOSTS = new Set([
  'tile.openstreetmap.org',
  'a.tile.openstreetmap.org',
  'b.tile.openstreetmap.org',
  'c.tile.openstreetmap.org',
]);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(APP_SHELL.map(async (url) => {
      const request = new Request(url, { cache: 'reload' });
      const response = await fetch(request);
      if (!response.ok) {
        throw new Error(`No se pudo precachear ${url}: ${response.status}`);
      }
      await cache.put(request, response);
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && ![SHELL_CACHE, TILE_CACHE].includes(key))
        .map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function trimTileCache() {
  const cache = await caches.open(TILE_CACHE);
  const keys = await cache.keys();
  if (keys.length <= TILE_LIMIT) return;

  const excess = keys.length - TILE_LIMIT;
  await Promise.all(keys.slice(0, excess).map((request) => cache.delete(request)));
}

async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      const indexUrl = new URL('./index.html', self.registration.scope);
      await cache.put(indexUrl, response.clone());
    }
    return response;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match(new URL('./index.html', self.registration.scope), {
      ignoreSearch: true,
    })) || (await cache.match('./')) || new Response(
      '<!doctype html><html lang="es"><meta charset="utf-8"><title>Rapidito offline</title><body style="font-family:system-ui;padding:2rem;background:#07142E;color:#F4F7FF"><h1>Rapidito</h1><p>Esta copia aún no está disponible sin conexión. Abre la app una vez con internet.</p></body></html>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}

async function handleData(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    return new Response(JSON.stringify({
      error: 'offline',
      message: 'Los datos de la ciudad aún no están guardados en este dispositivo.',
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

async function handleStatic(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) {
    // Revalida sin bloquear la respuesta ya cacheada.
    fetch(request)
      .then(async (response) => {
        if (response.ok) {
          const cache = await caches.open(SHELL_CACHE);
          await cache.put(request, response.clone());
        }
      })
      .catch(() => {});
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Recurso no disponible sin conexión.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function handleTile(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') {
      await cache.put(request, response.clone());
      trimTileCache().catch(() => {});
    }
    return response;
  } catch {
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!['http:', 'https:'].includes(url.protocol)) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (TILE_HOSTS.has(url.hostname)) {
    event.respondWith(handleTile(request));
    return;
  }

  if (url.origin !== self.location.origin) return;

  const pathname = url.pathname;
  if (pathname.endsWith('/data/rutas.json') || pathname.endsWith('/data/lugares.json')) {
    event.respondWith(handleData(request));
    return;
  }

  const destination = request.destination;
  if (['script', 'style', 'image', 'font', 'manifest'].includes(destination)) {
    event.respondWith(handleStatic(request));
  }
});
