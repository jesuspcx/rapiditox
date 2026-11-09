/**
 * Rapidito · geometría de la red
 * Utilidades sin dependencias para proyectar puntos sobre una LineString
 * y razonar sobre el sentido de circulación de una ruta.
 *
 * Convención: [longitud, latitud] (GeoJSON).
 */

export const EARTH_RADIUS_M = 6371008.8;
const DEG = Math.PI / 180;

export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isValidCoord(coord) {
  return Array.isArray(coord)
    && coord.length >= 2
    && isFiniteNumber(coord[0])
    && isFiniteNumber(coord[1])
    && coord[0] >= -180
    && coord[0] <= 180
    && coord[1] >= -90
    && coord[1] <= 90;
}

export function isValidLine(coords) {
  return Array.isArray(coords)
    && coords.length >= 2
    && coords.every(isValidCoord);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Distancia geodésica (haversine) en metros. */
export function distanceMeters(a, b) {
  if (!isValidCoord(a) || !isValidCoord(b)) return Number.NaN;

  const lat1 = a[1] * DEG;
  const lat2 = b[1] * DEG;
  const dLat = (b[1] - a[1]) * DEG;
  const dLon = (b[0] - a[0]) * DEG;

  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rumbo inicial de a hacia b, en grados (0 = norte, 90 = este). */
export function bearingDegrees(a, b) {
  if (!isValidCoord(a) || !isValidCoord(b)) return Number.NaN;

  const lat1 = a[1] * DEG;
  const lat2 = b[1] * DEG;
  const dLon = (b[0] - a[0]) * DEG;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/** Longitud total de una polilínea, en metros. */
export function lineLengthMeters(coords) {
  if (!isValidLine(coords)) return 0;

  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    total += distanceMeters(coords[i - 1], coords[i]);
  }
  return total;
}

/**
 * Proyecta un punto sobre una polilínea.
 *
 * Cada segmento se evalúa en un plano local equirectangular (metros).
 * El resultado es la proyección ortogonal más cercana, su distancia y su
 * posición acumulada (alongMeters) sobre la línea. Esa posición es la que
 * permite saber si un destino está delante o detrás del abordaje.
 *
 * @returns {null | {
 *   point: [number, number], distanceMeters: number,
 *   alongMeters: number, totalMeters: number,
 *   segmentIndex: number, t: number, bearing: number
 * }}
 */
export function projectOnLine(coords, point) {
  if (!isValidLine(coords) || !isValidCoord(point)) return null;

  const lat0 = point[1] * DEG;
  const metersPerLon = EARTH_RADIUS_M * DEG * Math.cos(lat0);
  const metersPerLat = EARTH_RADIUS_M * DEG;

  let cumulative = 0;
  let best = null;

  for (let i = 0; i < coords.length - 1; i += 1) {
    const a = coords[i];
    const b = coords[i + 1];
    const segmentLength = distanceMeters(a, b);

    if (segmentLength < 0.01) continue;

    // Sistema local con origen en `point`; así medimos el vector al segmento.
    const ax = (a[0] - point[0]) * metersPerLon;
    const ay = (a[1] - point[1]) * metersPerLat;
    const bx = (b[0] - point[0]) * metersPerLon;
    const by = (b[1] - point[1]) * metersPerLat;
    const dx = bx - ax;
    const dy = by - ay;
    const denominator = dx * dx + dy * dy;
    const t = denominator > 0 ? clamp(-(ax * dx + ay * dy) / denominator, 0, 1) : 0;

    const nearestX = ax + t * dx;
    const nearestY = ay + t * dy;
    const distance = Math.hypot(nearestX, nearestY);
    const snap = [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
    ];

    if (!best || distance < best.distanceMeters) {
      best = {
        point: snap,
        distanceMeters: distance,
        alongMeters: cumulative + segmentLength * t,
        segmentIndex: i,
        t,
        bearing: bearingDegrees(a, b),
      };
    }

    cumulative += segmentLength;
  }

  if (!best) return null;

  return {
    ...best,
    totalMeters: cumulative,
  };
}

/**
 * Muestrea la longitud recorrida entre dos posiciones de la ruta.
 * Devuelve un valor positivo si el destino está más adelante en el sentido
 * de la geometría. La validación estricta de sentido vive en router.js.
 */
export function alongDelta(fromAlong, toAlong) {
  if (!isFiniteNumber(fromAlong) || !isFiniteNumber(toAlong)) {
    return Number.NaN;
  }
  return toAlong - fromAlong;
}

/**
 * Simplificación Douglas-Peucker para preparar datos o depurar geometrías.
 * No se usa en tiempo de matching; la geometría completa ofrece más precisión.
 */
export function simplifyLine(coords, toleranceMeters = 5) {
  if (!isValidLine(coords) || !(toleranceMeters > 0)) return coords;

  const keep = new Set([0, coords.length - 1]);
  const stack = [[0, coords.length - 1]];

  while (stack.length) {
    const [start, end] = stack.pop();
    if (end - start < 2) continue;

    const segment = [coords[start], coords[end]];
    let farthestIndex = -1;
    let farthestDistance = 0;

    for (let i = start + 1; i < end; i += 1) {
      const projection = projectOnLine(segment, coords[i]);
      const distance = projection?.distanceMeters ?? 0;
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthestIndex = i;
      }
    }

    if (farthestDistance > toleranceMeters && farthestIndex !== -1) {
      keep.add(farthestIndex);
      stack.push([start, farthestIndex], [farthestIndex, end]);
    }
  }

  return [...keep].sort((a, b) => a - b).map((index) => coords[index]);
}
