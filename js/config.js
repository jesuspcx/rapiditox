/**
 * Configuración de despliegue de Rapidito.
 * Aquí no vive ninguna ruta: la red se carga desde data/rutas.json.
 *
 * Para producción, apunta `nominatim.baseUrl` y `osrm.baseUrl` a un proxy
 * propio (ver ARCHITECTURE.md). Las políticas de uso de los servicios públicos
 * no permiten convertirlos en backend de una app con tráfico real.
 */
export const APP_CONFIG = Object.freeze({
  version: '0.3.8',

  city: Object.freeze({
    name: 'Barquisimeto',
    region: 'Estado Lara · Municipio Iribarren',
    countryCode: 've',
    center: [-69.3164, 10.0680], // [lon, lat] · centro de Barquisimeto
    zoom: 13,
    searchViewbox: '-69.50,10.18,-69.15,9.95',
  }),

  data: Object.freeze({
    routesUrl: './data/rutas.json',
    placesUrl: './data/lugares.json',
  }),

  storage: Object.freeze({
    prefix: 'rapidito',
    themeKey: 'rapidito:theme',
    recentPlacesKey: 'rapidito:recent-places:bqto:v1',
    rateCacheKey: 'rapidito:rate:bcv:v1',
    placeCacheKey: 'rapidito:places-cache:bqto:v1',
  }),

  nominatim: Object.freeze({
    baseUrl: 'https://nominatim.openstreetmap.org',
    language: 'es',
    limit: 6,
    minQueryLength: 3,
    debounceMs: 900,
    minIntervalMs: 1100,
    cacheTtlMs: 24 * 60 * 60 * 1000,
    // Obligatorio para un despliegue propio de Nominatim / proxy.
    contactEmail: '',
  }),

  osrm: Object.freeze({
    // Servidor público de demostración. En producción usa instancia propia
    // con perfil `foot` (el demo público enruta con perfil de coche).
    baseUrl: 'https://router.project-osrm.org',
    profile: 'foot',
    timeoutMs: 9000,
  }),

  dolarApi: Object.freeze({
    baseUrl: 'https://ve.dolarapi.com/v1/dolares/oficial',
    timeoutMs: 9000,
    staleAfterMs: 30 * 60 * 1000,
    refreshAfterMs: 10 * 60 * 1000,
  }),

  fares: Object.freeze({
    // Tarifas fijas del pasaje. El monto final en Bs. se calcula
    // multiplicándolas por la tasa oficial BCV en cada render.
    normalUsd: 0.25,
    studentUsd: 0.125,
  }),

  routing: Object.freeze({
    maxWalkToStopM: 700,
    maxWalkFromStopM: 650,
    minWalkOnlyM: 650,
    minRideM: 250,
    minTransferM: 350,
    walkSpeedKmh: 4.8,
    busSpeedKmh: 17,
    dwellSecondsPerStop: 18,
    defaultFrequencyMin: 12,
    walkDetourFactor: 1.22,
    maxCandidates: 3,
  }),

  map: Object.freeze({
    tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 19,
    minZoom: 11,
    attribution: '© OpenStreetMap',
  }),

  demo: Object.freeze({
    origin: [-69.3214309, 10.0736310], // Catedral de Barquisimeto
    label: 'Centro de Barquisimeto (muestra)',
  }),
});

export const STORAGE_KEYS = APP_CONFIG.storage;
