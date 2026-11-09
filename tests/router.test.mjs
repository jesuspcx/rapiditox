import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  findDirectTrips,
  getNetworkSummary,
  prepareNetwork,
} from '../js/router.js';

function feature({
  id,
  grupo = 'T1',
  sentido = 'ida',
  coords,
  paradas,
  origin,
  destination,
  frecuenciaMin = 8,
}) {
  return {
    type: 'Feature',
    id,
    properties: {
      id,
      grupo,
      nombre: 'Línea de prueba',
      sentido,
      origen: origin,
      destino: destination,
      color: '#305CDE',
      frecuenciaMin,
      paradas,
    },
    geometry: {
      type: 'LineString',
      coordinates: coords,
    },
  };
}

function syntheticNetwork() {
  const west = [-66.9, 10.49];
  const center = [-66.85, 10.49];
  const east = [-66.8, 10.49];
  const stops = [
    { nombre: 'Oeste', coord: west },
    { nombre: 'Centro', coord: center },
    { nombre: 'Este', coord: east },
  ];

  return {
    type: 'FeatureCollection',
    features: [
      feature({
        id: 'T1-IDA',
        sentido: 'ida',
        coords: [west, center, east],
        paradas: stops,
        origin: 'Oeste',
        destination: 'Este',
      }),
      feature({
        id: 'T1-V',
        sentido: 'vuelta',
        coords: [east, center, west],
        paradas: [...stops].reverse(),
        origin: 'Este',
        destination: 'Oeste',
      }),
    ],
  };
}

test('prepareNetwork normaliza paradas, agrupa sentidos y fija la tarifa normal', () => {
  const network = prepareNetwork(syntheticNetwork());

  assert.equal(network.routes.length, 2);
  assert.equal(network.groups.length, 1);
  assert.equal(network.groups[0].endpointsLabel, 'Oeste ↔ Este');
  assert.equal(network.routes[0].stops.length, 3);
  assert.ok(network.routes[0].stops[1].alongMeters > network.routes[0].stops[0].alongMeters);
  assert.equal(network.routes[0].fareUsd, 0.25);
  assert.equal(network.groups[0].fareUsd, 0.25);
  assert.deepEqual(getNetworkSummary(network), {
    lineCount: 1,
    directionCount: 2,
    stopCount: 6,
    warnings: 0,
  });
});

test('prepareNetwork rechaza colecciones que no son GeoJSON', () => {
  assert.throws(() => prepareNetwork({ type: 'Feature' }), /FeatureCollection/);
  assert.throws(() => prepareNetwork({ type: 'FeatureCollection' }), /features/);
});

test('prepareNetwork omite líneas inválidas sin tumbar la red', () => {
  const collection = syntheticNetwork();
  collection.features.push({
    type: 'Feature',
    id: 'rota',
    properties: { id: 'rota', grupo: 'T2', paradas: [] },
    geometry: { type: 'Point', coordinates: [-66.8, 10.4] },
  });
  const network = prepareNetwork(collection);
  assert.equal(network.routes.length, 2);
  assert.equal(network.warnings.length, 1);
  assert.match(network.warnings[0], /LineString inválida/);
});

test('sugiere el sentido de ida y la parada de bajada correcta', () => {
  const network = prepareNetwork(syntheticNetwork());
  const result = findDirectTrips(
    network.routes,
    [-66.897, 10.4902],
    [-66.803, 10.4902],
  );

  assert.equal(result.candidates.length, 1);
  const trip = result.candidates[0];
  assert.equal(trip.route.direction, 'ida');
  assert.equal(trip.boardStop.name, 'Oeste');
  assert.equal(trip.alightStop.name, 'Este');
  assert.equal(trip.directionVerified, true);
  assert.equal(trip.fareUsd, 0.25);
  assert.ok(trip.directionCheck.alongDeltaM > 0);
  assert.ok(trip.totalMinutes > 0);
  assert.ok(trip.originDistanceToLineM < 100);
});

