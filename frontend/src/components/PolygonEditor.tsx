'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import type { Point, Polygon } from '@/types'
import { Undo2, Redo2, Trash2, Plus, Minus, Move, MousePointer2 } from 'lucide-react'
import { polygonPathData } from '@/lib/svg'
import { useHistory } from '@/hooks/useHistory'

interface Props {
  imageUrl: string
  polygons: Polygon[]
  onPolygonsChange: (polygons: Polygon[]) => void
  editable?: boolean
}
// base sizes for SVG UI elements, designed for ~800px viewBox width
const BASE_VIEW_WIDTH = 800

type EditMode = 'select' | 'vertex' | 'add-vertex' | 'delete-vertex'
type DragState =
  | { type: 'vertex'; polyId: string; pointIdx: number }
  | null

export function PolygonEditor({
  imageUrl,
  polygons,
  onPolygonsChange,
  editable = true,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [fitted, setFitted] = useState({ width: 0, height: 0 })
  // scale UI elements relative to image size so they're visible on large photos
  const uiScale = imageSize.width > 0 ? imageSize.width / BASE_VIEW_WIDTH : 1
  const [selected, setSelected] = useState<string | null>(null)
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

  const getScaledPoint = useCallback(
    (clientX: number, clientY: number): Point => {
      if (!containerRef.current) return { x: 0, y: 0 }

      const rect = containerRef.current.getBoundingClientRect()
      const scaleX = imageSize.width / rect.width
      const scaleY = imageSize.height / rect.height

      return {
        x: Math.max(0, Math.min(imageSize.width, (clientX - rect.left) * scaleX)),
        y: Math.max(0, Math.min(imageSize.height, (clientY - rect.top) * scaleY)),
      }
    },
    [imageSize]
  )

  const updatePolygons = useCallback((updated: Polygon[]) => {
    pushHistory(updated)
    onPolygonsChange(updated)
  }, [pushHistory, onPolygonsChange])

  const handlePolygonClick = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!editable) return

    setSelected(selected === id ? null : id)
  }

  const handleEdgeClick = (polyId: string, edgeIdx: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
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
    if (dragging) {
      pushHistory(polygonsRef.current)
    }
    setDragging(null)
  }, [dragging, pushHistory])

  const handleTouchEnd = useCallback(() => {
    if (dragging) {
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
    setSelected(null)
  }

  const handleDeletePolygon = (id: string) => {
    updatePolygons(polygons.filter((p) => p.id !== id))
    setSelected(null)
  }

  // auto-select first polygon when switching to edit modes
  const handleModeChange = (mode: EditMode) => {
    setEditMode(mode)
    if ((mode === 'vertex' || mode === 'add-vertex' || mode === 'delete-vertex') && !selected && polygons.length > 0) {
      setSelected(polygons[0].id)
    }
  }

  if (!imageSize.width) {
    return <div className="bg-inset rounded-lg aspect-[4/3]" />
  }

  const selectedPoly = polygons.find(p => p.id === selected)

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      {/* toolbar */}
      {editable && (
        <div className="flex items-center gap-4 flex-shrink-0">
          <div className="flex gap-1 bg-elevated rounded-lg p-1 border border-border">
            <button
              onClick={() => handleModeChange('vertex')}
              className={`p-2 rounded ${
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
              className={`p-2 rounded ${
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
              className={`p-2 rounded ${
                editMode === 'delete-vertex'
                  ? 'bg-accent-muted text-accent'
                  : 'hover:bg-border text-text-secondary'
              }`}
              title="Delete vertex"
              disabled={selectedPoly && selectedPoly.points.length <= 3}
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
            {(editMode === 'select' || editMode === 'vertex') && !selected && 'Click an outline to select it'}
            {(editMode === 'select' || editMode === 'vertex') && selected && 'Drag vertices to adjust the outline'}
            {editMode === 'add-vertex' && 'Click on an edge to add a vertex'}
            {editMode === 'delete-vertex' && 'Click a vertex to remove it'}
          </span>

          {selected && (
            <button
              onClick={() => handleDeletePolygon(selected)}
              className="ml-auto px-3 py-1.5 text-sm text-red-400 hover:bg-red-900/20 rounded border border-red-800 flex items-center gap-1"
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
          className="relative bg-inset rounded-lg overflow-hidden"
          style={fitted.width ? { width: fitted.width, height: fitted.height } : { width: '100%', aspectRatio: `${imageSize.width} / ${imageSize.height}` }}
          onClick={handleBackgroundClick}
        >
        <img
          src={imageUrl}
          alt="Corrected"
          className="w-full h-full pointer-events-none"
          draggable={false}
        />

        <svg
          className="absolute inset-0 w-full h-full"
          viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
        >
          {polygons.map((poly) => {
            const isSelected = selected === poly.id
            const pathData = polygonPathData(poly.points, poly.interior_rings)

            return (
              <g key={poly.id}>
                <path
                  d={pathData}
                  fillRule="evenodd"
                  fill={isSelected ? 'rgba(90, 180, 222, 0.3)' : 'rgba(90, 180, 222, 0.15)'}
                  stroke={isSelected ? 'rgb(72, 168, 214)' : 'rgb(90, 180, 222)'}
                  strokeWidth={uiScale * (isSelected ? 2 : 1)}
                  className="cursor-pointer"
                  onClick={handlePolygonClick(poly.id)}
                />

                {/* edge click targets for adding vertices */}
                {isSelected && editable && editMode === 'add-vertex' &&
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
                {isSelected &&
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
        </div>
      </div>

    </div>
  )
}
