import { describe, expect, it } from 'vitest'
import type { BinSummary, ProjectBinPlacement } from '@/types'
import { GRID_UNIT } from '@/lib/constants'
import {
  HALF_GRID_SNAP,
  autoArrange,
  binById,
  binFootprint,
  binPointToDrawerMm,
  clampDrawerGrid,
  clampToDrawer,
  drawerStats,
  findFreeSpot,
  findLayoutConflicts,
  gridLines,
  nextRotation,
  placementRect,
  rectsOverlap,
  rotationOffsetMm,
  snapForBin,
  snapUnits,
} from '@/lib/drawerLayout'

function bin(id: string, gridX: number, gridY: number, name = id, halfGridBase = false): BinSummary {
  return {
    id,
    name,
    project_id: 'project-1',
    created_at: null,
    tool_ids: [],
    tool_count: 0,
    has_stl: false,
    grid_x: gridX,
    grid_y: gridY,
    height_units: 4,
    half_grid_base: halfGridBase,
    preview_tools: [],
  }
}

function placement(binId: string, x: number, y: number, rotation = 0, id = `${binId}-${x}-${y}`): ProjectBinPlacement {
  return { id, bin_id: binId, x, y, rotation, color: null }
}

describe('snapping and clamping', () => {
  it('snaps to full units by default', () => {
    expect(snapUnits(1.3)).toBe(1)
    expect(snapUnits(1.6)).toBe(2)
  })

  it('snaps to half units when asked', () => {
    expect(snapUnits(1.3, HALF_GRID_SNAP)).toBe(1.5)
    expect(snapUnits(1.1, HALF_GRID_SNAP)).toBe(1)
  })

  it('takes the snap step from the bin base', () => {
    expect(snapForBin(bin('a', 2, 2))).toBe(1)
    expect(snapForBin(bin('a', 2, 2, 'a', true))).toBe(HALF_GRID_SNAP)
    expect(snapForBin(undefined)).toBe(1)
  })

  it('clamps drawer sizes into the supported range', () => {
    expect(clampDrawerGrid(0.2)).toBe(1)
    expect(clampDrawerGrid(3.4)).toBe(3.5)
    expect(clampDrawerGrid(99)).toBe(40)
  })

  it('keeps a bin inside the drawer', () => {
    expect(clampToDrawer({ x: 5, y: -2, w: 2, h: 1 }, 6, 4)).toEqual({ x: 4, y: 0 })
  })
})

describe('gridLines', () => {
  it('lists every unit boundary', () => {
    expect(gridLines(3)).toEqual([0, 1, 2, 3])
  })

  it('keeps the trailing half unit', () => {
    expect(gridLines(2.5)).toEqual([0, 1, 2, 2.5])
  })
})

describe('rotations', () => {
  it('cycles through all four quarter turns', () => {
    expect(nextRotation(0)).toBe(90)
    expect(nextRotation(90)).toBe(180)
    expect(nextRotation(180)).toBe(270)
    expect(nextRotation(270)).toBe(0)
  })

  it('swaps width and height only on quarter turns', () => {
    expect(binFootprint(bin('a', 3, 1))).toEqual({ w: 3, h: 1 })
    expect(binFootprint(bin('a', 3, 1), 90)).toEqual({ w: 1, h: 3 })
    expect(binFootprint(bin('a', 3, 1), 180)).toEqual({ w: 3, h: 1 })
    expect(binFootprint(bin('a', 3, 1), 270)).toEqual({ w: 1, h: 3 })
  })

  it('builds rects from placements', () => {
    expect(placementRect(placement('a', 1, 2, 90), bin('a', 3, 1))).toEqual({ x: 1, y: 2, w: 1, h: 3 })
  })

  it('detects overlap only when areas intersect', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 2, h: 2 }, { x: 1, y: 1, w: 2, h: 2 })).toBe(true)
    expect(rectsOverlap({ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 2, h: 2 })).toBe(false)
  })
})

describe('binPointToDrawerMm', () => {
  const wide = bin('a', 3, 1)
  const w = 3 * GRID_UNIT
  const d = GRID_UNIT

  it('offsets by the placement origin', () => {
    const point = binPointToDrawerMm({ x: 10, y: 5 }, placement('a', 1, 2), bin('a', 2, 2))
    expect(point).toEqual({ x: GRID_UNIT + 10, y: 2 * GRID_UNIT + 5 })
  })

  it('maps every corner into the rotated footprint', () => {
    // the bin's top-left corner travels clockwise around the footprint
    expect(binPointToDrawerMm({ x: 0, y: 0 }, placement('a', 0, 0, 90), wide)).toEqual({ x: d, y: 0 })
    expect(binPointToDrawerMm({ x: 0, y: 0 }, placement('a', 0, 0, 180), wide)).toEqual({ x: w, y: d })
    expect(binPointToDrawerMm({ x: 0, y: 0 }, placement('a', 0, 0, 270), wide)).toEqual({ x: 0, y: w })
  })

  it('keeps rotated content inside the footprint', () => {
    for (const rotation of [0, 90, 180, 270]) {
      const { w: fw, h: fh } = binFootprint(wide, rotation)
      for (const corner of [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }]) {
        const mapped = binPointToDrawerMm(corner, placement('a', 0, 0, rotation), wide)
        expect(mapped.x).toBeGreaterThanOrEqual(0)
        expect(mapped.y).toBeGreaterThanOrEqual(0)
        expect(mapped.x).toBeLessThanOrEqual(fw * GRID_UNIT)
        expect(mapped.y).toBeLessThanOrEqual(fh * GRID_UNIT)
      }
    }
  })
})

