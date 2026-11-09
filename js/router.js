/**
 * Rapidito · motor de coincidencia de rutas
 *
 * Toda la red es externa (GeoJSON). Este módulo:
 *  1. Valida y normaliza las líneas.
 *  2. Proyecta origen y destino sobre la geometría.
 *  3. Ordena las paradas por avance y solo combina pares con avance positivo.
 *  4. Estima caminata, espera y viaje para elegir la mejor opción.
 *
 * No toca el DOM ni conoce Leaflet: es testeable en Node.
 */

import { APP_CONFIG } from './config.js';
import {
  bearingDegrees,
  distanceMeters,
  isValidCoord,
  isValidLine,
  lineLengthMeters,
  projectOnLine,
} from './geo.js';

const DEFAULT_COLOR = '#305CDE';
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function round(value, decimals = 0) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normalizeColor(value) {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value : DEFAULT_COLOR;
}

function toPositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeStop(rawStop, routeId, index) {
  if (!rawStop || !isValidCoord(rawStop.coord)) return null;

  return {
    id: `${routeId}:stop:${index}`,
    name: typeof rawStop.nombre === 'string' && rawStop.nombre.trim()
      ? rawStop.nombre.trim()
      : `Parada ${index + 1}`,
    coord: [Number(rawStop.coord[0]), Number(rawStop.coord[1])],
    originalIndex: index,
  };
}

/**
 * Normaliza una FeatureCollection GeoJSON.
 * Las líneas inválidas se omiten y se reportan en `warnings` para que un dato
 * defectuoso no tumbe toda la red.
 */
