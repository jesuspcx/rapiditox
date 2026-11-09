/**
 * Rapidito · controlador de la aplicación
 * Orquesta datos, geolocalización, búsqueda, matching, mapa y PWA.
 */

import { APP_CONFIG, STORAGE_KEYS } from './config.js';
import {
  fetchPlaces,
  fetchRoutes,
  getOfficialRate,
  getWalkingRoute,
  isAbortError,
  readCachedRate,
  reverseGeocode,
  searchPlaces,
} from './api.js';
import { isValidCoord, distanceMeters } from './geo.js';
import { createMap } from './map.js';
import { findDirectTrips, prepareNetwork } from './router.js';
import { createUI } from './ui.js';

const ui = createUI();
const liveRegion = document.getElementById('live-region');

const savedTheme = document.documentElement.dataset.theme;
const state = {
  ready: false,
  network: null,
  routes: [],
  routesError: null,
  places: [],
  recents: [],
  origin: null,
  locationStatus: 'idle',
  locationPromise: null,
  destination: null,
  destinationRequest: 0,
  candidates: [],
  selectedId: null,
  lastResult: null,
  currentView: 'idle',
  rate: null,
  rateLoading: true,
  rateError: null,
  rateRequest: 0,
  theme: savedTheme === 'dark' ? 'dark' : 'light',
  offline: !navigator.onLine,
  isPicking: false,
  searchItems: [],
  searchTimer: null,
  searchAbort: null,
  searchToken: 0,
  lastSearchQuery: '',
  walkingToken: 0,
  reverseToken: 0,
  dialogView: null,
  installPrompt: null,
  isStandalone: window.matchMedia('(display-mode: standalone)').matches
    || navigator.standalone === true,
  pendingWorker: null,
  applyingWorkerUpdate: false,
};

let mapController = null;
let mapInvalidateFrame = 0;

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function announce(message) {
  if (!liveRegion) return;
  liveRegion.textContent = '';
  window.setTimeout(() => { liveRegion.textContent = message; }, 30);
}

function normalizeDestination(place) {
  if (!place) return null;
  const lat = Number(place.lat);
  const lon = Number(place.lon);
  if (!isValidCoord([lon, lat])) return null;

  return {
    id: String(place.id ?? `place:${lat},${lon}`),
    name: String(place.name || place.nombre || 'Destino'),
    context: String(place.context || place.detalle || place.displayName || APP_CONFIG.city.name),
    displayName: String(place.displayName || place.detalle || place.name || ''),
    lat,
    lon,
    coord: [lon, lat],
    source: place.source || 'manual',
    category: place.category || place.type || 'place',
  };
}

function quickPlaceToDestination(place) {
  return normalizeDestination({
    id: `quick:${place.id}`,
    name: place.nombre,
    context: place.detalle,
    displayName: place.detalle,
    lat: place.lat,
    lon: place.lon,
    source: 'shortcut',
    category: place.icono,
  });
}

function rateInfoFromApi(result) {
  if (!result?.data) return null;
  return {
    rate: Number(result.data.rate),
    fetchedAt: result.data.fetchedAt,
    apiUpdatedAt: result.data.apiUpdatedAt,
    stale: Boolean(result.stale),
    cached: Boolean(result.cached),
  };
}

function rateInfoFromCache(cached) {
  if (!cached) return null;
  const age = Date.now() - new Date(cached.fetchedAt).getTime();
  return {
    rate: Number(cached.rate),
    fetchedAt: cached.fetchedAt,
    apiUpdatedAt: cached.apiUpdatedAt,
    stale: Number.isFinite(age) && age > APP_CONFIG.dolarApi.staleAfterMs,
    cached: true,
  };
}

function setSearchValue(value) {
  ui.setSearchValue(value);
}

function blurSearch() {
  ui.el.searchInput?.blur();
}

function storeTheme(theme) {
  try {
    window.localStorage.setItem(STORAGE_KEYS.themeKey, theme);
  } catch {
    // El tema sigue funcionando en memoria si el almacenamiento está bloqueado.
  }
}

function hydrateTheme() {
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.style.colorScheme = state.theme;
  ui.setTheme(state.theme);
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  hydrateTheme();
  storeTheme(state.theme);
  ui.setTheme(state.theme);
}

function setDocumentTitle() {
  document.title = 'Rapidito';
}

function loadRecents() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.recentPlacesKey);
    const parsed = raw ? JSON.parse(raw) : [];
    state.recents = Array.isArray(parsed)
      ? parsed
          .map((item) => normalizeDestination({ ...item, source: 'recent' }))
          .filter(Boolean)
          .slice(0, 5)
      : [];
  } catch {
    state.recents = [];
  }
}

