import type { BinSummary, Point, ProjectBinPlacement } from '@/types'
import { GRID_UNIT } from '@/lib/constants'

// drawer plans live in gridfinity units; a bin snaps to half units exactly when
// its own base is a half grid, otherwise to full units
export const FULL_GRID_SNAP = 1
export const HALF_GRID_SNAP = 0.5

/** Colour used for placements without a highlight colour, in both the 2D and 3D views. */
export const DEFAULT_BIN_COLOR = '#5ab4de'

export const PLACEMENT_COLORS = [
  '#ff6384', // red
  '#4bc0c0', // teal
  '#ff9f40', // orange
  '#9966ff', // purple
  '#ffcd56', // yellow
  '#c9cbcf', // grey
] as const

export const DRAWER_GRID_MIN = 1
export const DRAWER_GRID_MAX = 40
export const DEFAULT_DRAWER_GRID_X = 6
export const DEFAULT_DRAWER_GRID_Y = 4

export const PLACEMENT_ROTATIONS = [0, 90, 180, 270] as const
export type PlacementRotation = (typeof PLACEMENT_ROTATIONS)[number]

/** Half-grid bases sit on 21mm cells, so those bins may be placed on half units. */
export function snapForBin(bin: Pick<BinSummary, 'half_grid_base'> | undefined): number {
  return bin?.half_grid_base ? HALF_GRID_SNAP : FULL_GRID_SNAP
}

/**
 * Approximate bin height in mm: 7mm per unit plus the stacking lip. Only used
 * for the placeholder block shown until a bin's real model has been generated.
 */
export function binHeightMm(heightUnits: number): number {
  return heightUnits * 7 + 4.4
}

export interface UnitRect {
  x: number
  y: number
  w: number
  h: number
}

export function snapUnits(value: number, snap: number = FULL_GRID_SNAP): number {
  return Math.round(value / snap) * snap
}

export function clampDrawerGrid(value: number): number {
  return Math.min(DRAWER_GRID_MAX, Math.max(DRAWER_GRID_MIN, snapUnits(value, HALF_GRID_SNAP)))
}

export function nextRotation(rotation: number): PlacementRotation {
  const index = PLACEMENT_ROTATIONS.indexOf(rotation as PlacementRotation)
  return PLACEMENT_ROTATIONS[(index + 1) % PLACEMENT_ROTATIONS.length]
}

/** True when the rotation exchanges the bin's width and depth. */
export function isQuarterTurn(rotation: number): boolean {
  return rotation === 90 || rotation === 270
}

/** Bin footprint in grid units, swapped on quarter turns. */
export function binFootprint(bin: Pick<BinSummary, 'grid_x' | 'grid_y'>, rotation = 0): { w: number; h: number } {
  return isQuarterTurn(rotation)
    ? { w: bin.grid_y, h: bin.grid_x }
    : { w: bin.grid_x, h: bin.grid_y }
}

export function placementRect(
  placement: ProjectBinPlacement,
  bin: Pick<BinSummary, 'grid_x' | 'grid_y'>,
): UnitRect {
  const { w, h } = binFootprint(bin, placement.rotation)
  return { x: placement.x, y: placement.y, w, h }
}

export function rectsOverlap(a: UnitRect, b: UnitRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export function rectFitsDrawer(rect: UnitRect, drawerX: number, drawerY: number): boolean {
  return rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= drawerX && rect.y + rect.h <= drawerY
}

/** Keep a placement inside the drawer when the bin still fits at all. */
export function clampToDrawer(rect: UnitRect, drawerX: number, drawerY: number): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(rect.x, drawerX - rect.w)),
    y: Math.max(0, Math.min(rect.y, drawerY - rect.h)),
  }
}

/**
 * Map a point from bin-space mm to drawer-space mm, honouring the placement rotation.
 * Both views draw with y pointing down, so rotations are clockwise on screen.
 */
export function binPointToDrawerMm(
  point: Point,
  placement: ProjectBinPlacement,
  bin: Pick<BinSummary, 'grid_x' | 'grid_y'>,
): Point {
  const originX = placement.x * GRID_UNIT
  const originY = placement.y * GRID_UNIT
  const binWidth = bin.grid_x * GRID_UNIT
  const binDepth = bin.grid_y * GRID_UNIT

  switch (placement.rotation) {
    case 90:
      return { x: originX + binDepth - point.y, y: originY + point.x }
    case 180:
      return { x: originX + binWidth - point.x, y: originY + binDepth - point.y }
    case 270:
      return { x: originX + point.y, y: originY + binWidth - point.x }
    default:
      return { x: originX + point.x, y: originY + point.y }
  }
}

/**
 * Offset in mm that moves a bin model back into its footprint after rotating it
 * about the drawer's vertical axis. Used by the 3D view, where x/z mirror the
 * drawer's x/y.
 */
export function rotationOffsetMm(
  rotation: number,
  bin: Pick<BinSummary, 'grid_x' | 'grid_y'>,
): { dx: number; dz: number } {
  const binWidth = bin.grid_x * GRID_UNIT
  const binDepth = bin.grid_y * GRID_UNIT

  switch (rotation) {
    case 90:
      return { dx: binDepth, dz: 0 }
    case 180:
      return { dx: binWidth, dz: binDepth }
    case 270:
      return { dx: 0, dz: binWidth }
    default:
      return { dx: 0, dz: 0 }
  }
}