test('sugiere el sentido de vuelta para el viaje inverso', () => {
  const network = prepareNetwork(syntheticNetwork());
  const result = findDirectTrips(
    network.routes,
    [-66.803, 10.4902],
    [-66.897, 10.4902],
  );

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].route.direction, 'vuelta');
  assert.equal(result.candidates[0].boardStop.name, 'Este');
  assert.equal(result.candidates[0].alightStop.name, 'Oeste');
});

test('nunca propone viajar en el sentido contrario de una vía de un solo sentido', () => {
  const collection = syntheticNetwork();
  collection.features = collection.features.filter((item) => item.properties.sentido === 'ida');
  const network = prepareNetwork(collection);

  const opposite = findDirectTrips(
    network.routes,
    [-66.805, 10.4904],
    [-66.895, 10.4904],
  );
  assert.equal(opposite.candidates.length, 0);
  assert.equal(opposite.reason, 'no-service');
});

test('no sugiere bus cuando el destino está cerca y se puede caminar', () => {
  const network = prepareNetwork(syntheticNetwork());
  const result = findDirectTrips(
    network.routes,
    [-66.895, 10.4904],
    [-66.894, 10.4904],
  );

  assert.equal(result.reason, 'walk-only');
  assert.equal(result.candidates.length, 0);
  assert.ok(result.walkOnlyMinutes >= 1);
});

test('una red vacía es un estado válido y el motor responde sin fallar', () => {
  const network = prepareNetwork({
    type: 'FeatureCollection',
    name: 'Red vacía de prueba',
    city: 'Barquisimeto, Venezuela',
    features: [],
  });

  assert.equal(network.routes.length, 0);
  assert.equal(network.groups.length, 0);
  assert.equal(network.warnings.length, 0);
  assert.equal(network.meta.city, 'Barquisimeto, Venezuela');

  const result = findDirectTrips(
    network.routes,
    [-69.33, 10.0705],
    [-69.31, 10.0705],
  );
  assert.equal(result.reason, 'no-network');
  assert.deepEqual(result.candidates, []);
});

test('la red real carga sin advertencias, esté vacía o digitalizada', async () => {
  const raw = JSON.parse(await readFile(
    new URL('../data/rutas.json', import.meta.url),
    'utf8',
  ));
  const network = prepareNetwork(raw);

  assert.equal(raw.type, 'FeatureCollection');
  assert.equal(network.meta.city, 'Barquisimeto, Venezuela');
  assert.equal(network.routes.length, raw.features.length);
  assert.equal(network.warnings.length, 0);
});

test('ordena primero la línea que pasa más cerca del origen, aunque sea más lenta', () => {
  const nearCoords = [[-69.33, 10.070], [-69.31, 10.070]];
  const farCoords = [[-69.33, 10.0742], [-69.31, 10.0742]];
  const nearStops = [
    { nombre: 'Cerca Oeste', coord: [-69.33, 10.070] },
    { nombre: 'Cerca Este', coord: [-69.31, 10.070] },
  ];
  const farStops = [
    { nombre: 'Lejos Oeste', coord: [-69.33, 10.0742] },
    { nombre: 'Lejos Este', coord: [-69.31, 10.0742] },
  ];
  const collection = {
    type: 'FeatureCollection',
    features: [
      feature({
        id: 'CERCA-I',
        grupo: 'CERCA',
        coords: nearCoords,
        paradas: nearStops,
        origin: 'Cerca Oeste',
        destination: 'Cerca Este',
        frecuenciaMin: 30,
      }),
      feature({
        id: 'LEJOS-I',
        grupo: 'LEJOS',
        coords: farCoords,
        paradas: farStops,
        origin: 'Lejos Oeste',
        destination: 'Lejos Este',
        frecuenciaMin: 2,
      }),
    ],
  };
  const network = prepareNetwork(collection);
  const result = findDirectTrips(
    network.routes,
    [-69.33, 10.0705],
    [-69.31, 10.0705],
  );

  assert.equal(result.candidates.length, 2);
  const [first, second] = result.candidates;
  assert.equal(first.route.groupId, 'CERCA');
  assert.ok(first.originDistanceToLineM < second.originDistanceToLineM);
  // La más cercana gana aunque su espera la haga más lenta.
  assert.ok(first.totalMinutes > second.totalMinutes);
});