function saveRecent(destination) {
  if (!destination) return;
  const entry = {
    id: destination.id,
    name: destination.name,
    context: destination.context,
    displayName: destination.displayName,
    lat: destination.lat,
    lon: destination.lon,
    category: destination.category,
    savedAt: Date.now(),
  };

  const rest = state.recents.filter((item) => (
    item.id !== entry.id
    && distanceMeters(item.coord, destination.coord) > 25
  ));
  state.recents = [normalizeDestination({ ...entry, source: 'recent' }), ...rest].slice(0, 5);

  try {
    window.localStorage.setItem(
      STORAGE_KEYS.recentPlacesKey,
      JSON.stringify(state.recents.map((item) => ({
        id: item.id,
        name: item.name,
        context: item.context,
        displayName: item.displayName,
        lat: item.lat,
        lon: item.lon,
        category: item.category,
        savedAt: entry.savedAt,
      }))),
    );
  } catch {
    // El historial local es una comodidad, no un requisito de la app.
  }
}

function networkForUi() {
  if (!state.network) return null;
  return { ...state.network, appVersion: APP_CONFIG.version };
}

function routeViewArguments() {
  return {
    origin: state.origin,
    destination: state.destination,
    candidates: state.candidates,
    selectedId: state.selectedId,
    rateInfo: state.rate,
    rateLoading: state.rateLoading,
    places: state.places,
    network: networkForUi(),
    offline: state.offline,
    result: state.lastResult,
  };
}

/* ------------------------------------------------------------------ */
/* Vistas                                                              */
/* ------------------------------------------------------------------ */

function resetOwnContentScroll() {
  if (ui.el.sheetContent) ui.el.sheetContent.scrollTop = 0;
}

function renderIdleView() {
  state.currentView = 'idle';
  ui.renderIdle({
    origin: state.origin,
    locationStatus: state.locationStatus,
    places: state.places,
    rateInfo: state.rate,
    rateLoading: state.rateLoading,
    network: networkForUi(),
    offline: state.offline,
  });
  resetOwnContentScroll();
}

function renderLoadingView() {
  state.currentView = 'loading';
  ui.renderLoadingView();
}

function renderErrorView(error) {
  state.currentView = 'error';
  ui.renderErrorView({
    title: 'No pudimos cargar la red',
    message: error?.message || state.routesError || 'Comprueba tu conexión e inténtalo otra vez.',
    actionLabel: 'Reintentar',
    action: 'retry-routes',
  });
}

function refreshCurrentView({ preserveScroll = false } = {}) {
  if (!state.ready) return;

  if (state.currentView === 'results' && state.candidates.length) {
    ui.renderResults(routeViewArguments());
    return;
  }
  if (state.currentView === 'empty' && state.destination) {
    ui.renderEmpty(routeViewArguments());
    return;
  }
  if (state.currentView === 'error') {
    renderErrorView(new Error(state.routesError || 'No se pudo cargar la red.'));
    return;
  }
  if (state.currentView === 'idle') {
    renderIdleView();
    if (preserveScroll) resetOwnContentScroll();
  }
}

/* ------------------------------------------------------------------ */
/* Red y lugares                                                       */
/* ------------------------------------------------------------------ */

async function loadNetwork() {
  try {
    const raw = await fetchRoutes();
    const network = prepareNetwork(raw);

    // Una red vacía es un estado válido mientras se digitalizan las líneas.
    state.network = network;
    state.routes = network.routes;
    state.routesError = null;

    if (network.warnings.length) {
      console.warn('[Rapidito] Avisos de la red:', network.warnings);
    }

    mapController?.setNetwork(network.routes);
    return network;
  } catch (error) {
    state.routesError = error.message;
    throw error;
  }
}

async function loadPlaces() {
  try {
    const payload = await fetchPlaces();
    const list = Array.isArray(payload?.lugares) ? payload.lugares : [];
    state.places = list.filter((place) => (
      place
      && typeof place.nombre === 'string'
      && isValidCoord([Number(place.lon), Number(place.lat)])
    ));
  } catch (error) {
    console.warn('[Rapidito] No pudimos cargar los atajos:', error);
    state.places = [];
  }
}

/* ------------------------------------------------------------------ */
/* Tarifa                                                              */
/* ------------------------------------------------------------------ */

function hydrateRateFromCache() {
  const cached = readCachedRate();
  if (!cached) return;
  state.rate = rateInfoFromCache(cached);
  state.rateLoading = false;
}

