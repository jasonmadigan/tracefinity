export const GRID_UNIT = 42
export const DISPLAY_SCALE = 8
export const SNAP_GRID = 5 // default snap increment in mm
export const SNAP_GRID_MIN = 0.5
export const SNAP_GRID_MAX = 42
export const MAX_HISTORY = 50
export const ZOOM_FACTOR = 1.15
export const DEFAULT_CUTOUT_DEPTH = 20
export const DOCS_BASE_URL = 'https://github.com/tracefinity/tracefinity/blob/main/docs'

// Bin geometry is generated in full before bed-size splitting. Keep the
// resource ceiling tied to total grid cells while allowing long, narrow bins.
export const MIN_GRID_UNITS = 1
export const MAX_GRID_UNITS = 25
export const MAX_GRID_CELLS = 100

export function gridCellCount(gridX: number, gridY: number): number {
  return Math.ceil(gridX) * Math.ceil(gridY)
}

export function requiredGridUnits(
  spanMm: number,
  totalMarginMm: number,
  halfGridBase: boolean,
): number {
  const snap = halfGridBase ? 0.5 : 1
  const snapUnitMm = GRID_UNIT * snap
  return Math.max(MIN_GRID_UNITS, Math.ceil((spanMm + totalMarginMm) / snapUnitMm) * snap)
}

export function getGridSizeError(gridX: number, gridY: number): string | null {
  if (!Number.isFinite(gridX) || !Number.isFinite(gridY)) {
    return 'Grid dimensions must be finite numbers'
  }
  if (gridX < MIN_GRID_UNITS || gridY < MIN_GRID_UNITS) {
    return `Grid dimensions must be at least ${MIN_GRID_UNITS} unit`
  }
  if (gridX > MAX_GRID_UNITS || gridY > MAX_GRID_UNITS) {
    return `Grid dimensions must not exceed ${MAX_GRID_UNITS} units per axis`
  }
  if (gridX * 2 !== Math.trunc(gridX * 2) || gridY * 2 !== Math.trunc(gridY * 2)) {
    return 'Grid dimensions must use 0.5-unit increments'
  }
  if (gridCellCount(gridX, gridY) > MAX_GRID_CELLS) {
    return `Grid footprint must not exceed ${MAX_GRID_CELLS} cells`
  }
  return null
}

export function maxGridUnitsForOtherAxis(otherAxis: number): number {
  const otherCells = Math.max(1, Math.ceil(otherAxis))
  return Math.min(MAX_GRID_UNITS, Math.floor(MAX_GRID_CELLS / otherCells))
}
