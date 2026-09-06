import { describe, expect, it } from 'vitest'
import { calcMaxCutoutDepth } from './BinConfigurator'

describe('calcMaxCutoutDepth', () => {
  it('1u locks the slider at 1.5mm (lip on)', () => {
    expect(calcMaxCutoutDepth(1, true)).toBe(1.5)
  })

  it('1u locks the slider at 1.5mm (lip off)', () => {
    expect(calcMaxCutoutDepth(1, false)).toBe(1.5)
  })

  it('2u spans 1.5-8.5mm (lip on)', () => {
    expect(calcMaxCutoutDepth(2, true)).toBe(4.7)
  })

  it('2u spans 1.5-8.5mm (lip off)', () => {
    expect(calcMaxCutoutDepth(2, false)).toBe(8.5)
  })

  it('4u (lip on)', () => {
    expect(calcMaxCutoutDepth(4, true)).toBe(18.7)
  })

  it('4u (lip off)', () => {
    expect(calcMaxCutoutDepth(4, false)).toBe(22.5)
  })

  it('shelled ignores the lip deduction', () => {
    expect(calcMaxCutoutDepth(2, true, true)).toBe(8.5)
    expect(calcMaxCutoutDepth(2, false, true)).toBe(8.5)
  })

  it('toggling lip clamps cutout_depth to new max', () => {
    // at 2u, lip-off max is 8.5 so a depth of 8 is valid
    const depthWithoutLip = 8.0
    const maxWithLip = calcMaxCutoutDepth(2, true)
    // toggling lip on should force clamp: min(8.0, 4.7) = 4.7
    expect(Math.min(depthWithoutLip, maxWithLip)).toBe(4.7)
  })
})