async function loadRate({ force = false } = {}) {
  const token = ++state.rateRequest;
  if (!state.rate) state.rateLoading = true;

  try {
    const result = await getOfficialRate({ force });
    if (token !== state.rateRequest) return;

    state.rate = rateInfoFromApi(result);
    state.rateError = result.error?.message ?? null;
  } catch (error) {
    if (token !== state.rateRequest) return;
    state.rateError = error.message || 'No pudimos consultar la tasa.';
  } finally {
    if (token !== state.rateRequest) return;
    state.rateLoading = false;

    if (state.ready) refreshCurrentView({ preserveScroll: true });
  }
}

/* ------------------------------------------------------------------ */
/* Geolocalización                                                     */
/* ------------------------------------------------------------------ */

function setDemoOrigin() {
  const [lon, lat] = APP_CONFIG.demo.origin;
  state.origin = {
    coord: [lon, lat],
    label: APP_CONFIG.demo.label,
    source: 'demo',
    accuracy: null,
  };
  state.locationStatus = 'fallback';
  mapController?.setOrigin(state.origin.coord, {
    // Antes de que el sheet tenga contenido su altura no es representativa.
    // El foco inicial se aplica cuando la vista ya está renderizada.
    focus: state.ready && !state.destination,
    accuracy: 0,
  });
  return state.origin;
}

function focusOriginOnMap({ instant = false } = {}) {
  if (!mapController || !state.origin || state.destination) return;
  mapController.setOrigin(state.origin.coord, {
    accuracy: state.origin.accuracy,
    focus: true,
    instant,
  });
}

function settleLocationView() {
  if (!state.ready) return;
  if (state.destination && state.currentView !== 'loading') {
    calculateJourney({ focusMap: true });
  } else if (!state.destination) {
    refreshCurrentView();
  }
}

function requestLocation() {
  if (state.locationStatus === 'locating' && state.locationPromise) {
    return state.locationPromise;
  }

  state.locationStatus = 'locating';
  ui.setLocating(true);

  if (state.ready && !state.destination) {
    refreshCurrentView();
  }

  const previousOrigin = state.origin;

  const promise = new Promise((resolve) => {
    const finishWithFallback = (message) => {
      setDemoOrigin();
      ui.setLocating(false);
      settleLocationView();
      announce(message);
      resolve(state.origin);
    };

    if (!window.isSecureContext) {
      finishWithFallback(`El GPS necesita HTTPS o localhost. Usamos el centro de ${APP_CONFIG.city.name} como muestra.`);
      return;
    }

    if (!('geolocation' in navigator)) {
      finishWithFallback('Este navegador no ofrece geolocalización. Mostramos una ubicación de muestra.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coord = [position.coords.longitude, position.coords.latitude];
        if (!isValidCoord(coord)) {
          if (previousOrigin) {
            state.locationStatus = previousOrigin.source === 'gps' ? 'gps' : 'fallback';
            ui.setLocating(false);
            resolve(previousOrigin);
            return;
          }
          finishWithFallback('El GPS devolvió coordenadas inválidas. Usamos una ubicación de muestra.');
          return;
        }

        state.origin = {
          coord,
          label: 'Tu ubicación',
          source: 'gps',
          accuracy: Number(position.coords.accuracy) || null,
        };
        state.locationStatus = 'gps';
        ui.setLocating(false);
        mapController?.setOrigin(coord, {
          accuracy: state.origin.accuracy,
          focus: state.ready && !state.destination,
        });
        settleLocationView();
        resolve(state.origin);
      },
      (error) => {
        const messages = {
          1: 'No diste permiso al GPS. Usamos una ubicación de muestra.',
          2: 'El GPS no está disponible en este momento. Usamos una ubicación de muestra.',
          3: 'El GPS tardó demasiado. Usamos una ubicación de muestra.',
        };
        const message = messages[error.code] || 'No pudimos obtener tu ubicación. Usamos una ubicación de muestra.';

        if (previousOrigin?.source === 'gps') {
          state.locationStatus = 'gps';
          ui.setLocating(false);
          settleLocationView();
          resolve(previousOrigin);
          return;
        }

        finishWithFallback(message);
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 60 * 1000,
      },
    );
  });

  state.locationPromise = promise;
  return promise;
}

/* ------------------------------------------------------------------ */
/* Cálculo de viaje                                                    */
/* ------------------------------------------------------------------ */

function clearWalkingRequests() {
  state.walkingToken += 1;
}

