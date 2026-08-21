import { describe, it, expect } from 'vitest'
import type { Point } from '@/types'
import { smoothEpsilon, simplifyPolygon, smoothPathData } from './svg'

function denseRectangle(width: number, height: number, pointsPerEdge = 200): Point[] {
  const points: Point[] = []
  for (let i = 0; i < pointsPerEdge; i++) points.push({ x: width * i / pointsPerEdge, y: 0 })
  for (let i = 0; i < pointsPerEdge; i++) points.push({ x: width, y: height * i / pointsPerEdge })
  for (let i = 0; i < pointsPerEdge; i++) points.push({ x: width - width * i / pointsPerEdge, y: height })
  for (let i = 0; i < pointsPerEdge; i++) points.push({ x: 0, y: height - height * i / pointsPerEdge })
  return points
}

function pathPoints(path: string): Point[] {
  return [...path.matchAll(/[ML]\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)]
    .map((match) => ({ x: Number(match[1]), y: Number(match[2]) }))
}

function lowerEdgeYAt(points: Point[], x: number): number {
  const intersections: number[] = []
  for (let i = 0; i < points.length; i++) {
    const p0 = points[i]
    const p1 = points[(i + 1) % points.length]
    if (p0.x === p1.x || x < Math.min(p0.x, p1.x) || x > Math.max(p0.x, p1.x)) continue
    const t = (x - p0.x) / (p1.x - p0.x)
    intersections.push(p0.y + t * (p1.y - p0.y))
  }
  return Math.min(...intersections)
}

describe('smoothEpsilon', () => {
  // must mirror backend polygon_scaler.smooth_epsilon exactly: absolute mm,
  // independent of tool size (trace noise does not scale with the tool)
  it('returns absolute values matching the backend', () => {
    expect(smoothEpsilon(0)).toBeCloseTo(0.3, 6)
    expect(smoothEpsilon(0.5)).toBeCloseTo(0.9, 6)
    expect(smoothEpsilon(1)).toBeCloseTo(1.5, 6)
  })

  it('is monotonic in level', () => {
    const eps = [0, 0.25, 0.5, 0.75, 1].map(smoothEpsilon)
    expect([...eps].sort((a, b) => a - b)).toEqual(eps)
  })
})

describe('simplifyPolygon', () => {
  it('removes near-collinear points within epsilon', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0.01 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ]
    const out = simplifyPolygon(pts, 0.3)
    expect(out.length).toBe(4)
  })
})

describe('smoothPathData', () => {
  it('preserves long straight edges away from corners', () => {
    const raw = denseRectangle(84, 20)
    const simplified = simplifyPolygon(raw, smoothEpsilon(0.5))

    const smoothed = pathPoints(smoothPathData(simplified))

    expect(lowerEdgeYAt(smoothed, 20)).toBeLessThanOrEqual(0.1)
  })
})
