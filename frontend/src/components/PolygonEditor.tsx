'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { Point, Polygon } from '@/types'
import { Undo2, Redo2, Trash2, Plus, Minus, Move } from 'lucide-react'
import { polygonPathData } from '@/lib/svg'
import { useHistory } from '@/hooks/useHistory'
import { ZOOM_FACTOR } from '@/lib/constants'
import { clampZoom, zoomedViewBox, viewBoxPoint, zoomAtCursor } from '@/lib/viewbox'

interface Props {
  imageUrl: string
  polygons: Polygon[]
  onPolygonsChange: (polygons: Polygon[]) => void
  editable?: boolean
  included?: Set<string>
  onIncludedChange?: (ids: Set<string>) => void
  hovered?: string | null
  onHoveredChange?: (id: string | null) => void
}
// base sizes for SVG UI elements, designed for ~800px viewBox width
const BASE_VIEW_WIDTH = 800

type EditMode = 'select' | 'vertex' | 'add-vertex' | 'delete-vertex'
type DragState =
  | { type: 'vertex'; polyId: string; pointIdx: number }
  | { type: 'pan'; startClientX: number; startClientY: number; origPanX: number; origPanY: number; svgScale: number }
  | null

export function PolygonEditor({
  imageUrl,
  polygons,
  onPolygonsChange,
  editable = true,
  included,
  onIncludedChange,
  hovered,
  onHoveredChange,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [fitted, setFitted] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const spaceHeld = useRef(false)
  const didPanRef = useRef(false)
  const zoomRef = useRef(zoom)
  const panRef = useRef(pan)
  useEffect(() => { zoomRef.current = zoom }, [zoom])
  useEffect(() => { panRef.current = pan }, [pan])
  // scale UI elements relative to image size so they're visible on large photos;
  // divided by zoom so handles and strokes keep a constant on-screen size
  const uiScale = (imageSize.width > 0 ? imageSize.width / BASE_VIEW_WIDTH : 1) / zoom

  // active polygon for vertex editing (internal)
  const [activeId, setActiveId] = useState<string | null>(null)
  // fallback single-select when no inclusion tracking
  const [internalSelected, setInternalSelected] = useState<string | null>(null)

  const hasInclusion = included !== undefined
  const isIncluded = useCallback((id: string) => {
    if (hasInclusion) return included!.has(id)
    return internalSelected === id
  }, [hasInclusion, included, internalSelected])

  const [editMode, setEditMode] = useState<EditMode>('select')
  const [dragging, setDragging] = useState<DragState>(null)

  const { set: pushHistory, undo: handleUndo, redo: handleRedo, canUndo, canRedo } = useHistory<Polygon[]>(
    polygons,
    onPolygonsChange
  )

  useEffect(() => {
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.src = imageUrl
    return () => { cancelled = true }
  }, [imageUrl])

  // fit image container to available space while preserving aspect ratio
  useEffect(() => {
    function updateSize() {
      if (!wrapperRef.current || !imageSize.width || !imageSize.height) return
      const availW = wrapperRef.current.clientWidth
      const availH = wrapperRef.current.clientHeight
      const imgAspect = imageSize.width / imageSize.height
      let w = availW
      let h = w / imgAspect
      if (h > availH) {
        h = availH
        w = h * imgAspect
      }
      setFitted({ width: Math.floor(w), height: Math.floor(h) })
    }
    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [imageSize])

  // refs for stale closure avoidance during drag
  const polygonsRef = useRef(polygons)
  const onPolygonsChangeRef = useRef(onPolygonsChange)
  useEffect(() => { polygonsRef.current = polygons }, [polygons])
  useEffect(() => { onPolygonsChangeRef.current = onPolygonsChange }, [onPolygonsChange])

  // container is aspect-fitted to the image, so client fractions map straight into the viewBox
  const vb = useMemo(
    () => zoomedViewBox(imageSize.width, imageSize.height, zoom, pan),
    [imageSize, zoom, pan]
  )

  const getScaledPoint = useCallback(
    (clientX: number, clientY: number): Point => {
      if (!containerRef.current) return { x: 0, y: 0 }

      const rect = containerRef.current.getBoundingClientRect()
      const point = viewBoxPoint(vb, (clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height)

      return {
        x: Math.max(0, Math.min(imageSize.width, point.x)),
        y: Math.max(0, Math.min(imageSize.height, point.y)),
      }
    },
    [imageSize, vb]
  )

  // scroll-to-zoom centred on the cursor (needs passive: false for preventDefault)
  useEffect(() => {
    const el = containerRef.current
    if (!el || !imageSize.width) return
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR
      const oldZoom = zoomRef.current
      const newZoom = clampZoom(oldZoom * factor)
      if (newZoom === oldZoom) return
      const rect = el.getBoundingClientRect()
      const fx = (e.clientX - rect.left) / rect.width
      const fy = (e.clientY - rect.top) / rect.height
      setPan(zoomAtCursor(imageSize.width, imageSize.height, oldZoom, newZoom, panRef.current, fx, fy))
      setZoom(newZoom)
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [imageSize])

  // space key for pan mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        spaceHeld.current = true
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeld.current = false
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  const updatePolygons = useCallback((updated: Polygon[]) => {
    pushHistory(updated)
    onPolygonsChange(updated)
  }, [pushHistory, onPolygonsChange])

  // swallow the click that follows a pan release
  const consumeDidPan = () => {
    if (didPanRef.current) {
      didPanRef.current = false
      return true
    }
    return false
  }

  const handlePolygonClick = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (consumeDidPan()) return
    if (!editable) return

    if (editMode !== 'select') {
      // in editing modes, set active for vertex editing
      setActiveId(activeId === id ? null : id)
    } else if (hasInclusion && onIncludedChange) {
      // toggle inclusion
      const next = new Set(included!)
      if (next.has(id)) {
        next.delete(id)
        if (activeId === id) setActiveId(null)
      } else {
        next.add(id)
        setActiveId(id)
      }
      onIncludedChange(next)
    } else {
      // fallback single-select
      const newSel = internalSelected === id ? null : id
      setInternalSelected(newSel)
      setActiveId(newSel)
    }
  }

  const handleEdgeClick = (polyId: string, edgeIdx: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (consumeDidPan()) return
    if (!editable || editMode !== 'add-vertex') return

    const point = getScaledPoint(e.clientX, e.clientY)
    const updated = polygons.map((poly) => {
      if (poly.id !== polyId) return poly
      const points = [...poly.points]
      points.splice(edgeIdx + 1, 0, point)
      return { ...poly, points }
    })
    updatePolygons(updated)
  }

  const handleVertexClick = (polyId: string, pointIdx: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (consumeDidPan()) return
    if (!editable) return

    if (editMode === 'delete-vertex') {
      const poly = polygons.find(p => p.id === polyId)
      if (!poly || poly.points.length <= 3) return // need at least 3 points

      const updated = polygons.map((p) => {
        if (p.id !== polyId) return p
        const points = [...p.points]
        points.splice(pointIdx, 1)
        return { ...p, points }
      })
      updatePolygons(updated)
    }
  }

  const handleVertexMouseDown = (polyId: string, pointIdx: number) => (e: React.MouseEvent) => {
    // let pan triggers bubble to the canvas handler
    if (spaceHeld.current || e.button !== 0) return
    e.stopPropagation()
    if (editable && (editMode === 'vertex' || editMode === 'select')) {
      setDragging({ type: 'vertex', polyId, pointIdx })
    }
  }

  const handleVertexTouchStart = (polyId: string, pointIdx: number) => (e: React.TouchEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (editable && (editMode === 'vertex' || editMode === 'select')) {
      setDragging({ type: 'vertex', polyId, pointIdx })
    }
  }

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging) return

      if (dragging.type === 'pan') {
        const dx = (e.clientX - dragging.startClientX) / dragging.svgScale
        const dy = (e.clientY - dragging.startClientY) / dragging.svgScale
        setPan({ x: dragging.origPanX - dx, y: dragging.origPanY - dy })
        didPanRef.current = true
        return
      }

      const point = getScaledPoint(e.clientX, e.clientY)

      if (dragging.type === 'vertex') {
        const updated = polygonsRef.current.map((poly) => {
          if (poly.id !== dragging.polyId) return poly
          const points = [...poly.points]
          points[dragging.pointIdx] = point
          return { ...poly, points }
        })
        onPolygonsChangeRef.current(updated) // don't push to history during drag
      }
    },
    [dragging, getScaledPoint]
  )

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!dragging) return
      e.preventDefault()
      const t = e.touches[0]
      const point = getScaledPoint(t.clientX, t.clientY)

      if (dragging.type === 'vertex') {
        const updated = polygonsRef.current.map((poly) => {
          if (poly.id !== dragging.polyId) return poly
          const points = [...poly.points]
          points[dragging.pointIdx] = point
          return { ...poly, points }
        })
        onPolygonsChangeRef.current(updated)
      }
    },
    [dragging, getScaledPoint]
  )

  const handleMouseUp = useCallback(() => {
    // pan never touches the polygons, so it never enters history
    if (dragging && dragging.type !== 'pan') {
      pushHistory(polygonsRef.current)
    }
    setDragging(null)
  }, [dragging, pushHistory])

  const handleTouchEnd = useCallback(() => {
    if (dragging && dragging.type !== 'pan') {
      pushHistory(polygonsRef.current)
    }
    setDragging(null)
  }, [dragging, pushHistory])

  useEffect(() => {
    if (dragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      window.addEventListener('touchmove', handleTouchMove, { passive: false })
      window.addEventListener('touchend', handleTouchEnd)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        window.removeEventListener('touchmove', handleTouchMove)
        window.removeEventListener('touchend', handleTouchEnd)
      }
    }
  }, [dragging, handleMouseMove, handleMouseUp, handleTouchMove, handleTouchEnd])

  const handleBackgroundClick = () => {
    if (consumeDidPan()) return
    setActiveId(null)
  }

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    const isPanTrigger = e.button === 1 || (e.button === 0 && spaceHeld.current)
    if (!isPanTrigger) return
    // preventDefault suppresses middle-mouse autoscroll
    e.preventDefault()
    if (!containerRef.current || !imageSize.width) return
    const rect = containerRef.current.getBoundingClientRect()
    const svgScale = rect.width / (imageSize.width / zoom)
    setDragging({
      type: 'pan',
      startClientX: e.clientX,
      startClientY: e.clientY,
      origPanX: pan.x,
      origPanY: pan.y,
      svgScale,
    })
  }

  const handleResetZoom = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const handleDeletePolygon = (id: string) => {
    updatePolygons(polygons.filter((p) => p.id !== id))
    if (activeId === id) setActiveId(null)
    if (hasInclusion && onIncludedChange) {
      const next = new Set(included!)
      next.delete(id)
      onIncludedChange(next)
    }
  }

  // auto-activate first included polygon when switching to edit modes
  const handleModeChange = (mode: EditMode) => {
    setEditMode(mode)
    if ((mode === 'vertex' || mode === 'add-vertex' || mode === 'delete-vertex') && !activeId && polygons.length > 0) {
      const first = hasInclusion
        ? polygons.find(p => included!.has(p.id))
        : polygons[0]
      if (first) setActiveId(first.id)
    }
  }

  if (!imageSize.width) {
    return <div className="bg-inset rounded-lg aspect-[4/3]" />
  }

  const activePoly = polygons.find(p => p.id === activeId)

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      {/* toolbar */}
      {editable && (
        <div className="flex items-center gap-4 flex-shrink-0">
          <div className="flex gap-1 bg-elevated rounded-[10px] p-1 border border-border">
            <button
              onClick={() => handleModeChange('vertex')}
              className={`p-2 rounded transition-colors cursor-pointer ${
                editMode === 'vertex' || editMode === 'select'
                  ? 'bg-accent-muted text-accent'
                  : 'hover:bg-border text-text-secondary'
              }`}
              title="Move vertices"
            >
              <Move className="w-5 h-5" />
            </button>
            <button
              onClick={() => handleModeChange('add-vertex')}
              className={`p-2 rounded transition-colors cursor-pointer ${
                editMode === 'add-vertex'
                  ? 'bg-accent-muted text-accent'
                  : 'hover:bg-border text-text-secondary'
              }`}
              title="Add vertex"
            >
              <Plus className="w-5 h-5" />
            </button>
            <button
              onClick={() => handleModeChange('delete-vertex')}
              className={`p-2 rounded transition-colors cursor-pointer ${
                editMode === 'delete-vertex'
                  ? 'bg-accent-muted text-accent'
                  : 'hover:bg-border text-text-secondary'
              }`}
              title="Delete vertex"
              disabled={activePoly && activePoly.points.length <= 3}
            >
              <Minus className="w-5 h-5" />
            </button>
          </div>

          <div className="h-6 w-px bg-border-subtle" />

          <div className="flex items-center gap-1">
            <button
              onClick={handleUndo}
              disabled={!canUndo}
              className="p-2 rounded hover:bg-border text-text-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="w-5 h-5" />
            </button>
            <button
              onClick={handleRedo}
              disabled={!canRedo}
              className="p-2 rounded hover:bg-border text-text-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Redo (Ctrl+Shift+Z)"
            >
              <Redo2 className="w-5 h-5" />
            </button>
          </div>

          <span className="text-sm text-text-muted">
            {(editMode === 'select' || editMode === 'vertex') && !activeId && 'Click outlines to select tools'}
            {(editMode === 'select' || editMode === 'vertex') && activeId && 'Drag vertices to adjust the outline'}
            {editMode === 'add-vertex' && 'Click on an edge to add a vertex'}
            {editMode === 'delete-vertex' && 'Click a vertex to remove it'}
          </span>

          {activeId && (
            <button
              onClick={() => handleDeletePolygon(activeId)}
              className="ml-auto px-3 py-1.5 text-sm text-red-400 hover:bg-red-900/20 rounded border border-red-800 flex items-center gap-1 transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          )}
        </div>
      )}

      <div ref={wrapperRef} className="flex-1 min-h-0 flex items-center justify-center">
        <div
          ref={containerRef}
          className={`relative bg-inset rounded-lg overflow-hidden ${dragging?.type === 'pan' ? 'cursor-grabbing' : ''}`}
          style={fitted.width ? { width: fitted.width, height: fitted.height } : { width: '100%', aspectRatio: `${imageSize.width} / ${imageSize.height}` }}
          onClick={handleBackgroundClick}
          onMouseDown={handleCanvasMouseDown}
          onMouseDownCapture={() => { didPanRef.current = false }}
        >
        <svg
          className={`absolute inset-0 w-full h-full ${dragging?.type === 'pan' ? 'pointer-events-none' : ''}`}
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        >
          {/* photo lives inside the svg so it zooms and pans with the polygons */}
          <image
            href={imageUrl}
            x={0}
            y={0}
            width={imageSize.width}
            height={imageSize.height}
            preserveAspectRatio="none"
            className="pointer-events-none select-none"
          />
          {polygons.map((poly) => {
            const isActive = activeId === poly.id
            const polyIncluded = isIncluded(poly.id)
            const isHovered = hovered === poly.id
            const pathData = polygonPathData(poly.points, poly.interior_rings)

            let fill = 'rgba(90, 180, 222, 0.06)'
            let stroke = 'rgba(90, 180, 222, 0.4)'
            let strokeW = uiScale * 1
            if (isActive) {
              fill = 'rgba(90, 180, 222, 0.3)'
              stroke = 'rgb(72, 168, 214)'
              strokeW = uiScale * 2
            } else if (polyIncluded) {
              fill = 'rgba(90, 180, 222, 0.2)'
              stroke = 'rgb(72, 168, 214)'
              strokeW = uiScale * 1.5
            } else if (isHovered) {
              fill = 'rgba(90, 180, 222, 0.18)'
              stroke = 'rgb(90, 180, 222)'
              strokeW = uiScale * 1.5
            }

            return (
              <g key={poly.id}>
                <path
                  d={pathData}
                  fillRule="evenodd"
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={strokeW}
                  className="cursor-pointer transition-[fill,stroke,stroke-width] duration-150"
                  onClick={handlePolygonClick(poly.id)}
                  onMouseEnter={() => onHoveredChange?.(poly.id)}
                  onMouseLeave={() => onHoveredChange?.(null)}
                />

                {/* edge click targets for adding vertices */}
                {isActive && editable && editMode === 'add-vertex' &&
                  poly.points.map((point, idx) => {
                    const nextPoint = poly.points[(idx + 1) % poly.points.length]
                    const midX = (point.x + nextPoint.x) / 2
                    const midY = (point.y + nextPoint.y) / 2
                    return (
                      <g key={`edge-${idx}`}>
                        <line
                          x1={point.x}
                          y1={point.y}
                          x2={nextPoint.x}
                          y2={nextPoint.y}
                          stroke="transparent"
                          strokeWidth={uiScale * 20}
                          className="cursor-crosshair"
                          onClick={handleEdgeClick(poly.id, idx)}
                        />
                        <circle
                          cx={midX}
                          cy={midY}
                          r={uiScale * 5}
                          fill="rgb(34, 197, 94)"
                          stroke="#27272a"
                          strokeWidth={uiScale * 2}
                          className="cursor-crosshair pointer-events-none"
                        />
                      </g>
                    )
                  })}

                {/* vertex handles */}
                {isActive &&
                  editable &&
                  (editMode === 'vertex' || editMode === 'select' || editMode === 'add-vertex' || editMode === 'delete-vertex') &&
                  poly.points.map((point, idx) => (
                    <g key={idx}>
                      {/* transparent hit target -- larger for touch */}
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={uiScale * 16}
                        fill="transparent"
                        className={editMode === 'delete-vertex' ? 'cursor-pointer touch-none' : 'cursor-move touch-none'}
                        onMouseDown={editMode !== 'delete-vertex' ? handleVertexMouseDown(poly.id, idx) : undefined}
                        onTouchStart={editMode !== 'delete-vertex' ? handleVertexTouchStart(poly.id, idx) : undefined}
                        onClick={handleVertexClick(poly.id, idx)}
                      />
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={uiScale * 8}
                        fill={editMode === 'delete-vertex' ? 'rgb(239, 68, 68)' : '#27272a'}
                        stroke={editMode === 'delete-vertex' ? 'rgb(185, 28, 28)' : 'rgb(72, 168, 214)'}
                        strokeWidth={uiScale * 2}
                        className="pointer-events-none"
                      />
                    </g>
                  ))}

              </g>
            )
          })}
        </svg>

        {/* zoom controls */}
        <div
          className="absolute bottom-3.5 right-3.5 z-20 glass-toolbar px-1 py-0.5 flex items-center gap-0.5 text-[11px]"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => setZoom(z => clampZoom(z / ZOOM_FACTOR))}
            className="px-2 py-1 rounded-[7px] text-text-muted hover:text-text-primary hover:bg-border/50 transition-colors"
          >
            -
          </button>
          <span className="px-1.5 text-text-secondary min-w-[36px] text-center">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom(z => clampZoom(z * ZOOM_FACTOR))}
            className="px-2 py-1 rounded-[7px] text-text-muted hover:text-text-primary hover:bg-border/50 transition-colors"
          >
            +
          </button>
          <div className="h-3.5 w-px bg-border-subtle mx-0.5" />
          <button
            onClick={handleResetZoom}
            className="px-2 py-1 rounded-[7px] text-text-muted hover:text-text-primary hover:bg-border/50 transition-colors"
          >
            Fit
          </button>
        </div>
        </div>
      </div>

    </div>
  )
}