async function loadWalkingPaths(candidate) {
  if (!mapController || !state.origin || !state.destination) return;
  if (navigator.onLine === false) return;

  const token = ++state.walkingToken;
  const originCoord = [...state.origin.coord];
  const destinationCoord = [...state.destination.coord];

  const [toStop, fromStop] = await Promise.allSettled([
    getWalkingRoute(originCoord, candidate.boardStop.coord),
    getWalkingRoute(candidate.alightStop.coord, destinationCoord),
  ]);

  if (token !== state.walkingToken) return;
  if (state.currentView !== 'results' || state.selectedId !== candidate.id) return;
  if (!mapController) return;

  if (toStop.status === 'fulfilled' && toStop.value?.coordinates?.length) {
    mapController.showWalkingRoute('toStop', toStop.value.coordinates);
  }
  if (fromStop.status === 'fulfilled' && fromStop.value?.coordinates?.length) {
    mapController.showWalkingRoute('fromStop', fromStop.value.coordinates);
  }
}

function calculateJourney({ focusMap = true } = {}) {
  if (!state.origin || !state.destination) {
    if (!state.origin) {
      renderLoadingView();
    }
    return;
  }

  clearWalkingRequests();
  const result = findDirectTrips(
    state.routes,
    state.origin.coord,
    state.destination.coord,
    APP_CONFIG.routing,
  );

  state.lastResult = result;

  if (result.candidates.length) {
    const previousSelection = state.selectedId;
    state.candidates = result.candidates;
    state.selectedId = result.candidates.some((candidate) => candidate.id === previousSelection)
      ? previousSelection
      : result.candidates[0].id;
    state.currentView = 'results';

    ui.renderResults(routeViewArguments());

    const candidate = state.candidates.find((item) => item.id === state.selectedId);
    if (candidate) {
      mapController?.showTrip({
        candidate,
        origin: state.origin,
        destination: state.destination,
        focus: focusMap,
      });
      loadWalkingPaths(candidate);
    }

    announce(`${result.candidates.length} opciones de ruta. La primera es ${result.candidates[0].route.groupId} hacia ${result.candidates[0].route.directionLabel}, aproximadamente ${result.candidates[0].totalMinutes} minutos.`);
  } else {
    state.candidates = [];
    state.selectedId = null;
    state.currentView = 'empty';
    ui.renderEmpty(routeViewArguments());
    mapController?.showNoRoute({
      origin: state.origin,
      destination: state.destination,
      focus: Boolean(focusMap),
    });

    const message = result.reason === 'walk-only'
      ? `Tu destino está cerca: unos ${result.walkOnlyMinutes} minutos caminando.`
      : result.reason === 'no-network'
        ? 'La red aún no tiene líneas digitalizadas.'
        : 'No encontramos una ruta directa en la red.';
    announce(message);
  }
}

function stopSearchActivity() {
  window.clearTimeout(state.searchTimer);
  state.searchTimer = null;
  state.searchToken += 1;
  state.searchAbort?.abort();
  state.searchAbort = null;
  ui.setSearchBusy(false);
  ui.hideSuggestions();
}

async function chooseDestination(place, { save = true } = {}) {
  const destination = normalizeDestination(place);
  if (!destination) {
    announce('Ese destino no tiene coordenadas válidas.');
    return;
  }

  if (state.isPicking) {
    state.isPicking = false;
    mapController?.stopPicking();
  }

  const requestId = ++state.destinationRequest;
  stopSearchActivity();
  blurSearch();

  state.destination = destination;
  state.candidates = [];
  state.selectedId = null;
  state.lastResult = null;
  state.searchItems = [];
  state.lastSearchQuery = '';
  setDocumentTitle();
  setSearchValue(destination.name);
  ui.setClearButtonVisible(true);

  if (save) saveRecent(destination);

  if (!state.origin) {
    renderLoadingView();
    if (state.locationPromise) await state.locationPromise;
  }

  if (requestId !== state.destinationRequest) return;
  if (!state.origin) {
    if (state.locationStatus === 'locating') {
      announce('Todavía estamos ubicando tu posición. Espera un momento.');
      return;
    }
    setDemoOrigin();
  }

  calculateJourney({ focusMap: true });
}

function selectCandidate(candidateId) {
  const candidate = state.candidates.find((item) => item.id === candidateId);
  if (!candidate) return;

  state.selectedId = candidate.id;
  clearWalkingRequests();
  ui.renderResults(routeViewArguments());
  mapController?.showTrip({
    candidate,
    origin: state.origin,
    destination: state.destination,
    focus: true,
  });
  loadWalkingPaths(candidate);
  announce(`Ruta ${candidate.route.groupId} hacia ${candidate.route.directionLabel} en el mapa.`);
}

