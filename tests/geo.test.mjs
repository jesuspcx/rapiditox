import test from 'node:test';
import assert from 'node:assert/strict';

import {
  distanceMeters,
  isValidLine,
  lineLengthMeters,
  projectOnLine,
  simplifyLine,
} from '../js/geo.js';

const near = (actual, expected, tolerance, message) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: esperado ~${expected}, recibido ${actual}`,
  );
};

test('distanceMeters calcula una distancia geodésica razonable', () => {
  const a = [-66.9, 10.5];
  const b = [-66.9, 10.6];
  near(distanceMeters(a, b), 11119.5, 5, '0,1° de latitud');
});

test('projectOnLine proyecta un punto sobre el segmento y acumula avance', () => {
  const line = [[-66.9, 10.5], [-66.8, 10.5]];
  const projection = projectOnLine(line, [-66.85, 10.501]);

  assert.ok(projection);
  near(projection.alongMeters, projection.totalMeters / 2, 1, 'punto medio');
  near(projection.distanceMeters, 111.2, 1, 'distancia perpendicular');
  near(projection.point[0], -66.85, 0.0001, 'longitud proyectada');
  near(projection.point[1], 10.5, 0.0001, 'latitud proyectada');
});

test('la proyección invierte el avance cuando la geometría va al revés', () => {
  const east = projectOnLine([[-66.9, 10.5], [-66.8, 10.5]], [-66.82, 10.5]);
  const west = projectOnLine([[-66.8, 10.5], [-66.9, 10.5]], [-66.82, 10.5]);

  assert.ok(east.alongMeters > east.totalMeters * 0.75);
  assert.ok(west.alongMeters < west.totalMeters * 0.25);
  assert.ok(east.alongMeters > west.alongMeters);
});

test('proyecta correctamente en el segundo segmento de una polilínea', () => {
  const line = [[-66.9, 10.5], [-66.85, 10.5], [-66.85, 10.55]];
  const projection = projectOnLine(line, [-66.851, 10.53]);

  assert.ok(projection);
  assert.equal(projection.segmentIndex, 1);
  assert.ok(projection.alongMeters > lineLengthMeters([line[0], line[1]]) - 1);
});

test('lineLengthMeters y simplifyLine conservan los extremos', () => {
  const line = [[-66.9, 10.5], [-66.89, 10.5], [-66.88, 10.501], [-66.87, 10.5]];
  const length = lineLengthMeters(line);
  assert.ok(length > 3000 && length < 3400);

  const simplified = simplifyLine(line, 5);
  assert.deepEqual(simplified[0], line[0]);
  assert.deepEqual(simplified.at(-1), line.at(-1));
  assert.ok(simplified.length <= line.length);
});

test('isValidLine rechaza coordenadas incompletas o fuera de rango', () => {
  assert.equal(isValidLine([[-66.9, 10.5], [-66.8, 10.5]]), true);
  assert.equal(isValidLine([[-66.9, 10.5]]), false);
  assert.equal(isValidLine([[-66.9, 95], [-66.8, 10.5]]), false);
  assert.equal(isValidLine([[-66.9, 10.5], [null, 10.5]]), false);
});

test('projectOnLine devuelve null ante entradas inválidas', () => {
  assert.equal(projectOnLine([], [-66.9, 10.5]), null);
  assert.equal(projectOnLine([[-66.9, 10.5], [-66.8, 10.5]], [null, 10.5]), null);
});
