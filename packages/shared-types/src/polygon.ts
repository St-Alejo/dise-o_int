/**
 * Geometría de polígonos en planta (plano XZ) para cuartos que no son un rectángulo: en L, en T,
 * en U o con las paredes que el usuario dibuje. Funciones puras, sin dependencias.
 *
 * Convención de giro: un polígono "canónico" tiene área con signo positiva, que es el orden del
 * cuarto rectangular (0,0) → (ancho,0) → (ancho,fondo) → (0,fondo). Con ese orden, la normal
 * interior de un lado con dirección (dx, dz) es (−dz, dx).
 */

export interface Point2 {
  x: number;
  z: number;
}

const EPS = 1e-9;

/** Área con signo (fórmula del cordón). Positiva en el orden canónico. */
export function signedArea(poly: readonly Point2[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    sum += a.x * b.z - b.x * a.z;
  }
  return sum / 2;
}

/** El mismo polígono en el orden canónico (lo invierte si venía al revés). */
export function ensureWinding(poly: readonly Point2[]): Point2[] {
  return signedArea(poly) >= 0 ? [...poly] : [...poly].reverse();
}

export function polygonBounds(poly: readonly Point2[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const xs = poly.map((p) => p.x);
  const zs = poly.map((p) => p.z);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

/** Punto del segmento a–b más cercano a p. */
export function closestOnSegment(p: Point2, a: Point2, b: Point2): Point2 {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  if (len2 < EPS) return { ...a };
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
  return { x: a.x + dx * t, z: a.z + dz * t };
}

export function distanceToSegment(p: Point2, a: Point2, b: Point2): number {
  const q = closestOnSegment(p, a, b);
  return Math.hypot(p.x - q.x, p.z - q.z);
}

/** Punto del borde del polígono más cercano a p. */
export function closestOnBoundary(p: Point2, poly: readonly Point2[]): Point2 {
  let best = poly[0]!;
  let bestD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const q = closestOnSegment(p, poly[i]!, poly[(i + 1) % poly.length]!);
    const d = Math.hypot(p.x - q.x, p.z - q.z);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}

export function distanceToBoundary(p: Point2, poly: readonly Point2[]): number {
  const q = closestOnBoundary(p, poly);
  return Math.hypot(p.x - q.x, p.z - q.z);
}

/** ¿El punto está dentro del polígono? Estar sobre el borde (con `tolerance`) cuenta como dentro. */
export function pointInPolygon(p: Point2, poly: readonly Point2[], tolerance = 0): boolean {
  if (distanceToBoundary(p, poly) <= tolerance + EPS) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

const orient = (a: Point2, b: Point2, c: Point2) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);

/** ¿Los segmentos a–b y c–d se cruzan de verdad? Tocarse en un extremo o ir pegados no cuenta. */
export function segmentsCross(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < -EPS && o3 * o4 < -EPS;
}

/** Un polígono es simple si ningún lado cruza a otro. */
export function isSimplePolygon(poly: readonly Point2[]): boolean {
  const n = poly.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (segmentsCross(poly[i]!, poly[(i + 1) % n]!, poly[j]!, poly[(j + 1) % n]!)) return false;
    }
  }
  return Math.abs(signedArea(poly)) > EPS;
}

/** ¿El vértice `i` es una esquina saliente del cuarto (convexa)? Las entrantes son las de una L. */
export function isConvexVertex(poly: readonly Point2[], i: number): boolean {
  const n = poly.length;
  const turn = orient(poly[(i - 1 + n) % n]!, poly[i]!, poly[(i + 1) % n]!);
  return signedArea(poly) >= 0 ? turn > EPS : turn < -EPS;
}

/**
 * ¿El cuadrilátero `corners` (la huella de un mueble, con centro `center`) cabe entero dentro del
 * polígono? Además de las esquinas se comprueba que ningún lado del polígono lo atraviese: en un
 * cuarto en L un mueble puede tener las cuatro esquinas dentro y aun así montarse en la muesca.
 */
export function quadInsidePolygon(corners: readonly Point2[], center: Point2, poly: readonly Point2[], tolerance = 0.005): boolean {
  for (const c of corners) if (!pointInPolygon(c, poly, tolerance)) return false;
  // Se encoge un poco hacia su centro para que apoyarse contra una pared no cuente como cruce.
  const shrunk = corners.map((c) => {
    const d = Math.hypot(center.x - c.x, center.z - c.z) || 1;
    const k = Math.min(1, (tolerance + 0.002) / d);
    return { x: c.x + (center.x - c.x) * k, z: c.z + (center.z - c.z) * k };
  });
  for (let i = 0; i < shrunk.length; i++) {
    const a = shrunk[i]!;
    const b = shrunk[(i + 1) % shrunk.length]!;
    for (let j = 0; j < poly.length; j++) {
      if (segmentsCross(a, b, poly[j]!, poly[(j + 1) % poly.length]!)) return false;
    }
  }
  return true;
}

/**
 * Punto interior más alejado de las paredes (aproximado con una rejilla): el "centro" útil de un
 * cuarto que puede ser cóncavo, donde el centro de la caja envolvente puede caer fuera.
 */
export function interiorAnchor(poly: readonly Point2[]): Point2 {
  const b = polygonBounds(poly);
  const center = { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
  const steps = 40;
  let best = center;
  let bestD = -1;
  let bestToCenter = Infinity;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const p = { x: b.minX + ((b.maxX - b.minX) * i) / steps, z: b.minZ + ((b.maxZ - b.minZ) * j) / steps };
      if (!pointInPolygon(p, poly)) continue;
      const d = distanceToBoundary(p, poly);
      const toCenter = Math.hypot(p.x - center.x, p.z - center.z);
      // A igual holgura gana el más cercano al centro (en un rectángulo, su centro exacto).
      if (d > bestD + 1e-6 || (Math.abs(d - bestD) <= 1e-6 && toCenter < bestToCenter)) {
        best = p;
        bestD = d;
        bestToCenter = toCenter;
      }
    }
  }
  return best;
}