function resetJourney({ focusSearch = false, fitCity = false } = {}) {
  state.destinationRequest += 1;
  state.reverseToken += 1;
  state.destination = null;
  state.candidates = [];
  state.selectedId = null;
  state.lastResult = null;
  stopSearchActivity();
  setSearchValue('');
  setDocumentTitle();
  ui.setClearButtonVisible(false);

  if (state.isPicking) {
    mapController?.stopPicking();
    state.isPicking = false;
  }

  if (fitCity) {
    mapController?.fitCity();
  } else {
    mapController?.reset();
  }

  renderIdleView();
  if (focusSearch) {
    window.setTimeout(() => ui.focusSearch(), 80);
  }
}

/* ------------------------------------------------------------------ */
/* Diálogos                                                            */
/* ------------------------------------------------------------------ */

function openMenuView() {
  state.dialogView = 'menu';
  ui.openMenu({
    theme: state.theme,
    network: networkForUi(),
    standalone: state.isStandalone,
  });
}

function openFaresView() {
  state.dialogView = 'fares';
  ui.openFares({
    network: networkForUi(),
    rateInfo: state.rate,
    loading: false,
  });
}

function openLinesView() {
  state.dialogView = 'lines';
  ui.openLines({
    network: networkForUi(),
    rateInfo: state.rate,
  });
}

function openAboutView() {
  state.dialogView = 'about';
  ui.openAbout({
    network: networkForUi(),
    standalone: state.isStandalone,
  });
}

function openInstallHelpView() {
  state.dialogView = 'install';
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  ui.openInstallHelp({ isIos, standalone: state.isStandalone });
}

async function refreshRateFromDialog() {
  ui.setRateLoading(true);
  await loadRate({ force: true });

  if (ui.isDialogOpen()) {
    if (state.dialogView === 'fares') openFaresView();
    else if (state.dialogView === 'menu') openMenuView();
  }
}

function focusLineOnMap(groupId) {
  const group = state.network?.groups.find((item) => item.id === groupId);
  if (!group) return;

  ui.closeDialog();
  stopSearchActivity();
  const hadDestination = Boolean(state.destination);
  if (hadDestination) {
    resetJourney({ focusSearch: false, fitCity: false });
  } else {
    mapController?.clearSelection();
  }

  mapController?.focusGroup(group);
  announce(`Mostrando la línea ${group.id}, ${group.name}, ${group.endpointsLabel}.`);
}

/* ------------------------------------------------------------------ */
/* Búsqueda                                                            */
/* ------------------------------------------------------------------ */

function recentSuggestions() {
  return state.recents.map((place) => ({
    ...place,
    source: 'recent',
  }));
}

function showRecentSuggestions() {
  if (state.recents.length) {
    state.searchItems = recentSuggestions();
    state.lastSearchQuery = '';
    ui.showSuggestions({
      title: 'Tus destinos recientes',
      items: state.searchItems,
      status: 'results',
    });
  } else {
    state.searchItems = [];
    ui.showSuggestions({
      title: 'Busca tu destino',
      status: 'empty',
      message: 'Escribe una calle, plaza o sitio. También puedes elegir un punto en el mapa.',
    });
  }
}

function showMapPickerSuggestions() {
  ui.showSuggestions({
    title: 'Busca tu destino',
    status: 'empty',
    message: 'Escribe al menos 3 letras o elige el punto directamente en el mapa.',
  });
}

async function runSearch(query) {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < APP_CONFIG.nominatim.minQueryLength) {
    showMapPickerSuggestions();
    return;
  }
  if (normalizedQuery !== ui.el.searchInput?.value.trim()) return;

  state.searchAbort?.abort();
  const controller = new AbortController();
  state.searchAbort = controller;
  const token = ++state.searchToken;
  state.lastSearchQuery = normalizedQuery;
  ui.setSearchBusy(true);
  ui.showSuggestions({ title: 'Buscando destinos', status: 'loading' });

  try {
    const results = await searchPlaces(normalizedQuery, { signal: controller.signal });
    if (token !== state.searchToken) return;

    state.searchItems = results;
    if (results.length) {
      ui.showSuggestions({
        title: 'Resultados',
        items: results,
        status: 'results',
      });
    } else {
      ui.showSuggestions({
        title: 'Sin resultados',
        status: 'empty',
        message: 'No encontramos ese lugar. Prueba con otro nombre o elige el punto en el mapa.',
      });
    }
  } catch (error) {
    if (isAbortError(error) || token !== state.searchToken) return;

    state.searchItems = [];
    ui.showSuggestions({
      title: 'No pudimos buscar',
      status: 'error',
      message: error.message || 'Revisa tu conexión e inténtalo otra vez.',
    });
  } finally {
    if (token === state.searchToken) {
      ui.setSearchBusy(false);
      if (state.searchAbort === controller) state.searchAbort = null;
    }
  }
}