/** Unit positions for drawer grid lines, including the trailing partial unit. */
export function gridLines(units: number): number[] {
  const lines: number[] = []
  for (let i = 0; i <= Math.floor(units); i++) lines.push(i)
  if (!Number.isInteger(units)) lines.push(units)
  return lines
}

export function binById(bins: BinSummary[]): Map<string, BinSummary> {
  return new Map(bins.map(bin => [bin.id, bin]))
}

/** Placement ids that overlap another bin or stick out of the drawer. */
export function findLayoutConflicts(
  placements: ProjectBinPlacement[],
  bins: Map<string, BinSummary>,
  drawerX: number,
  drawerY: number,
): { overlapping: Set<string>; outOfBounds: Set<string> } {
  const overlapping = new Set<string>()
  const outOfBounds = new Set<string>()
  const rects: { id: string; rect: UnitRect }[] = []

  for (const placement of placements) {
    const bin = bins.get(placement.bin_id)
    if (!bin) continue
    const rect = placementRect(placement, bin)
    if (!rectFitsDrawer(rect, drawerX, drawerY)) outOfBounds.add(placement.id)
    rects.push({ id: placement.id, rect })
  }

  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (rectsOverlap(rects[i].rect, rects[j].rect)) {
        overlapping.add(rects[i].id)
        overlapping.add(rects[j].id)
      }
    }
  }

  return { overlapping, outOfBounds }
}

/**
 * First free position for a bin, scanning row by row in snap steps.
 * Returns null when the bin does not fit next to the occupied rects.
 */
export function findFreeSpot(
  bin: Pick<BinSummary, 'grid_x' | 'grid_y' | 'half_grid_base'>,
  occupied: UnitRect[],
  drawerX: number,
  drawerY: number,
  options: { rotation?: number } = {},
): { x: number; y: number; rotation: PlacementRotation } | null {
  const snap = snapForBin(bin)
  const preferred = options.rotation ?? 0
  const rotations: PlacementRotation[] = isQuarterTurn(preferred) ? [90, 0] : [0, 90]

  for (const rotation of rotations) {
    const { w, h } = binFootprint(bin, rotation)
    if (w > drawerX || h > drawerY) continue
    for (let y = 0; y <= drawerY - h + 1e-9; y += snap) {
      for (let x = 0; x <= drawerX - w + 1e-9; x += snap) {
        const rect = { x: snapUnits(x, snap), y: snapUnits(y, snap), w, h }
        if (!occupied.some(other => rectsOverlap(rect, other))) {
          return { x: rect.x, y: rect.y, rotation }
        }
      }
    }
  }
  return null
}

/**
 * Pack the given placements into the drawer, largest bin first. Placements keep
 * their ids so repeated copies of a bin survive; ones that do not fit are dropped.
 */
export function autoArrange(
  placements: ProjectBinPlacement[],
  bins: Map<string, BinSummary>,
  drawerX: number,
  drawerY: number,
): { placements: ProjectBinPlacement[]; droppedIds: string[] } {
  const ordered = placements
    .filter(placement => bins.has(placement.bin_id))
    .sort((a, b) => {
      const binA = bins.get(a.bin_id)!
      const binB = bins.get(b.bin_id)!
      const areaDiff = binB.grid_x * binB.grid_y - binA.grid_x * binA.grid_y
      if (areaDiff !== 0) return areaDiff
      return (binA.name || binA.id).localeCompare(binB.name || binB.id)
    })

  const arranged: ProjectBinPlacement[] = []
  const droppedIds: string[] = []
  const occupied: UnitRect[] = []

  for (const placement of ordered) {
    const bin = bins.get(placement.bin_id)!
    const spot = findFreeSpot(bin, occupied, drawerX, drawerY)
    if (!spot) {
      droppedIds.push(placement.id)
      continue
    }
    const placed = { ...placement, x: spot.x, y: spot.y, rotation: spot.rotation }
    arranged.push(placed)
    occupied.push(placementRect(placed, bin))
  }

  return { placements: arranged, droppedIds }
}

export interface DrawerStats {
  drawerUnits: number
  usedUnits: number
  freeUnits: number
  coverage: number
  placementCount: number
  placedBinCount: number
  unplacedBinCount: number
}

export function drawerStats(
  placements: ProjectBinPlacement[],
  bins: BinSummary[],
  drawerX: number,
  drawerY: number,
): DrawerStats {
  const byId = binById(bins)
  const known = placements.filter(placement => byId.has(placement.bin_id))
  const placedBinIds = new Set(known.map(placement => placement.bin_id))
  const usedUnits = known.reduce((sum, placement) => {
    const bin = byId.get(placement.bin_id)!
    return sum + bin.grid_x * bin.grid_y
  }, 0)
  const drawerUnits = drawerX * drawerY

  return {
    drawerUnits,
    usedUnits,
    freeUnits: Math.max(0, drawerUnits - usedUnits),
    coverage: drawerUnits > 0 ? usedUnits / drawerUnits : 0,
    placementCount: known.length,
    placedBinCount: placedBinIds.size,
    unplacedBinCount: bins.length - placedBinIds.size,
  }
}
