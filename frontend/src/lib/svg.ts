import type { Point } from '@/types'

// Two millimetres keeps a smoothed right-angle corner within about 0.4mm.
// Mirrored in backend polygon_scaler.py; keep preview and generation in lockstep.
const CHAIKIN_CORNER_SPAN_MM = 2

// ramer-douglas-peucker polygon simplification
function perpendicularDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function rdpSimplify(pts: Point[], epsilon: number): Point[] {
  if (pts.length <= 2) return pts
  let maxDist = 0, maxIdx = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpendicularDist(pts[i], pts[0], pts[pts.length - 1])
    if (d > maxDist) { maxDist = d; maxIdx = i }
  }
  if (maxDist > epsilon) {
    const left = rdpSimplify(pts.slice(0, maxIdx + 1), epsilon)
    const right = rdpSimplify(pts.slice(maxIdx), epsilon)
    return [...left.slice(0, -1), ...right]
  }
  return [pts[0], pts[pts.length - 1]]
}

export function simplifyPolygon(pts: Point[], epsilon: number): Point[] {
  if (pts.length <= 3 || epsilon <= 0) return pts
  // close the loop for RDP, then re-open
  const closed = [...pts, pts[0]]
  const simplified = rdpSimplify(closed, epsilon)
  // remove duplicate closing point
  if (simplified.length > 1) simplified.pop()
  return simplified.length >= 3 ? simplified : pts
}

/**
 * Build an SVG path `d` string for a polygon with optional interior holes.
 * Uses the evenodd fill rule to punch holes.
 */
export function polygonPathData(
  points: Point[],
  holes?: Point[][],
  scale?: number,
): string {
  const s = scale ?? 1
  let d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * s} ${p.y * s}`)
    .join(' ') + ' Z'
  for (const hole of holes ?? []) {
    d +=
      ' ' +
      hole
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * s} ${p.y * s}`)
        .join(' ') +
      ' Z'
  }
  return d
}

// chaikin corner-cutting subdivision (matches backend exactly).
// always stays within the control polygon — never overshoots.
function chaikinSmooth(pts: Point[], iterations = 3): Point[] {
  let result = pts
  for (let iter = 0; iter < iterations; iter++) {
    const next: Point[] = []
    const n = result.length
    for (let i = 0; i < n; i++) {
      const p0 = result[i]
      const p1 = result[(i + 1) % n]
      next.push({ x: 0.75 * p0.x + 0.25 * p1.x, y: 0.75 * p0.y + 0.25 * p1.y })
      next.push({ x: 0.25 * p0.x + 0.75 * p1.x, y: 0.25 * p0.y + 0.75 * p1.y })
    }
    result = next
  }
  return result
}

function addChaikinSupportPoints(pts: Point[]): Point[] {
  const result: Point[] = []
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[i]
    const p1 = pts[(i + 1) % pts.length]
    result.push(p0)
    const length = Math.hypot(p1.x - p0.x, p1.y - p0.y)
    if (length <= CHAIKIN_CORNER_SPAN_MM) continue
    const supportPositions = length <= 2 * CHAIKIN_CORNER_SPAN_MM
      ? [0.5]
      : [CHAIKIN_CORNER_SPAN_MM / length, 1 - CHAIKIN_CORNER_SPAN_MM / length]
    for (const t of supportPositions) {
      result.push({
        x: p0.x + (p1.x - p0.x) * t,
        y: p0.y + (p1.y - p0.y) * t,
      })
    }
  }
  return result
}

// clean near-collinear points (matches backend's post-chaikin simplify)
function cleanChaikinOutput(pts: Point[]): Point[] {
  return simplifyPolygon(pts, 0.05)
}

/**
 * Smooth a ring via chaikin subdivision, render as polyline path.
 * Matches the backend STL pipeline exactly.
 */
function smoothRingPath(pts: Point[], s: number): string {
  if (pts.length < 3) return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * s} ${p.y * s}`).join(' ') + ' Z'
  const smoothed = cleanChaikinOutput(chaikinSmooth(addChaikinSupportPoints(pts)))
  return smoothed.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * s} ${p.y * s}`).join(' ') + ' Z'
}

export function smoothPathData(
  points: Point[],
  holes?: Point[][],
  scale?: number,
): string {
  const s = scale ?? 1
  let d = smoothRingPath(points, s)
  for (const hole of holes ?? []) {
    d += ' ' + smoothRingPath(hole, s)
  }
  return d
}

// DP tolerance for smoothing, absolute mm. trace noise is a property of the
// camera/mask resolution, not the tool, so it must not scale with size.
// mirrors backend polygon_scaler.smooth_epsilon; keep in lockstep.
export function smoothEpsilon(level: number): number {
  const lv = Math.max(0, Math.min(1, level))
  return 0.3 + lv * 1.2
}

// RDP tolerance for the node-count slider. `accuracy` runs 1 (keep every vertex)
// down to 0 (aggressive). Quadratic so the accurate end stays fine-grained while
// the simple end decimates hard (up to ~6% of the bounding-box diagonal).
export function simplifyEpsilon(points: Point[], accuracy: number): number {
  if (accuracy >= 1) return 0
  let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity
  for (const p of points) { mnX = Math.min(mnX, p.x); mnY = Math.min(mnY, p.y); mxX = Math.max(mxX, p.x); mxY = Math.max(mxY, p.y) }
  const diag = Math.hypot(mxX - mnX, mxY - mnY)
  const t = 1 - Math.max(0, accuracy)
  return diag * 0.06 * t * t
}

export function snapToGrid(v: number, grid: number): number {
  return Math.round(v / grid) * grid
}