describe('rotationOffsetMm', () => {
  it('shifts a rotated model back into its footprint', () => {
    const wide = bin('a', 3, 1)
    expect(rotationOffsetMm(0, wide)).toEqual({ dx: 0, dz: 0 })
    expect(rotationOffsetMm(90, wide)).toEqual({ dx: GRID_UNIT, dz: 0 })
    expect(rotationOffsetMm(180, wide)).toEqual({ dx: 3 * GRID_UNIT, dz: GRID_UNIT })
    expect(rotationOffsetMm(270, wide)).toEqual({ dx: 0, dz: 3 * GRID_UNIT })
  })
})

describe('findLayoutConflicts', () => {
  it('flags overlapping and out-of-bounds placements by placement id', () => {
    const bins = binById([bin('a', 2, 2), bin('b', 2, 2)])
    const { overlapping, outOfBounds } = findLayoutConflicts(
      [placement('a', 0, 0, 0, 'p1'), placement('b', 1, 0, 0, 'p2'), placement('a', 5, 0, 0, 'p3')],
      bins,
      6,
      4,
    )

    expect(overlapping).toEqual(new Set(['p1', 'p2']))
    expect(outOfBounds).toEqual(new Set(['p3']))
  })

  it('treats copies of one bin as separate placements', () => {
    const bins = binById([bin('a', 1, 1)])
    const { overlapping } = findLayoutConflicts(
      [placement('a', 0, 0, 0, 'p1'), placement('a', 2, 0, 0, 'p2')],
      bins,
      6,
      4,
    )

    expect(overlapping.size).toBe(0)
  })

  it('ignores placements for bins that are gone', () => {
    const { overlapping, outOfBounds } = findLayoutConflicts([placement('missing', 0, 0)], binById([]), 6, 4)

    expect(overlapping.size).toBe(0)
    expect(outOfBounds.size).toBe(0)
  })
})

describe('findFreeSpot', () => {
  it('returns the first free cell scanning rows', () => {
    const spot = findFreeSpot(bin('b', 2, 1), [{ x: 0, y: 0, w: 2, h: 2 }], 4, 4)

    expect(spot).toEqual({ x: 2, y: 0, rotation: 0 })
  })

  it('uses half steps only for half-grid bins', () => {
    const occupied = [{ x: 0, y: 0, w: 1.5, h: 4 }]

    expect(findFreeSpot(bin('b', 1, 1), occupied, 4, 4)).toEqual({ x: 2, y: 0, rotation: 0 })
    expect(findFreeSpot(bin('b', 1, 1, 'b', true), occupied, 4, 4)).toEqual({ x: 1.5, y: 0, rotation: 0 })
  })

  it('falls back to a rotated footprint', () => {
    expect(findFreeSpot(bin('b', 3, 1), [], 1, 4)).toEqual({ x: 0, y: 0, rotation: 90 })
  })

  it('returns null when the bin does not fit', () => {
    expect(findFreeSpot(bin('b', 5, 5), [], 4, 4)).toBeNull()
  })
})

describe('autoArrange', () => {
  it('packs the largest bins first and reports what did not fit', () => {
    const bins = binById([bin('small', 1, 1), bin('large', 2, 2), bin('huge', 6, 6)])
    const placements = [
      placement('small', 0, 0, 0, 'p-small'),
      placement('large', 0, 0, 0, 'p-large'),
      placement('huge', 0, 0, 0, 'p-huge'),
    ]

    const result = autoArrange(placements, bins, 3, 2)

    expect(result.placements.map(p => p.id)).toEqual(['p-large', 'p-small'])
    expect(result.placements[0]).toMatchObject({ bin_id: 'large', x: 0, y: 0, rotation: 0 })
    expect(result.placements[1]).toMatchObject({ bin_id: 'small', x: 2, y: 0, rotation: 0 })
    expect(result.droppedIds).toEqual(['p-huge'])
  })

  it('keeps copies of the same bin apart', () => {
    const bins = binById([bin('a', 2, 1)])
    const placements = [
      placement('a', 0, 0, 0, 'p1'),
      placement('a', 0, 0, 0, 'p2'),
      placement('a', 0, 0, 0, 'p3'),
    ]

    const result = autoArrange(placements, bins, 4, 4)
    const { overlapping } = findLayoutConflicts(result.placements, bins, 4, 4)

    expect(result.placements).toHaveLength(3)
    expect(overlapping.size).toBe(0)
  })
})

describe('drawerStats', () => {
  it('sums used units across placements and counts unplaced bins', () => {
    const bins = [bin('a', 2, 2), bin('b', 1, 1), bin('c', 3, 1)]

    const stats = drawerStats(
      [placement('a', 0, 0, 0, 'p1'), placement('a', 2, 0, 0, 'p2'), placement('b', 4, 0, 0, 'p3')],
      bins,
      6,
      4,
    )

    expect(stats.drawerUnits).toBe(24)
    expect(stats.usedUnits).toBe(9)
    expect(stats.freeUnits).toBe(15)
    expect(stats.coverage).toBeCloseTo(9 / 24)
    expect(stats.placementCount).toBe(3)
    expect(stats.placedBinCount).toBe(2)
    expect(stats.unplacedBinCount).toBe(1)
  })
})