export function prepareNetwork(featureCollection) {
  if (!featureCollection || featureCollection.type !== 'FeatureCollection') {
    throw new Error('rutas.json debe ser una FeatureCollection GeoJSON.');
  }
  if (!Array.isArray(featureCollection.features)) {
    throw new Error('La FeatureCollection no contiene un arreglo "features".');
  }

  const routes = [];
  const warnings = [];
  const seenIds = new Set();

  featureCollection.features.forEach((feature, featureIndex) => {
    const props = feature?.properties ?? {};
    const coords = feature?.geometry?.coordinates;
    const routeId = String(props.id ?? feature?.id ?? `ruta-${featureIndex + 1}`);

    if (feature?.geometry?.type !== 'LineString' || !isValidLine(coords)) {
      warnings.push(`${routeId}: geometría LineString inválida.`);
      return;
    }
    if (seenIds.has(routeId)) {
      warnings.push(`${routeId}: id duplicado, se omitió la segunda aparición.`);
      return;
    }
    if (!props.grupo) {
      warnings.push(`${routeId}: falta properties.grupo.`);
      return;
    }

    const stops = (Array.isArray(props.paradas) ? props.paradas : [])
      .map((stop, stopIndex) => normalizeStop(stop, routeId, stopIndex))
      .filter(Boolean)
      .map((stop) => {
        const projection = projectOnLine(coords, stop.coord);
        return projection
          ? {
              ...stop,
              coord: projection.point,
              alongMeters: projection.alongMeters,
              distanceToGeometryM: projection.distanceMeters,
            }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.alongMeters - b.alongMeters);

    if (stops.length < 2) {
      warnings.push(`${routeId}: se necesitan al menos dos paradas válidas.`);
      return;
    }

    const groupId = String(props.grupo).trim();
    const groupName = typeof props.nombre === 'string' && props.nombre.trim()
      ? props.nombre.trim()
      : `Línea ${groupId}`;

    const normalized = {
      id: routeId,
      groupId,
      groupName,
      direction: props.sentido === 'vuelta' ? 'vuelta' : 'ida',
      directionLabel: props.destino ? String(props.destino) : 'destino',
      from: typeof props.origen === 'string' ? props.origen : stops[0].name,
      to: typeof props.destino === 'string' ? props.destino : stops.at(-1).name,
      color: normalizeColor(props.color),
      coords: coords.map((coord) => [Number(coord[0]), Number(coord[1])]),
      lengthMeters: lineLengthMeters(coords),
      stops,
      // La tarifa normal es una regla de la app, no un dato editable por línea.
      fareUsd: APP_CONFIG.fares.normalUsd,
      frequencyMin: toPositiveNumber(props.frecuenciaMin, APP_CONFIG.routing.defaultFrequencyMin),
      serviceHours: typeof props.horario === 'string' ? props.horario : null,
      accessibility: props.accesible !== false,
      source: typeof props.fuente === 'string' ? props.fuente : null,
      updatedAt: typeof props.actualizado === 'string' ? props.actualizado : null,
      warnings: [],
      feature,
    };

    const skippedStops = (Array.isArray(props.paradas) ? props.paradas.length : 0) - stops.length;
    if (skippedStops > 0) {
      normalized.warnings.push(`${skippedStops} parada(s) descartada(s) por datos inválidos.`);
    }

    seenIds.add(routeId);
    routes.push(normalized);
  });

  const groupsById = new Map();
  for (const route of routes) {
    if (!groupsById.has(route.groupId)) {
      groupsById.set(route.groupId, {
        id: route.groupId,
        name: route.groupName,
        color: route.color,
        routes: [],
        endpointsLabel: '',
        fareUsd: route.fareUsd,
        frequencyMin: route.frequencyMin,
        serviceHours: route.serviceHours,
      });
    }

    const group = groupsById.get(route.groupId);
    group.routes.push(route);
    group.fareUsd = Math.min(group.fareUsd, route.fareUsd);
    group.frequencyMin = Math.min(group.frequencyMin, route.frequencyMin);
    group.serviceHours = group.serviceHours ?? route.serviceHours;
  }

  for (const group of groupsById.values()) {
    group.routes.sort((a, b) => a.direction.localeCompare(b.direction));

    const primary = group.routes.find((route) => route.direction === 'ida') ?? group.routes[0];
    const hasReturn = group.routes.some(
      (route) => route.from === primary.to && route.to === primary.from,
    );
    const endpoints = [...new Set(group.routes.flatMap((route) => [route.from, route.to]))];

    group.endpointsLabel = hasReturn
      ? `${primary.from} ↔ ${primary.to}`
      : endpoints.join(' · ');
  }

  const groups = [...groupsById.values()];

  return {
    routes,
    groups,
    warnings,
    meta: {
      name: typeof featureCollection.name === 'string' ? featureCollection.name : null,
      city: typeof featureCollection.city === 'string' ? featureCollection.city : null,
      updatedAt: typeof featureCollection.updated_at === 'string'
        ? featureCollection.updated_at
        : null,
      disclaimer: typeof featureCollection.disclaimer === 'string'
        ? featureCollection.disclaimer
        : null,
    },
  };
}

function walkingMeters(straightMeters, factor) {
  return straightMeters * factor;
}

function minutesForMeters(meters, speedKmh) {
  return (meters / 1000) / speedKmh * 60;
}

/**
 * Encuentra viajes directos (sin transbordo) para un origen y destino.
 *
 * La línea de cada parada se ordena por su avance acumulado sobre la
 * geometría. Solo se consideran pares board→alight con alongMeters creciente;
 * esa es la garantía matemática de que el autobús va en el sentido correcto.
 *
 * @param {Array} routes resultado de prepareNetwork().routes
 * @param {[number, number]} origin [lon, lat]
 * @param {[number, number]} destination [lon, lat]
 * @param {Partial<typeof APP_CONFIG.routing>} options
 */
export function findDirectTrips(routes, origin, destination, options = {}) {
  const cfg = { ...APP_CONFIG.routing, ...options };
  const empty = (reason, extra = {}) => ({
    candidates: [],
    reason,
    options: cfg,
    ...extra,
  });

  if (!isValidCoord(origin) || !isValidCoord(destination)) {
    return empty('invalid-coordinates');
  }
  if (!Array.isArray(routes) || routes.length === 0) {
    return empty('no-network');
  }

  const straightDistanceM = distanceMeters(origin, destination);
  if (straightDistanceM <= cfg.minWalkOnlyM) {
    return empty('walk-only', {
      straightDistanceM: round(straightDistanceM),
      walkOnlyMinutes: Math.max(1, Math.ceil(minutesForMeters(
        walkingMeters(straightDistanceM, cfg.walkDetourFactor),
        cfg.walkSpeedKmh,
      ))),
    });
  }

  const bestByGroup = new Map();

  for (const route of routes) {
    if (!isValidLine(route.coords) || route.stops.length < 2) continue;

    // Distancia real del origen al punto más cercano de esta línea. Es el
    // criterio principal de ordenación que verá el usuario.
    const originOnLine = projectOnLine(route.coords, origin);
    if (!originOnLine) continue;
    const originDistanceToLineM = originOnLine.distanceMeters;

    let bestForRoute = null;

    for (const boardStop of route.stops) {
      const originStraight = distanceMeters(origin, boardStop.coord);
      const originWalkM = walkingMeters(originStraight, cfg.walkDetourFactor);
      if (originWalkM > cfg.maxWalkToStopM) continue;

      for (const alightStop of route.stops) {
        const rideMeters = alightStop.alongMeters - boardStop.alongMeters;
        if (rideMeters < cfg.minRideM) continue;

        const destinationStraight = distanceMeters(destination, alightStop.coord);
        const destinationWalkM = walkingMeters(destinationStraight, cfg.walkDetourFactor);
        if (destinationWalkM > cfg.maxWalkFromStopM) continue;

        const stopsBetween = alightStop.originalIndex - boardStop.originalIndex;
        const boardIndex = route.stops.indexOf(boardStop);
        const alightIndex = route.stops.indexOf(alightStop);
        if (alightIndex <= boardIndex) continue;

        const walkToMinutes = minutesForMeters(originWalkM, cfg.walkSpeedKmh);
        const walkFromMinutes = minutesForMeters(destinationWalkM, cfg.walkSpeedKmh);
        const waitMinutes = route.frequencyMin / 2;
        const rideMinutes = minutesForMeters(rideMeters, cfg.busSpeedKmh)
          + (Math.max(0, alightIndex - boardIndex - 1) * cfg.dwellSecondsPerStop) / 60;
        const totalMinutes = walkToMinutes + waitMinutes + rideMinutes + walkFromMinutes;

        const candidate = {
          id: `${route.id}:${boardIndex}:${alightIndex}`,
          route,
          boardStop,
          alightStop,
          boardIndex,
          alightIndex,
          rideMeters,
          rideStops: Math.max(0, alightIndex - boardIndex),
          stopsBetween,
          originWalkM,
          destinationWalkM,
          walkToMinutes,
          walkFromMinutes,
          waitMinutes,
          rideMinutes,
          totalMinutes,
          originDistanceToLineM,
          frequencyMin: route.frequencyMin,
          fareUsd: route.fareUsd,
          directionVerified: true,
          directionCheck: {
            fromAlongM: round(boardStop.alongMeters, 1),
            toAlongM: round(alightStop.alongMeters, 1),
            alongDeltaM: round(rideMeters, 1),
            bearing: round(bearingDegrees(boardStop.coord, alightStop.coord)),
          },
        };

        if (!bestForRoute || candidate.totalMinutes < bestForRoute.totalMinutes) {
          bestForRoute = candidate;
        }
      }
    }

    if (!bestForRoute) continue;

    const existing = bestByGroup.get(route.groupId);
    if (
      !existing
      || bestForRoute.originDistanceToLineM < existing.originDistanceToLineM
      || (
        bestForRoute.originDistanceToLineM === existing.originDistanceToLineM
        && bestForRoute.totalMinutes < existing.totalMinutes
      )
    ) {
      bestByGroup.set(route.groupId, bestForRoute);
    }
  }

  const candidates = [...bestByGroup.values()]
    .sort((a, b) => (
      // Regla de producto: primero la línea que pasa más cerca del origen.
      a.originDistanceToLineM - b.originDistanceToLineM
      || a.totalMinutes - b.totalMinutes
      || a.originWalkM - b.originWalkM
      || a.route.groupName.localeCompare(b.route.groupName)
    ))
    .slice(0, cfg.maxCandidates)
    .map((candidate) => ({
      ...candidate,
      totalMinutes: Math.max(1, Math.round(candidate.totalMinutes)),
      walkingMinutes: Math.max(1, Math.round(candidate.walkToMinutes + candidate.walkFromMinutes)),
      walkToMinutes: Math.max(1, Math.round(candidate.walkToMinutes)),
      walkFromMinutes: Math.max(1, Math.round(candidate.walkFromMinutes)),
      waitMinutes: Math.max(0, Math.round(candidate.waitMinutes)),
      rideMinutes: Math.max(1, Math.round(candidate.rideMinutes)),
      originDistanceToLineM: Math.round(candidate.originDistanceToLineM),
      originWalkM: Math.round(candidate.originWalkM),
      destinationWalkM: Math.round(candidate.destinationWalkM),
      rideMeters: Math.round(candidate.rideMeters),
    }));

  if (!candidates.length) {
    return empty('no-service', { straightDistanceM: round(straightDistanceM) });
  }

  return {
    candidates,
    reason: null,
    options: cfg,
    straightDistanceM: round(straightDistanceM),
  };
}

/** Resumen para la hoja "Líneas de la ciudad". */
export function getNetworkSummary(network) {
  return {
    lineCount: network.groups.length,
    directionCount: network.routes.length,
    stopCount: network.routes.reduce((sum, route) => sum + route.stops.length, 0),
    warnings: network.warnings.length,
  };
}
