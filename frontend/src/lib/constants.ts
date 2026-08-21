export const GRID_UNIT = 42
export const DISPLAY_SCALE = 8
export const SNAP_GRID = 5 // default snap increment in mm
export const SNAP_GRID_MIN = 0.5
export const SNAP_GRID_MAX = 42
export const MAX_HISTORY = 50
export const ZOOM_FACTOR = 1.15
export const DEFAULT_CUTOUT_DEPTH = 20
export const DOCS_BASE_URL = 'https://github.com/tracefinity/tracefinity/blob/main/docs'

// grid bounds enforced by the backend validator on bin_config.grid_x/grid_y.
// exceeding them rejects the whole bin update, so clamp before building a payload
export const MIN_GRID_UNITS = 1
export const MAX_GRID_UNITS = 10

// snap to the nearest 0.5 and hold inside the valid range
export function clampGridSize(v: number): number {
  if (Number.isNaN(v)) return MIN_GRID_UNITS
  const snapped = Math.round(v * 2) / 2
  return Math.min(MAX_GRID_UNITS, Math.max(MIN_GRID_UNITS, snapped))
}
