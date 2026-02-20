import type { Point } from '@/types'

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
