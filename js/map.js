/**
 * Rapidito · capa de mapa
 * Encapsula Leaflet. No conoce la lógica de matching ni las APIs: recibe
 * rutas ya normalizadas y candidatos calculados por router.js.
 */

import { APP_CONFIG } from './config.js';

function getLeaflet() {
  const L = window.L;
  if (!L) {
    throw new Error('Leaflet no está disponible. Revisa vendor/leaflet/leaflet.js.');
  }
  return L;
}

function routeShapeKey(route) {
  const start = route.coords[0];
  const end = route.coords.at(-1);
  const a = `${start[0].toFixed(5)},${start[1].toFixed(5)}`;
  const b = `${end[0].toFixed(5)},${end[1].toFixed(5)}`;
  const endpoints = [a, b].sort().join('|');
  return `${route.groupId}:${endpoints}:${route.coords.length}`;
}

function tooltipElement(text) {
  const element = document.createElement('span');
  element.className = 'map-tooltip';
  element.textContent = text;
  return element;
}

export function createMap(container, { onLineClick } = {}) {
  const L = getLeaflet();

  const map = L.map(container, {
    zoomControl: false,
    minZoom: APP_CONFIG.map.minZoom,
    maxZoom: APP_CONFIG.map.maxZoom,
    zoomSnap: 0.25,
    wheelPxPerZoomLevel: 120,
    tap: true,
  }).setView(
    [APP_CONFIG.city.center[1], APP_CONFIG.city.center[0]],
    APP_CONFIG.city.zoom,
  );

  const tileLayer = L.tileLayer(APP_CONFIG.map.tileUrl, {
    minZoom: APP_CONFIG.map.minZoom,
    maxZoom: APP_CONFIG.map.maxZoom,
    attribution: APP_CONFIG.map.attribution,
    crossOrigin: true,
    updateWhenIdle: false,
    keepBuffer: 3,
  });
  tileLayer.addTo(map);

  const networkLayer = L.layerGroup().addTo(map);
  const highlightLayer = L.layerGroup().addTo(map);
  const walkingLayer = L.layerGroup().addTo(map);
  const stopsLayer = L.layerGroup().addTo(map);
  const markerLayer = L.layerGroup().addTo(map);

  let originMarker = null;
  let originAccuracy = null;
  let destinationMarker = null;
  let destinationLabel = null;
  let networkPolylines = [];
  let networkData = [];
  let highlighted = false;
  let picking = false;
  let pickHandler = null;
  let activeCandidate = null;
  let walkingLegs = { toStop: null, fromStop: null };

  const originIcon = L.divIcon({
    className: 'rapidito-div-icon',
    html: '<span class="geo-marker"><span class="geo-marker__halo"></span><span class="geo-marker__dot"></span></span>',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });

  const destinationIcon = L.divIcon({
    className: 'rapidito-div-icon',
    html: '<span class="dest-marker"><svg viewBox="0 0 44 52" aria-hidden="true"><path d="M22 3C12.6 3 5 10.6 5 20c0 12.8 17 29 17 29s17-16.2 17-29C39 10.6 31.4 3 22 3Z" fill="currentColor"/><circle cx="22" cy="20" r="7" fill="white"/></svg></span>',
    iconSize: [44, 52],
    iconAnchor: [22, 50],
  });

  function stopCalloutIcon(kind, index) {
    const label = kind === 'board' ? 'Sube' : 'Baja';
    return L.divIcon({
      className: 'rapidito-div-icon',
      html: `<span class="map-stop map-stop--${kind}"><b>${index}</b><em>${label}</em></span>`,
      iconSize: [70, 28],
      iconAnchor: [14, 14],
    });
  }

  function getViewportPadding() {
    const desktop = window.matchMedia('(min-width: 768px)').matches;
    const sheet = document.getElementById('sheet');

    if (desktop) {
      const sheetRight = sheet?.getBoundingClientRect().right ?? 460;
      // La píldora de búsqueda y el panel lateral limitan la zona de trabajo
      // del mapa; no centramos el viaje debajo del cristal.
      return {
        paddingTopLeft: [Math.round(sheetRight + 28), 112],
        paddingBottomRight: [48, 48],
      };
    }

    const sheetHeight = sheet
      ? Math.min(sheet.getBoundingClientRect().height, window.innerHeight * 0.72)
      : 320;
    return {
      paddingTopLeft: [44, 104],
      paddingBottomRight: [44, Math.round(sheetHeight) + 34],
    };
  }

  function focusPoint(coord, { maxZoom = 14.5, instant = false } = {}) {
    // Un `flyTo` a una sola coordenada la pone bajo el bottom sheet. Leaflet
    // desplaza el centro cuando recibe un padding asimétrico en fitBounds;
    // usamos un bbox mínimo y limitamos el zoom para conservar contexto.
    const [lon, lat] = coord;
    const epsilon = 0.0006;
    const bounds = L.latLngBounds(
      [lat - epsilon, lon - epsilon],
      [lat + epsilon, lon + epsilon],
    );
    map.flyToBounds(bounds, {
      ...getViewportPadding(),
      maxZoom,
      duration: instant ? 0 : 0.7,
    });
  }

  function fitCoordinates(coordinates, options = {}) {
    const valid = coordinates.filter((coord) => (
      Array.isArray(coord)
      && Number.isFinite(coord[0])
      && Number.isFinite(coord[1])
    ));
    if (!valid.length) return;

    if (valid.length === 1) {
      focusPoint(valid[0], {
        maxZoom: options.maxZoom ?? 15,
        instant: options.instant,
      });
      return;
    }

    const bounds = L.latLngBounds(valid.map(([lon, lat]) => [lat, lon]));
    const viewport = getViewportPadding();
    map.flyToBounds(bounds, {
      ...viewport,
      maxZoom: options.maxZoom ?? 16,
      duration: options.instant ? 0 : 0.75,
    });
  }

  function setOrigin(coord, { accuracy = 0, focus = false, instant = false } = {}) {
    if (!Array.isArray(coord) || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) {
      return;
    }

    const latlng = [coord[1], coord[0]];
    if (!originMarker) {
      originMarker = L.marker(latlng, {
        icon: originIcon,
        zIndexOffset: 900,
        keyboard: false,
        alt: 'Tu ubicación',
      }).addTo(markerLayer);
      originMarker.bindTooltip('Estás aquí', {
        direction: 'top',
        offset: [0, -12],
        opacity: 1,
        className: 'rapidito-tooltip',
      });
    } else {
      originMarker.setLatLng(latlng);
    }

    if (originAccuracy) {
      markerLayer.removeLayer(originAccuracy);
      originAccuracy = null;
    }
    if (accuracy > 20) {
      originAccuracy = L.circle(latlng, {
        radius: Math.min(accuracy, 2500),
        stroke: false,
        fillColor: '#5D86FF',
        fillOpacity: 0.1,
        interactive: false,
      }).addTo(markerLayer);
    }

    if (focus) {
      focusPoint(coord, { maxZoom: 14.5, instant });
    }
  }

  function setDestination(coord, { label = 'Destino', focus = false } = {}) {
    if (!Array.isArray(coord) || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) {
      return;
    }

    const latlng = [coord[1], coord[0]];
    destinationLabel = label;

    if (!destinationMarker) {
      destinationMarker = L.marker(latlng, {
        icon: destinationIcon,
        // El pin queda debajo de las paradas: si el destino coincide con la
        // bajada, el rótulo "Baja" sigue siendo legible.
        zIndexOffset: 650,
        keyboard: false,
        alt: label,
      }).addTo(markerLayer);
      destinationMarker.bindTooltip(() => tooltipElement(destinationLabel || 'Destino'), {
        direction: 'top',
        offset: [0, -42],
        opacity: 1,
        className: 'rapidito-tooltip',
      });
    } else {
      destinationMarker.setLatLng(latlng);
    }

    if (focus) {
      fitCoordinates([coord], { maxZoom: 15 });
    }
  }

  function clearDestination() {
    if (destinationMarker) {
      markerLayer.removeLayer(destinationMarker);
      destinationMarker = null;
    }
    destinationLabel = null;
  }

  function clearWalking() {
    walkingLayer.clearLayers();
    walkingLegs = { toStop: null, fromStop: null };
  }

  function clearHighlight() {
    highlightLayer.clearLayers();
    stopsLayer.clearLayers();
    walkingLayer.clearLayers();
    activeCandidate = null;
    highlighted = false;
    networkPolylines.forEach((line) => {
      if (line.options.interactive) {
        line.setStyle({ opacity: 0.48, weight: 3.5 });
      } else {
        line.setStyle({ opacity: 0.1, weight: 5.6 });
      }
    });
  }

  function drawNetwork(routes) {
    networkLayer.clearLayers();
    networkPolylines = [];
    networkData = routes;
    const drawnShapes = new Set();
    highlighted = false;

    for (const route of routes) {
      const shapeKey = routeShapeKey(route);
      if (drawnShapes.has(shapeKey)) continue;
      drawnShapes.add(shapeKey);

      const latlngs = route.coords.map(([lon, lat]) => [lat, lon]);
      const casing = L.polyline(latlngs, {
        color: '#EAF0FF',
        weight: 5.6,
        opacity: 0.1,
        interactive: false,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(networkLayer);

      const line = L.polyline(latlngs, {
        color: route.color,
        weight: 3.5,
        opacity: 0.48,
        lineCap: 'round',
        lineJoin: 'round',
        smoothFactor: 0.8,
        interactive: true,
      }).addTo(networkLayer);

      line.bindTooltip(tooltipElement(`${route.groupId} · ${route.groupName}`), {
        sticky: true,
        direction: 'top',
        opacity: 1,
        className: 'rapidito-tooltip',
      });

      line.on('click', (event) => {
        if (picking) return;
        L.DomEvent.stopPropagation(event);
        onLineClick?.(route);
      });

      line.on('mouseover', () => {
        if (!highlighted) line.setStyle({ opacity: 0.76, weight: 4.3 });
      });
      line.on('mouseout', () => {
        if (!highlighted) line.setStyle({ opacity: 0.48, weight: 3.5 });
      });

      networkPolylines.push(line, casing);
    }
  }

  function setNetwork(routes) {
    clearHighlight();
    drawNetwork(routes);
    highlighted = false;
    networkPolylines.forEach((line) => {
      if (line.options.interactive) {
        line.setStyle({ opacity: 0.48, weight: 3.5 });
      } else {
        line.setStyle({ opacity: 0.1, weight: 5.6 });
      }
    });
  }

  function dimNetwork() {
    networkPolylines.forEach((line) => {
      if (line.options.interactive) {
        line.setStyle({ opacity: 0.08, weight: 2.2 });
      } else {
        line.setStyle({ opacity: 0.03 });
      }
    });
    highlighted = true;
  }

  function drawHighlightedPath(route, { dashed = false } = {}) {
    const latlngs = route.coords.map(([lon, lat]) => [lat, lon]);
    L.polyline(latlngs, {
      color: '#F4F7FF',
      weight: 10,
      opacity: 0.22,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false,
    }).addTo(highlightLayer);

    L.polyline(latlngs, {
      color: route.color,
      weight: 6,
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round',
      dashArray: dashed ? '1 8' : null,
      smoothFactor: 0.8,
      interactive: false,
      className: 'selected-route-path',
    }).addTo(highlightLayer);
  }

  function renderWalking() {
    walkingLayer.clearLayers();
    if (!activeCandidate || !originMarker || !destinationMarker) return;

    const board = activeCandidate.boardStop.coord;
    const alight = activeCandidate.alightStop.coord;
    const origin = [originMarker.getLatLng().lng, originMarker.getLatLng().lat];
    const destination = [destinationMarker.getLatLng().lng, destinationMarker.getLatLng().lat];

    const legs = [
      {
        key: 'toStop',
        coords: walkingLegs.toStop ?? [origin, board],
        estimated: !walkingLegs.toStop,
      },
      {
        key: 'fromStop',
        coords: walkingLegs.fromStop ?? [alight, destination],
        estimated: !walkingLegs.fromStop,
      },
    ];

    for (const leg of legs) {
      const latlngs = leg.coords.map(([lon, lat]) => [lat, lon]);
      L.polyline(latlngs, {
        color: '#07152D',
        weight: 8,
        opacity: leg.estimated ? 0.25 : 0.4,
        interactive: false,
        lineCap: 'round',
      }).addTo(walkingLayer);

      L.polyline(latlngs, {
        color: '#F0F4FF',
        weight: 3.2,
        opacity: leg.estimated ? 0.55 : 0.95,
        dashArray: '1 9',
        lineCap: 'round',
        interactive: false,
        className: leg.estimated ? 'walk-path walk-path--estimated' : 'walk-path',
      }).addTo(walkingLayer);
    }
  }

  function showTrip({ candidate, origin, destination, focus = true }) {
    const originCoord = Array.isArray(origin) ? origin : origin?.coord;
    const destinationCoord = Array.isArray(destination) ? destination : destination?.coord;
    if (!originCoord || !destinationCoord) return;

    setOrigin(originCoord);
    setDestination(destinationCoord, {
      label: destination?.name ?? destination?.label ?? 'Destino',
    });
    activeCandidate = candidate;
    highlighted = true;

    highlightLayer.clearLayers();
    stopsLayer.clearLayers();
    walkingLegs = { toStop: null, fromStop: null };

    dimNetwork();
    drawHighlightedPath(candidate.route);

    const allStops = candidate.route.stops;
    allStops.forEach((stop, index) => {
      if (index === candidate.boardIndex || index === candidate.alightIndex) return;
      L.circleMarker([stop.coord[1], stop.coord[0]], {
        radius: 3.2,
        color: '#F4F7FF',
        weight: 1.5,
        opacity: 0.85,
        fillColor: candidate.route.color,
        fillOpacity: 0.9,
        interactive: true,
      })
        .bindTooltip(tooltipElement(stop.name), {
          direction: 'top',
          offset: [0, -5],
          opacity: 1,
          className: 'rapidito-tooltip',
        })
        .addTo(stopsLayer);
    });

    L.marker([candidate.boardStop.coord[1], candidate.boardStop.coord[0]], {
      icon: stopCalloutIcon('board', '1'),
      zIndexOffset: 800,
      keyboard: false,
      alt: `Sube en ${candidate.boardStop.name}`,
    })
      .bindTooltip(tooltipElement(`Sube: ${candidate.boardStop.name}`), {
        direction: 'top',
        offset: [0, -12],
        opacity: 1,
        className: 'rapidito-tooltip',
      })
      .addTo(stopsLayer);

    L.marker([candidate.alightStop.coord[1], candidate.alightStop.coord[0]], {
      icon: stopCalloutIcon('alight', '2'),
      zIndexOffset: 800,
      keyboard: false,
      alt: `Baja en ${candidate.alightStop.name}`,
    })
      .bindTooltip(tooltipElement(`Baja: ${candidate.alightStop.name}`), {
        direction: 'top',
        offset: [0, -12],
        opacity: 1,
        className: 'rapidito-tooltip',
      })
      .addTo(stopsLayer);

    renderWalking();

    if (focus) {
      // Encuadramos el viaje útil (origen, destino y paradas), no la línea
      // entera: una ruta de 15 km no debe convertir el tramo en un hilo.
      fitCoordinates([
        originCoord,
        destinationCoord,
        candidate.boardStop.coord,
        candidate.alightStop.coord,
      ], { maxZoom: 16 });
    }
  }

  function showWalkingRoute(leg, coordinates) {
    if (!['toStop', 'fromStop'].includes(leg)) return;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return;
    walkingLegs[leg] = coordinates;
    renderWalking();
  }

  function showNoRoute({ origin, destination, focus = true }) {
    const originCoord = Array.isArray(origin) ? origin : origin?.coord;
    const destinationCoord = Array.isArray(destination) ? destination : destination?.coord;
    if (!originCoord || !destinationCoord) return;

    clearHighlight();
    setOrigin(originCoord);
    setDestination(destinationCoord, {
      label: destination?.name ?? destination?.label ?? 'Destino',
    });
    activeCandidate = null;
    if (focus) {
      fitCoordinates([originCoord, destinationCoord], { maxZoom: 15 });
    }
  }

  function focusGroup(group) {
    clearWalking();
    clearDestination();
    activeCandidate = null;
    highlightLayer.clearLayers();
    stopsLayer.clearLayers();
    highlighted = true;
    networkPolylines.forEach((line) => {
      if (line.options.interactive) line.setStyle({ opacity: 0.07, weight: 2 });
      else line.setStyle({ opacity: 0.02 });
    });

    const coords = [];
    const drawn = new Set();
    for (const route of group.routes) {
      const shapeKey = routeShapeKey(route);
      if (drawn.has(shapeKey)) continue;
      drawn.add(shapeKey);

      const latlngs = route.coords.map(([lon, lat]) => [lat, lon]);
      L.polyline(latlngs, {
        color: '#F4F7FF',
        weight: 10,
        opacity: 0.16,
        interactive: false,
        lineCap: 'round',
      }).addTo(highlightLayer);

      L.polyline(latlngs, {
        color: route.color,
        weight: 5.5,
        opacity: 0.95,
        interactive: false,
        lineCap: 'round',
      }).addTo(highlightLayer);

      coords.push(...route.coords);
    }

    const uniqueStops = new Map();
    for (const route of group.routes) {
      for (const stop of route.stops) uniqueStops.set(stop.name, stop);
    }
    for (const stop of uniqueStops.values()) {
      L.circleMarker([stop.coord[1], stop.coord[0]], {
        radius: 4,
        color: '#fff',
        weight: 2,
        fillColor: group.color,
        fillOpacity: 1,
        interactive: true,
      })
        .bindTooltip(tooltipElement(stop.name), {
          direction: 'top',
          offset: [0, -5],
          opacity: 1,
          className: 'rapidito-tooltip',
        })
        .addTo(stopsLayer);
    }

    fitCoordinates(coords, { maxZoom: 15 });
  }

  function reset() {
    clearHighlight();
    clearWalking();
    clearDestination();
    if (originMarker) {
      fitCoordinates([originMarker.getLatLng().lng, originMarker.getLatLng().lat], { maxZoom: 14 });
    }
  }

  function startPicking(onPick) {
    if (picking) stopPicking();
    picking = true;
    container.classList.add('is-picking');
    pickHandler = (event) => {
      stopPicking();
      onPick?.([event.latlng.lng, event.latlng.lat]);
    };
    map.on('click', pickHandler);
    map.doubleClickZoom.disable();
    map.closePopup();
  }

  function stopPicking() {
    if (!picking) return;
    picking = false;
    container.classList.remove('is-picking');
    if (pickHandler) map.off('click', pickHandler);
    pickHandler = null;
    map.doubleClickZoom.enable();
  }

  function clearSelection() {
    clearHighlight();
    clearWalking();
    clearDestination();
  }

  function fitCity(instant = false) {
    const coords = networkData.flatMap((route) => route.coords);
    if (!coords.length) {
      map.setView(
        [APP_CONFIG.city.center[1], APP_CONFIG.city.center[0]],
        APP_CONFIG.city.zoom,
        { animate: !instant },
      );
      return;
    }
    const bounds = L.latLngBounds(coords.map(([lon, lat]) => [lat, lon]));
    map.fitBounds(bounds, {
      ...getViewportPadding(),
      maxZoom: 13,
      animate: !instant,
    });
  }

  function invalidateSize() {
    map.invalidateSize({ pan: false });
  }

  // Los tiles se solicitan con referer del navegador. El service worker cachea
  // únicamente los tiles ya visitados; no descarga la ciudad por adelantado.
  map.whenReady(() => requestAnimationFrame(() => map.invalidateSize({ pan: false })));

  // Si el contenedor cambia de tamaño por un panel, una rotación o el teclado
  // virtual, Leaflet recalcula su viewport una sola vez por frame.
  if (typeof ResizeObserver === 'function') {
    let resizeFrame = 0;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        map.invalidateSize({ pan: false });
      });
    });
    resizeObserver.observe(container);
  }

  return {
    map,
    setNetwork,
    setOrigin,
    setDestination,
    clearDestination,
    showTrip,
    showWalkingRoute,
    showNoRoute,
    focusGroup,
    reset,
    startPicking,
    stopPicking,
    clearSelection,
    fitCity,
    invalidateSize,
    isPicking: () => picking,
    getOriginMarker: () => originMarker,
  };
}