function scheduleSearch(query) {
  window.clearTimeout(state.searchTimer);
  state.searchAbort?.abort();
  state.searchAbort = null;
  state.searchToken += 1;
  state.searchTimer = window.setTimeout(() => {
    runSearch(query);
  }, APP_CONFIG.nominatim.debounceMs);
}

function handleSearchInput() {
  const query = ui.el.searchInput?.value ?? '';
  ui.setClearButtonVisible(Boolean(query));
  window.clearTimeout(state.searchTimer);
  state.searchAbort?.abort();
  state.searchAbort = null;
  state.searchToken += 1;
  state.searchItems = [];

  if (!query.trim()) {
    state.lastSearchQuery = '';
    showRecentSuggestions();
    return;
  }

  if (query.trim().length < APP_CONFIG.nominatim.minQueryLength) {
    showMapPickerSuggestions();
    return;
  }

  ui.showSuggestions({ title: 'Buscando destinos', status: 'loading' });
  scheduleSearch(query);
}

function chooseSuggestion(index) {
  const item = state.searchItems[index];
  if (!item) return;
  chooseDestination(item);
}

function handleSearchSubmit(event) {
  event.preventDefault();
  const query = (ui.el.searchInput?.value ?? '').trim();

  if (
    state.searchItems.length
    && state.lastSearchQuery.toLowerCase() === query.toLowerCase()
    && !ui.el.suggestions.hidden
  ) {
    chooseSuggestion(0);
    return;
  }

  if (query.length >= APP_CONFIG.nominatim.minQueryLength) {
    window.clearTimeout(state.searchTimer);
    runSearch(query);
  } else {
    ui.focusSearch();
    showMapPickerSuggestions();
  }
}

/* ------------------------------------------------------------------ */
/* Mapa interactivo                                                    */
/* ------------------------------------------------------------------ */

function startMapPicking() {
  if (!mapController) return;

  ui.closeDialog();
  stopSearchActivity();
  blurSearch();
  state.isPicking = true;
  announce('Toca el mapa para fijar tu destino.');

  mapController.startPicking(async (coord) => {
    state.isPicking = false;

    const destination = normalizeDestination({
      id: `map:${coord[1].toFixed(5)},${coord[0].toFixed(5)}`,
      name: 'Punto en el mapa',
      context: 'Destino elegido manualmente',
      displayName: 'Punto en el mapa',
      lat: coord[1],
      lon: coord[0],
      source: 'map',
    });

    if (!destination) {
      announce('No pudimos usar ese punto del mapa.');
      return;
    }

    await chooseDestination(destination, { save: false });

    if (navigator.onLine === false) return;
    const reverseToken = ++state.reverseToken;

    try {
      const result = await reverseGeocode(destination.coord);
      if (reverseToken !== state.reverseToken) return;
      if (!state.destination || state.destination.source !== 'map') return;
      if (distanceMeters(state.destination.coord, destination.coord) > 5) return;

      state.destination = {
        ...state.destination,
        name: result?.name || 'Punto en el mapa',
        context: result?.context || 'Destino elegido manualmente',
        displayName: result?.displayName || state.destination.displayName,
      };
      setSearchValue(state.destination.name);
      setDocumentTitle();
      saveRecent(state.destination);

      if (state.currentView === 'results') {
        ui.renderResults(routeViewArguments());
      } else if (state.currentView === 'empty') {
        ui.renderEmpty(routeViewArguments());
      }
      mapController?.setDestination(state.destination.coord, {
        label: state.destination.name,
      });
    } catch {
      // Sin conexión o geocodificación inversa no disponible: el punto sigue
      // siendo perfectamente válido para calcular la ruta.
    }
  });
}

function cancelMapPicking() {
  if (!state.isPicking) return;
  state.isPicking = false;
  mapController?.stopPicking();
}

function handleMapLineClick(route) {
  if (state.isPicking) return;
  announce(`Línea ${route.groupId} · ${route.from} → ${route.to}.`);
  openLinesView();
}

/* ------------------------------------------------------------------ */
/* Acciones                                                            */
/* ------------------------------------------------------------------ */

