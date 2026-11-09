/**
 * Rapidito · adaptadores de datos externos
 *
 * - rutas/lugares: JSON locales de la ciudad (la app no hardcodea la red).
 * - Nominatim: búsqueda y geocodificación inversa.
 * - OSRM: geometría del tramo peatonal.
 * - DolarAPI: tasa oficial BCV.
 *
 * Los servicios públicos se usan con límites conservadores y caché. Para
 * producción hay que sustituirlos por instancias/proxy propios.
 */

import { APP_CONFIG, STORAGE_KEYS } from './config.js';
import { distanceMeters, isValidCoord } from './geo.js';

export class ApiError extends Error {
  constructor(message, { code = 'api', status = 0, cause = null, retryable = true } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.cause = cause;
    this.retryable = retryable;
  }
}

function abortError(message = 'Solicitud cancelada.') {
  return new ApiError(message, { code: 'aborted', retryable: false });
}

export function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'aborted';
}

function safeReadJson(key, fallback = null) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeWriteJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      window.clearTimeout(timer);
      reject(abortError());
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchJson(url, { signal, timeoutMs = 10000, headers = {} } = {}) {
  if (signal?.aborted) throw abortError();

  const controller = new AbortController();
  let timedOut = false;
  let onAbort = null;

  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  if (signal) {
    onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...headers,
      },
    });

    if (!response.ok) {
      throw new ApiError(
        response.status === 429
          ? 'El servicio está recibiendo muchas consultas. Intenta de nuevo en unos segundos.'
          : `El servicio respondió con un error (${response.status}).`,
        { code: 'http', status: response.status, retryable: response.status !== 404 },
      );
    }

    return await response.json();
  } catch (error) {
    if (timedOut) {
      throw new ApiError('La conexión tardó demasiado. Revisa tu internet e inténtalo otra vez.', {
        code: 'timeout',
        cause: error,
      });
    }
    if (isAbortError(error)) throw abortError();
    if (error instanceof ApiError) throw error;
    throw new ApiError('No pudimos conectar con el servicio. Revisa tu conexión.', {
      code: 'network',
      cause: error,
    });
  } finally {
    window.clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

/* ------------------------------------------------------------------ */
/* Red local de la ciudad                                              */
/* ------------------------------------------------------------------ */

export async function fetchRoutes({ signal } = {}) {
  try {
    const data = await fetchJson(APP_CONFIG.data.routesUrl, { signal, timeoutMs: 12000 });
    return data;
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(
      'No pudimos cargar la red de rutas. Comprueba que data/rutas.json esté disponible.',
      { code: 'routes', cause: error },
    );
  }
}

export async function fetchPlaces({ signal } = {}) {
  try {
    const data = await fetchJson(APP_CONFIG.data.placesUrl, { signal, timeoutMs: 10000 });
    return data;
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError('No pudimos cargar los destinos sugeridos.', {
      code: 'places',
      cause: error,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Nominatim                                                           */
/* ------------------------------------------------------------------ */

let nominatimQueue = Promise.resolve();
let lastNominatimRequestAt = 0;
const NOMINATIM_CACHE_LIMIT = 30;

function readPlaceCache() {
  const cache = safeReadJson(STORAGE_KEYS.placeCacheKey, {});
  return cache && typeof cache === 'object' ? cache : {};
}

function writePlaceCache(cache) {
  const entries = Object.entries(cache)
    .sort(([, a], [, b]) => (b?.savedAt ?? 0) - (a?.savedAt ?? 0))
    .slice(0, NOMINATIM_CACHE_LIMIT);
  safeWriteJson(STORAGE_KEYS.placeCacheKey, Object.fromEntries(entries));
}

function normalizeQuery(query) {
  return String(query ?? '').trim().toLocaleLowerCase('es-VE').replace(/\s+/g, ' ');
}

function buildNominatimUrl(path, params) {
  const url = new URL(path, `${APP_CONFIG.nominatim.baseUrl}/`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') {
      url.searchParams.set(key, value);
    }
  }
  if (APP_CONFIG.nominatim.contactEmail) {
    url.searchParams.set('email', APP_CONFIG.nominatim.contactEmail);
  }
  return url.toString();
}

function scheduleNominatim(task, signal) {
  const run = async () => {
    const waitMs = Math.max(
      0,
      APP_CONFIG.nominatim.minIntervalMs - (Date.now() - lastNominatimRequestAt),
    );
    if (waitMs > 0) await abortableDelay(waitMs, signal);
    if (signal?.aborted) throw abortError();
    lastNominatimRequestAt = Date.now();
    return task();
  };

  const result = nominatimQueue.then(run, run);
  nominatimQueue = result.catch(() => {}).then(() => undefined);
  return result;
}

function mapNominatimResult(result) {
  if (!result || !isValidCoord([Number(result.lon), Number(result.lat)])) return null;

  const displayName = String(result.display_name ?? '').trim();
  const fallbackName = displayName.split(',')[0]?.trim() || 'Lugar sin nombre';
  const name = String(result.name || result.namedetails?.name || fallbackName).trim();
  const contextParts = displayName.split(',').map((part) => part.trim()).filter(Boolean);
  const context = contextParts.slice(1, 4).join(', ');

  return {
    id: `nominatim:${result.place_id ?? `${result.lat},${result.lon}`}`,
    name,
    displayName,
    context,
    lat: Number(result.lat),
    lon: Number(result.lon),
    category: result.category ?? result.type ?? 'place',
    type: result.type ?? 'place',
    source: 'nominatim',
    coord: [Number(result.lon), Number(result.lat)],
  };
}

/**
 * Busca destinos. Devuelve caché local si está fresca, incluso sin conexión.
 * @param {string} query
 * @param {{signal?: AbortSignal}} options
 */
export async function searchPlaces(query, { signal } = {}) {
  const normalized = normalizeQuery(query);
  if (normalized.length < APP_CONFIG.nominatim.minQueryLength) return [];

  const cache = readPlaceCache();
  const cached = cache[normalized];
  if (cached && Date.now() - cached.savedAt < APP_CONFIG.nominatim.cacheTtlMs) {
    return Array.isArray(cached.results) ? cached.results : [];
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError('Estás sin conexión. Elige el destino tocando el mapa.', {
      code: 'offline',
    });
  }

  const url = buildNominatimUrl('search', {
    q: normalized,
    format: 'jsonv2',
    addressdetails: 1,
    dedupe: 1,
    limit: APP_CONFIG.nominatim.limit,
    countrycodes: APP_CONFIG.city.countryCode,
    viewbox: APP_CONFIG.city.searchViewbox,
    // La app es de una sola ciudad: no queremos un "Sambil" de Margarita.
    bounded: 1,
    'accept-language': APP_CONFIG.nominatim.language,
  });

  const payload = await scheduleNominatim(
    () => fetchJson(url, { signal, timeoutMs: 10000 }),
    signal,
  );

  const ranked = (Array.isArray(payload) ? payload : [])
    .map(mapNominatimResult)
    .filter(Boolean)
    .map((place, index) => {
      const name = normalizeQuery(place.name);
      let score = 0;
      if (name === normalized) score -= 100;
      else if (name.startsWith(normalized)) score -= 70;
      else if (name.includes(normalized)) score -= 40;
      return { place, score, index };
    })
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.place);

  // Nominatim suele devolver el mismo topónimo como nodo, vía y límite
  // administrativo. Para el usuario es el mismo destino: nos quedamos con la
  // primera coincidencia y evitamos una lista de resultados repetidos.
  const results = [];
  for (const place of ranked) {
    const nameKey = normalizeQuery(place.name);
    const duplicate = results.some((existing) => (
      normalizeQuery(existing.name) === nameKey
      && distanceMeters(existing.coord, place.coord) < 2000
    ));
    if (!duplicate) results.push(place);
  }

  cache[normalized] = { savedAt: Date.now(), results };
  writePlaceCache(cache);
  return results.slice(0, APP_CONFIG.nominatim.limit);
}

/** Convierte coordenadas elegidas en el mapa en una etiqueta legible. */
export async function reverseGeocode(coord, { signal } = {}) {
  if (!isValidCoord(coord)) {
    throw new ApiError('Las coordenadas no son válidas.', { code: 'invalid-coordinates' });
  }

  const url = buildNominatimUrl('reverse', {
    lat: coord[1],
    lon: coord[0],
    format: 'jsonv2',
    zoom: 18,
    addressdetails: 1,
    'accept-language': APP_CONFIG.nominatim.language,
  });

  const payload = await scheduleNominatim(
    () => fetchJson(url, { signal, timeoutMs: 10000 }),
    signal,
  );

  if (payload?.error) return null;
  return mapNominatimResult(payload);
}

/* ------------------------------------------------------------------ */
/* DolarAPI · tasa oficial BCV                                         */
/* ------------------------------------------------------------------ */

function normalizeRate(payload) {
  const value = Number(payload?.promedio ?? payload?.venta ?? payload?.compra);
  if (!Number.isFinite(value) || value <= 0) {
    throw new ApiError('La API no devolvió una tasa válida.', { code: 'invalid-rate' });
  }

  return {
    rate: value,
    currency: 'VES',
    base: 'USD',
    source: 'BCV',
    provider: 'DolarAPI',
    apiUpdatedAt: payload?.fechaActualizacion ?? null,
    fetchedAt: new Date().toISOString(),
  };
}

export function readCachedRate() {
  const cached = safeReadJson(STORAGE_KEYS.rateCacheKey, null);
  if (!cached || !Number.isFinite(Number(cached.rate)) || Number(cached.rate) <= 0) {
    return null;
  }
  return cached;
}

/**
 * Devuelve la tasa con metadatos de frescura.
 * Si la red falla pero existe caché, devuelve la caché marcada como `stale`.
 */
export async function getOfficialRate({ force = false, signal } = {}) {
  const cached = readCachedRate();
  const cachedAge = cached ? Date.now() - new Date(cached.fetchedAt).getTime() : Infinity;

  if (cached && !force && cachedAge < APP_CONFIG.dolarApi.refreshAfterMs) {
    return { data: cached, cached: true, stale: false, error: null };
  }

  try {
    const payload = await fetchJson(APP_CONFIG.dolarApi.baseUrl, {
      signal,
      timeoutMs: APP_CONFIG.dolarApi.timeoutMs,
    });
    const fresh = normalizeRate(payload);
    safeWriteJson(STORAGE_KEYS.rateCacheKey, fresh);
    return { data: fresh, cached: false, stale: false, error: null };
  } catch (error) {
    if (isAbortError(error)) throw error;

    if (cached) {
      return {
        data: cached,
        cached: true,
        stale: cachedAge > APP_CONFIG.dolarApi.staleAfterMs,
        error,
      };
    }

    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* OSRM · trazado peatonal                                             */
/* ------------------------------------------------------------------ */

const walkingCache = new Map();
const WALK_CACHE_LIMIT = 40;

function coordKey(coord) {
  return `${coord[0].toFixed(5)},${coord[1].toFixed(5)}`;
}

export async function getWalkingRoute(from, to, { signal } = {}) {
  if (!isValidCoord(from) || !isValidCoord(to)) return null;

  const key = `${coordKey(from)}>${coordKey(to)}`;
  if (walkingCache.has(key)) {
    return { ...walkingCache.get(key), cached: true };
  }

  const base = APP_CONFIG.osrm.baseUrl.replace(/\/$/, '');
  const coords = `${from[0]},${from[1]};${to[0]},${to[1]}`;
  const url = `${base}/route/v1/${APP_CONFIG.osrm.profile}/${coords}`
    + '?overview=full&geometries=geojson&steps=false&alternatives=false';

  const payload = await fetchJson(url, {
    signal,
    timeoutMs: APP_CONFIG.osrm.timeoutMs,
  });

  const route = payload?.routes?.[0];
  if (payload?.code !== 'Ok' || !Array.isArray(route?.geometry?.coordinates)) {
    throw new ApiError('No encontramos un camino peatonal.', { code: 'osrm-no-route' });
  }

  const coordinates = route.geometry.coordinates;
  const distance = distanceMeters(from, to);
  const walkingMinutes = Math.max(
    1,
    Math.ceil(((route.distance || distance) / 1000 / APP_CONFIG.routing.walkSpeedKmh) * 60),
  );

  const result = {
    coordinates,
    distanceMeters: Math.round(route.distance || distance),
    walkingMinutes,
    // El servidor público de OSRM responde con perfil de coche. No usamos su
    // `duration` para caminata; calculamos el tiempo con velocidad peatonal.
    source: 'osrm',
    cached: false,
  };

  if (walkingCache.size >= WALK_CACHE_LIMIT) {
    walkingCache.delete(walkingCache.keys().next().value);
  }
  walkingCache.set(key, result);
  return result;
}
