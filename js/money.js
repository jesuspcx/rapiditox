/** Formatos monetarios venezolanos y tarifa normal de Rapidito. */

import { APP_CONFIG } from './config.js';

const DECIMAL_FORMATTER = new Intl.NumberFormat('es-VE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const RATE_FORMATTER = new Intl.NumberFormat('es-VE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const FARE_USD_FORMATTER = new Intl.NumberFormat('es-VE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});

export function formatUsd(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return `$${DECIMAL_FORMATTER.format(amount)}`;
}

/** Conserva el tercer decimal en tarifas como USD 0,125. */
export function formatUsdFare(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return `$${FARE_USD_FORMATTER.format(amount)}`;
}

export function formatBolivares(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Bs. —';
  return `Bs. ${DECIMAL_FORMATTER.format(amount)}`;
}

export function formatRate(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '—';
  return RATE_FORMATTER.format(amount);
}

/**
 * Convierte un monto USD a bolívares usando la tasa oficial de DolarAPI.
 * Nunca inventa una tasa de respaldo: si no hay dato, devuelve null y la
 * interfaz muestra "Bs. —".
 */
export function fareInBolivares(fareUsd, rate) {
  const fare = Number(fareUsd);
  const exchange = Number(rate);
  if (!Number.isFinite(fare) || !Number.isFinite(exchange) || exchange <= 0) {
    return null;
  }
  return Math.round(fare * exchange * 100) / 100;
}

/**
 * Tarifa normal del pasaje: USD 0,25 × tasa oficial BCV.
 * Es el único punto de cálculo del precio en bolívares para la UI.
 */
export function normalFareInBolivares(rate) {
  return fareInBolivares(APP_CONFIG.fares.normalUsd, rate);
}

/** Tarifa estudiantil: USD 0,125 × tasa oficial BCV. */
export function studentFareInBolivares(rate) {
  return fareInBolivares(APP_CONFIG.fares.studentUsd, rate);
}

/**
 * Total a pagar por una combinación de pasajes normales y estudiantiles.
 * Suma las tarifas unitarias ya redondeadas en Bs. para que el total coincida
 * con los montos que ve el usuario. Devuelve null si falta la tasa.
 */
export function fareTotalInBolivares(normalQuantity, studentQuantity, rate) {
  const normal = Math.max(0, Math.floor(Number(normalQuantity) || 0));
  const student = Math.max(0, Math.floor(Number(studentQuantity) || 0));
  if (normal === 0 && student === 0) return 0;

  const normalBs = normalFareInBolivares(rate);
  const studentBs = studentFareInBolivares(rate);
  if (normalBs === null || studentBs === null) return null;

  return Math.round((normalBs * normal + studentBs * student) * 100) / 100;
}

export function formatShortDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'sin fecha';

  return new Intl.DateTimeFormat('es-VE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** DolarAPI publica la tasa con fecha diaria; la hora 00:00 no aporta. */
export function formatRateDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'sin fecha';

  return new Intl.DateTimeFormat('es-VE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}
