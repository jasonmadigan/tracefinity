import type { Point } from '@/types'

// zoom bounds shared with ToolEditor's behaviour
export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 20

export interface ViewBox {
  x: number
  y: number
  w: number
  h: number
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

// viewBox for a width x height image at the given zoom, centred, offset by pan
export function zoomedViewBox(width: number, height: number, zoom: number, pan: Point): ViewBox {
  const w = width / zoom
  const h = height / zoom
  return {
    x: (width - w) / 2 + pan.x,
    y: (height - h) / 2 + pan.y,
    w,
    h,
  }
}

// map fractional position within the rendered box (0..1) to image coords
export function viewBoxPoint(vb: ViewBox, fx: number, fy: number): Point {
  return { x: vb.x + fx * vb.w, y: vb.y + fy * vb.h }
}

// pan that keeps the image point at cursor fraction (fx, fy) fixed across a zoom change
export function zoomAtCursor(
  width: number,
  height: number,
  oldZoom: number,
  newZoom: number,
  pan: Point,
  fx: number,
  fy: number
): Point {
  const cur = viewBoxPoint(zoomedViewBox(width, height, oldZoom, pan), fx, fy)
  const next = viewBoxPoint(zoomedViewBox(width, height, newZoom, pan), fx, fy)
  return { x: pan.x + (cur.x - next.x), y: pan.y + (cur.y - next.y) }
}

// fallback view width, used only until the rendered size has been measured
export const BASE_VIEW_WIDTH = 800

// scale factor that makes one SVG user unit render as one CSS pixel.
// renderedWidth must be the measured width of the element the viewBox is
// painted into: a portrait image is height-constrained, so assuming a fixed
// view width gives sub-pixel strokes and handles. divided by zoom so both keep
// a constant on-screen size as the viewBox shrinks.
export function uiScaleFor(imageWidth: number, renderedWidth: number, zoom: number): number {
  if (zoom <= 0) return 1
  if (renderedWidth > 0 && imageWidth > 0) return imageWidth / renderedWidth / zoom
  if (imageWidth > 0) return imageWidth / BASE_VIEW_WIDTH / zoom
  return 1 / zoom
}
