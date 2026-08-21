import { describe, it, expect } from 'vitest'
import {
  getGridSizeError,
  gridCellCount,
  MAX_GRID_CELLS,
  MAX_GRID_UNITS,
  MIN_GRID_UNITS,
  maxGridUnitsForOtherAxis,
  requiredGridUnits,
} from './constants'

describe('grid size limits', () => {
  it('matches the backend resource bounds', () => {
    expect(MIN_GRID_UNITS).toBe(1)
    expect(MAX_GRID_UNITS).toBe(25)
    expect(MAX_GRID_CELLS).toBe(100)
  })

  it('accepts long, narrow bins at the existing resource ceiling', () => {
    expect(getGridSizeError(20, 5)).toBeNull()
    expect(getGridSizeError(25, 4)).toBeNull()
    expect(getGridSizeError(10.5, 9)).toBeNull()
  })

  it('rejects a dimension above the sanity ceiling', () => {
    expect(getGridSizeError(25.5, 2)).toContain('25 units per axis')
  })

  it('rejects footprints above 100 cells instead of silently shrinking them', () => {
    expect(getGridSizeError(10.5, 10)).toContain('100 cells')
    expect(getGridSizeError(20, 5.5)).toContain('100 cells')
    expect(getGridSizeError(25, 4.5)).toContain('100 cells')
  })

  it('reports the actual auto-sized requirement instead of clamping to ten', () => {
    const defaultMargin = 2 * 1.6 + 2 * 1 + 0.5
    expect(requiredGridUnits(414, defaultMargin, false)).toBe(10)
    expect(requiredGridUnits(415, defaultMargin, false)).toBe(11)
    expect(requiredGridUnits(415, defaultMargin, true)).toBe(10.5)
  })

  it('counts fractional dimensions by the cells they occupy', () => {
    expect(gridCellCount(10.5, 9)).toBe(99)
    expect(gridCellCount(10.5, 10)).toBe(110)
  })

  it('rejects invalid lower bounds and increments', () => {
    expect(getGridSizeError(0.5, 2)).toContain('at least 1 unit')
    expect(getGridSizeError(2.25, 2)).toContain('0.5-unit increments')
  })

  it('constrains manual controls using the other dimension', () => {
    expect(maxGridUnitsForOtherAxis(4)).toBe(25)
    expect(maxGridUnitsForOtherAxis(5)).toBe(20)
    expect(maxGridUnitsForOtherAxis(9)).toBe(11)
    expect(maxGridUnitsForOtherAxis(10.5)).toBe(9)
  })
})