function bindEvents() {
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-action]');
    if (!trigger) return;

    const action = trigger.dataset.action;
    switch (action) {
      case 'focus-search':
        if (ui.isDialogOpen()) ui.closeDialog();
        ui.focusSearch({ select: true });
        break;

      case 'clear-search':
        resetJourney({ focusSearch: true });
        break;

      case 'choose-quick-place': {
        const index = Number(trigger.dataset.placeIndex);
        const place = state.places[index];
        if (place) {
          const destination = quickPlaceToDestination(place);
          if (destination) chooseDestination(destination);
        }
        break;
      }

      case 'choose-suggestion': {
        const index = Number(trigger.dataset.suggestionIndex);
        chooseSuggestion(index);
        break;
      }

      case 'refresh-location':
        if (state.isPicking) cancelMapPicking();
        requestLocation();
        break;

      case 'select-route':
        selectCandidate(trigger.dataset.candidateId);
        break;

      case 'reset-search':
        resetJourney({ focusSearch: true });
        break;

      case 'open-menu':
        cancelMapPicking();
        stopSearchActivity();
        openMenuView();
        break;

      case 'toggle-theme':
        toggleTheme();
        break;

      case 'open-fares':
        if (ui.isDialogOpen()) ui.closeDialog();
        openFaresView();
        break;

      case 'change-fare-quantity':
        ui.changeFareQuantity(trigger.dataset.fareType, Number(trigger.dataset.delta));
        break;

      case 'open-lines':
        if (ui.isDialogOpen()) ui.closeDialog();
        openLinesView();
        break;

      case 'open-about':
        openAboutView();
        break;

      case 'show-line': {
        const groupId = trigger.dataset.groupId;
        if (groupId) focusLineOnMap(groupId);
        break;
      }

      case 'refresh-rate':
        refreshRateFromDialog();
        break;

      case 'pick-on-map':
        startMapPicking();
        break;

      case 'cancel-pick':
        cancelMapPicking();
        break;

      case 'install-app':
        installApp();
        break;

      case 'open-install-help':
        openInstallHelpView();
        break;

      case 'close-dialog':
        ui.closeDialog();
        break;

      case 'retry-routes':
        retryNetwork();
        break;

      case 'reload-app':
        applyServiceWorkerUpdate();
        break;

      case 'home':
        ui.closeDialog();
        resetJourney({ focusSearch: false, fitCity: true });
        break;

      default:
        break;
    }
  });

  ui.el.searchForm?.addEventListener('submit', handleSearchSubmit);
  ui.el.searchInput?.addEventListener('input', () => {
    if (state.isPicking) cancelMapPicking();
    handleSearchInput();
  });
  ui.el.searchInput?.addEventListener('focus', () => {
    if (state.isPicking) cancelMapPicking();
    if (!ui.el.suggestions.hidden) return;
    const query = (ui.el.searchInput?.value ?? '').trim();
    if (!query) {
      showRecentSuggestions();
    } else if (
      state.searchItems.length
      && state.lastSearchQuery
      && state.lastSearchQuery.toLowerCase() === query.toLowerCase()
    ) {
      ui.showSuggestions({
        title: 'Resultados',
        items: state.searchItems,
        status: 'results',
      });
    }
  });

  ui.el.searchInput?.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && !ui.el.suggestions.hidden) {
      const first = ui.el.suggestions.querySelector('.suggestion');
      if (first) {
        event.preventDefault();
        first.focus();
      }
    }
    if (event.key === 'Escape') {
      ui.hideSuggestions();
    }
  });

  ui.el.suggestions?.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Escape'].includes(event.key)) return;
    const options = [...ui.el.suggestions.querySelectorAll('.suggestion')];
    if (!options.length) return;
    const currentIndex = options.indexOf(document.activeElement);

    if (event.key === 'Escape') {
      event.preventDefault();
      ui.hideSuggestions();
      ui.focusSearch();
      return;
    }

    event.preventDefault();
    if (event.key === 'ArrowDown') {
      const next = options[Math.min(options.length - 1, currentIndex + 1)] ?? options[0];
      next.focus();
    } else if (event.key === 'ArrowUp') {
      if (currentIndex <= 0) ui.focusSearch();
      else options[currentIndex - 1].focus();
    }
  });

  document.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.search-stack')) return;
    if (!ui.el.suggestions.hidden) ui.hideSuggestions();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (ui.isDialogOpen()) return;
    if (state.isPicking) {
      cancelMapPicking();
      return;
    }
    if (!ui.el.suggestions.hidden) ui.hideSuggestions();
  });

  window.addEventListener('online', () => {
    state.offline = false;
    refreshCurrentView({ preserveScroll: true });
    loadRate({ force: false });
  });

  window.addEventListener('offline', () => {
    state.offline = true;
    stopSearchActivity();
    refreshCurrentView({ preserveScroll: true });
  });

  const scheduleMapInvalidate = () => {
    if (mapInvalidateFrame) return;
    mapInvalidateFrame = window.requestAnimationFrame(() => {
      mapInvalidateFrame = 0;
      mapController?.invalidateSize();
    });
  };

  window.addEventListener('resize', scheduleMapInvalidate, { passive: true });
  window.visualViewport?.addEventListener('resize', scheduleMapInvalidate, { passive: true });
  document.addEventListener('rapidito:layoutchange', scheduleMapInvalidate);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !navigator.onLine) return;
    if (!state.rate) loadRate();
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.installPrompt = event;
  });

  window.addEventListener('appinstalled', () => {
    state.installPrompt = null;
    state.isStandalone = true;
  });
}

