import { describe, it, expect } from 'vitest'
import { clampGridSize, MIN_GRID_UNITS, MAX_GRID_UNITS } from './constants'

// the backend validator rejects grid_x/grid_y outside 1..10 or off the 0.5
// step, and rejects the whole bin update with it
describe('clampGridSize', () => {
  it('holds the backend bounds', () => {
    expect(MIN_GRID_UNITS).toBe(1)
    expect(MAX_GRID_UNITS).toBe(10)
  })

  it('clamps above the maximum, which is what rejected saves', () => {
    expect(clampGridSize(10.5)).toBe(10)
    expect(clampGridSize(14)).toBe(10)
    expect(clampGridSize(999)).toBe(10)
  })

  it('clamps below the minimum', () => {
    expect(clampGridSize(0)).toBe(1)
    expect(clampGridSize(-3)).toBe(1)
  })

  it('snaps to the nearest half unit', () => {
    expect(clampGridSize(3.4)).toBe(3.5)
    expect(clampGridSize(3.24)).toBe(3)
    expect(clampGridSize(7.75)).toBe(8)
  })

  it('leaves valid values alone', () => {
    for (const v of [1, 1.5, 4, 6.5, 10]) expect(clampGridSize(v)).toBe(v)
  })

  it('never returns a value the validator would reject', () => {
    for (let raw = -5; raw <= 20; raw += 0.13) {
      const v = clampGridSize(raw)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(10)
      expect(v * 2).toBe(Math.trunc(v * 2))
    }
  })

  it('survives non-finite input', () => {
    expect(clampGridSize(NaN)).toBe(1)
    expect(clampGridSize(Infinity)).toBe(10)
  })
})
