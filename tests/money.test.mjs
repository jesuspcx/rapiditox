import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fareInBolivares,
  fareTotalInBolivares,
  formatBolivares,
  formatRate,
  formatRateDate,
  formatUsd,
  formatUsdFare,
  formatShortDate,
  normalFareInBolivares,
  studentFareInBolivares,
} from '../js/money.js';

test('convierte una tarifa USD con la tasa BCV recibida', () => {
  assert.equal(fareInBolivares(0.5, 896.1225), 448.06);
  assert.equal(fareInBolivares(0.4, 896.1225), 358.45);
  assert.equal(fareInBolivares(0.65, 896.1225), 582.48);
});

test('nunca inventa una tasa cuando falta o es inválida', () => {
  assert.equal(fareInBolivares(0.5, null), null);
  assert.equal(fareInBolivares(0.5, 0), null);
  assert.equal(fareInBolivares(Number.NaN, 896), null);
});

test('la tarifa normal es USD 0,25 y se multiplica por la tasa BCV', () => {
  assert.equal(normalFareInBolivares(896.1225), 224.03);
  assert.equal(normalFareInBolivares(null), null);
  assert.equal(normalFareInBolivares(0), null);
});

test('la tarifa estudiantil es USD 0,125 y se multiplica por la tasa BCV', () => {
  assert.equal(studentFareInBolivares(896.1225), 112.02);
  assert.equal(studentFareInBolivares(null), null);
  assert.equal(studentFareInBolivares(0), null);
});

test('suma pasajes normales y estudiantiles para el total a pagar', () => {
  assert.equal(fareTotalInBolivares(0, 0, 896.1225), 0);
  assert.equal(fareTotalInBolivares(0, 0, null), 0);
  assert.equal(fareTotalInBolivares(1, 0, 896.1225), 224.03);
  assert.equal(fareTotalInBolivares(0, 1, 896.1225), 112.02);
  assert.equal(fareTotalInBolivares(2, 1, 896.1225), 560.08);
  assert.equal(fareTotalInBolivares(2, 1, null), null);
  assert.equal(fareTotalInBolivares(-2, -1, 896.1225), 0);
});

test('formatea bolívares y dólares con coma decimal venezolana', () => {
  assert.equal(formatUsd(0.5), '$0,50');
  assert.equal(formatUsdFare(0.125), '$0,125');
  assert.equal(formatUsdFare(0.25), '$0,25');
  assert.equal(formatBolivares(448.06), 'Bs. 448,06');
  assert.equal(formatRate(896.1225), '896,1225');
});

test('fechas inválidas no rompen la interfaz', () => {
  assert.equal(formatShortDate('no-es-fecha'), 'sin fecha');
  assert.notEqual(formatShortDate('2026-11-06T04:00:00.000Z'), 'sin fecha');
  assert.equal(formatRateDate('no-es-fecha'), 'sin fecha');
});

test('la tasa muestra fecha diaria, no una hora ficticia', () => {
  const formatted = formatRateDate('2026-11-06T00:00:00-04:00');
  assert.match(formatted, /2026/);
  assert.doesNotMatch(formatted, /\d{2}:\d{2}/);
});