async function installApp() {
  if (state.isStandalone) {
    openInstallHelpView();
    return;
  }

  if (!state.installPrompt) {
    openInstallHelpView();
    return;
  }

  const prompt = state.installPrompt;
  state.installPrompt = null;
  ui.closeDialog();

  try {
    prompt.prompt();
    await prompt.userChoice;
  } catch (error) {
    console.warn('[Rapidito] Instalación no disponible:', error);
  }
}

async function retryNetwork() {
  ui.renderLoadingView();
  ui.hideBoot();
  try {
    await loadNetwork();
    state.ready = true;
    state.currentView = 'idle';
    renderIdleView();
    if (!state.places.length) loadPlaces().then(() => refreshCurrentView());
    window.setTimeout(() => {
      if (state.origin && !state.destination && state.currentView === 'idle') {
        focusOriginOnMap();
      }
    }, 180);
  } catch (error) {
    renderErrorView(error);
  }
}

/* ------------------------------------------------------------------ */
/* Service worker                                                      */
/* ------------------------------------------------------------------ */

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  if (!['http:', 'https:'].includes(window.location.protocol)) return;

  try {
    const registration = await navigator.serviceWorker.register('./sw.js', {
      scope: './',
    });

    const watchWorker = (worker) => {
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          state.pendingWorker = worker;
        }
      });
    };

    if (registration.waiting && navigator.serviceWorker.controller) {
      state.pendingWorker = registration.waiting;
    }
    if (registration.installing) watchWorker(registration.installing);
    registration.addEventListener('updatefound', () => watchWorker(registration.installing));

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (state.applyingWorkerUpdate) window.location.reload();
    });
  } catch (error) {
    console.warn('[Rapidito] Service worker no registrado:', error);
  }
}

function applyServiceWorkerUpdate() {
  if (state.pendingWorker) {
    state.applyingWorkerUpdate = true;
    state.pendingWorker.postMessage({ type: 'SKIP_WAITING' });
    window.setTimeout(() => {
      if (state.applyingWorkerUpdate) window.location.reload();
    }, 900);
  } else {
    window.location.reload();
  }
}

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */

async function init() {
  hydrateTheme();
  hydrateRateFromCache();
  loadRecents();
  state.offline = !navigator.onLine;
  bindEvents();
  coreStartup().catch((error) => {
    console.error('[Rapidito] Error de arranque:', error);
    ui.hideBoot();
    ui.renderErrorView({
      title: 'Algo salió mal',
      message: 'No pudimos terminar de cargar la aplicación. Intenta recargar.',
      actionLabel: 'Recargar',
      action: 'reload-app',
    });
  });
}

async function coreStartup() {
  try {
    mapController = createMap(document.getElementById('map'), {
      onLineClick: handleMapLineClick,
    });
  } catch (error) {
    console.error(error);
    ui.hideBoot();
    ui.renderErrorView({
      title: 'El mapa no pudo iniciar',
      message: 'Revisa que Leaflet esté disponible y recarga la página.',
      actionLabel: 'Recargar',
      action: 'reload-app',
    });
    return;
  }

  // El GPS se pide en paralelo para que el panel aparezca rápido. La red y los
  // atajos se cargan antes de quitar la pantalla de arranque.
  requestLocation();
  loadRate();
  registerServiceWorker();

  await Promise.allSettled([loadNetwork(), loadPlaces()]);

  if (state.routesError || !state.network) {
    state.ready = false;
    ui.hideBoot();
    renderErrorView(new Error(state.routesError || 'No se pudo cargar la red.'));
    return;
  }

  state.ready = true;
  state.currentView = 'idle';
  renderIdleView();
  ui.hideBoot();

  // La tasa pudo hidratarse de caché antes de que el panel existiera.
  if (state.rate) refreshCurrentView();

  // Ahora que el sheet tiene altura real, centramos el GPS en el área visible
  // del mapa (la que queda por encima del panel), no debajo de él.
  window.setTimeout(() => {
    if (state.origin && !state.destination && state.currentView === 'idle') {
      focusOriginOnMap();
    }
  }, 180);
}

// La app se inicia una sola vez.
init();
