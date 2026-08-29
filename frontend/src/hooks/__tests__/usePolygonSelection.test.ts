// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePolygonSelection } from '../usePolygonSelection'

function polys(...ids: string[]) {
  return ids.map(id => ({ id }))
}

describe('usePolygonSelection', () => {
  it('starts with nothing selected', () => {
    const { result } = renderHook(() => usePolygonSelection(polys('a', 'b')))

    expect(result.current[0].size).toBe(0)
  })

  it('keeps the ids the caller selects', () => {
    const { result } = renderHook(() => usePolygonSelection(polys('a', 'b')))

    act(() => result.current[1](new Set(['a', 'b'])))

    expect([...result.current[0]]).toEqual(['a', 'b'])
  })

  it('drops the whole selection when a re-trace replaces every polygon', () => {
    let current = polys('a', 'b', 'c')
    const { result, rerender } = renderHook(() => usePolygonSelection(current))

    act(() => result.current[1](new Set(['a', 'b', 'c'])))
    expect(result.current[0].size).toBe(3)

    // re-trace: the tracer mints fresh uuids, so no previous id survives
    current = polys('d', 'e')
    rerender()

    expect(result.current[0].size).toBe(0)
  })

  it('never reports more selected than there are polygons', () => {
    let current = polys('a', 'b', 'c')
    const { result, rerender } = renderHook(() => usePolygonSelection(current))

    act(() => result.current[1](new Set(['a', 'b', 'c'])))

    current = polys('d', 'e')
    rerender()

    expect(result.current[0].size).toBeLessThanOrEqual(current.length)
  })

  it('keeps ids that survive a re-trace and drops the rest', () => {
    let current = polys('a', 'b', 'c')
    const { result, rerender } = renderHook(() => usePolygonSelection(current))

    act(() => result.current[1](new Set(['a', 'c'])))

    current = polys('a', 'z')
    rerender()

    expect([...result.current[0]]).toEqual(['a'])
  })

  it('drops a polygon deleted in the editor from the selection', () => {
    let current = polys('a', 'b')
    const { result, rerender } = renderHook(() => usePolygonSelection(current))

    act(() => result.current[1](new Set(['a', 'b'])))

    current = polys('a')
    rerender()

    expect([...result.current[0]]).toEqual(['a'])
  })

  it('collapses the selection when every polygon is gone', () => {
    let current = polys('a', 'b')
    const { result, rerender } = renderHook(() => usePolygonSelection(current))

    act(() => result.current[1](new Set(['a', 'b'])))

    current = polys()
    rerender()

    expect(result.current[0].size).toBe(0)
  })

  it('stays a subset of the polygons across repeated re-traces', () => {
    let current = polys('a', 'b')
    const { result, rerender } = renderHook(() => usePolygonSelection(current))

    act(() => result.current[1](new Set(['a', 'b'])))

    // first re-trace retires a
    current = polys('b', 'c')
    rerender()
    expect([...result.current[0]]).toEqual(['b'])

    // second re-trace retires b, and prunes from the raw selection rather than
    // the already-pruned one
    current = polys('c', 'd')
    rerender()
    expect(result.current[0].size).toBe(0)
  })

  it('returns the same set instance while the selection stays valid', () => {
    let current = polys('a', 'b')
    const { result, rerender } = renderHook(() => usePolygonSelection(current))

    act(() => result.current[1](new Set(['a'])))
    const first = result.current[0]

    // fresh array with the same ids, so the memo recomputes rather than
    // replaying its cached value and passing the assertion for free
    current = polys('a', 'b')
    rerender()

    expect(result.current[0]).toBe(first)
  })
})
