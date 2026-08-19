import { describe, it, expect } from 'vitest'
import { clampZoom, zoomedViewBox, viewBoxPoint, zoomAtCursor, uiScaleFor, MIN_ZOOM, MAX_ZOOM, BASE_VIEW_WIDTH } from './viewbox'
import { ZOOM_FACTOR } from './constants'

const W = 2048
const H = 1536

describe('clampZoom', () => {
  it('pins the clamp bounds shared with ToolEditor', () => {
    expect(MIN_ZOOM).toBe(0.5)
    expect(MAX_ZOOM).toBe(20)
  })

  it('clamps below the minimum', () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM)
  })

  it('clamps above the maximum', () => {
    expect(clampZoom(25)).toBe(MAX_ZOOM)
  })

  it('passes through values in range', () => {
    expect(clampZoom(3)).toBe(3)
  })
})

describe('zoomedViewBox', () => {
  it('matches the full image at zoom 1 with no pan', () => {
    expect(zoomedViewBox(W, H, 1, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, w: W, h: H })
  })

  it('centres a 2x zoom on the image', () => {
    expect(zoomedViewBox(W, H, 2, { x: 0, y: 0 })).toEqual({ x: W / 4, y: H / 4, w: W / 2, h: H / 2 })
  })

  it('offsets by the pan', () => {
    const vb = zoomedViewBox(W, H, 2, { x: 30, y: -40 })
    expect(vb.x).toBe(W / 4 + 30)
    expect(vb.y).toBe(H / 4 - 40)
  })
})

describe('viewBoxPoint', () => {
  it('maps fractions to image coords identically to the unzoomed editor', () => {
    const vb = zoomedViewBox(W, H, 1, { x: 0, y: 0 })
    expect(viewBoxPoint(vb, 0, 0)).toEqual({ x: 0, y: 0 })
    expect(viewBoxPoint(vb, 0.5, 0.5)).toEqual({ x: W / 2, y: H / 2 })
    expect(viewBoxPoint(vb, 1, 1)).toEqual({ x: W, y: H })
  })

  it('maps through a zoomed and panned viewBox', () => {
    const vb = zoomedViewBox(W, H, 4, { x: 100, y: 50 })
    expect(viewBoxPoint(vb, 0, 0)).toEqual({ x: vb.x, y: vb.y })
    expect(viewBoxPoint(vb, 1, 0.5)).toEqual({ x: vb.x + vb.w, y: vb.y + vb.h / 2 })
  })
})

describe('zoomAtCursor', () => {
  it('keeps the image point under the cursor fixed across a zoom step', () => {
    const fx = 0.25
    const fy = 0.7
    const oldZoom = 1
    const newZoom = oldZoom * ZOOM_FACTOR
    const pan = { x: 0, y: 0 }
    const before = viewBoxPoint(zoomedViewBox(W, H, oldZoom, pan), fx, fy)
    const newPan = zoomAtCursor(W, H, oldZoom, newZoom, pan, fx, fy)
    const after = viewBoxPoint(zoomedViewBox(W, H, newZoom, newPan), fx, fy)
    expect(after.x).toBeCloseTo(before.x, 8)
    expect(after.y).toBeCloseTo(before.y, 8)
  })

  it('keeps the cursor point fixed when already zoomed and panned', () => {
    const fx = 0.9
    const fy = 0.1
    const oldZoom = 5
    const newZoom = oldZoom / ZOOM_FACTOR
    const pan = { x: -120, y: 260 }
    const before = viewBoxPoint(zoomedViewBox(W, H, oldZoom, pan), fx, fy)
    const newPan = zoomAtCursor(W, H, oldZoom, newZoom, pan, fx, fy)
    const after = viewBoxPoint(zoomedViewBox(W, H, newZoom, newPan), fx, fy)
    expect(after.x).toBeCloseTo(before.x, 8)
    expect(after.y).toBeCloseTo(before.y, 8)
  })

  it('leaves the pan unchanged when zooming at the centre', () => {
    const newPan = zoomAtCursor(W, H, 2, 4, { x: 15, y: -5 }, 0.5, 0.5)
    expect(newPan.x).toBeCloseTo(15, 8)
    expect(newPan.y).toBeCloseTo(-5, 8)
  })
})

describe('uiScaleFor', () => {
  // the bug: a portrait A4 photo is height-constrained, so the canvas renders
  // far narrower than BASE_VIEW_WIDTH and a 1px stroke came out at ~0.53px
  const IMG_W = 1505
  const RENDERED_W = 426

  function onScreenPx(units: number, imageWidth: number, renderedWidth: number): number {
    return units * (renderedWidth / imageWidth)
  }

  it('renders one unit as one CSS pixel at zoom 1', () => {
    const scale = uiScaleFor(IMG_W, RENDERED_W, 1)
    expect(onScreenPx(scale * 1, IMG_W, RENDERED_W)).toBeCloseTo(1, 8)
  })

  it('holds on-screen size across zoom levels', () => {
    for (const zoom of [0.5, 1, 2.5, 8, 20]) {
      const scale = uiScaleFor(IMG_W, RENDERED_W, zoom)
      const visibleWidth = IMG_W / zoom
      expect(onScreenPx(scale * 1, visibleWidth, RENDERED_W)).toBeCloseTo(1, 8)
    }
  })

  it('holds on-screen size regardless of image aspect', () => {
    const portrait = uiScaleFor(1505, 426, 1)
    const landscape = uiScaleFor(2048, 1200, 1)
    expect(onScreenPx(portrait, 1505, 426)).toBeCloseTo(1, 8)
    expect(onScreenPx(landscape, 2048, 1200)).toBeCloseTo(1, 8)
  })

  it('beats the old fixed-width assumption for a narrow canvas', () => {
    const old = IMG_W / BASE_VIEW_WIDTH
    expect(onScreenPx(old, IMG_W, RENDERED_W)).toBeLessThan(0.6)
    expect(onScreenPx(uiScaleFor(IMG_W, RENDERED_W, 1), IMG_W, RENDERED_W)).toBeCloseTo(1, 8)
  })

  it('falls back to the fixed width before the render is measured', () => {
    expect(uiScaleFor(IMG_W, 0, 1)).toBeCloseTo(IMG_W / BASE_VIEW_WIDTH, 8)
  })

  it('never returns zero or a negative scale', () => {
    expect(uiScaleFor(0, 0, 1)).toBe(1)
    expect(uiScaleFor(IMG_W, RENDERED_W, 0)).toBe(1)
    expect(uiScaleFor(IMG_W, RENDERED_W, -1)).toBe(1)
  })
})
