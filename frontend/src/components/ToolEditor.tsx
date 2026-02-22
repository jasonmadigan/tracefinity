'use client'

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { Plus, Circle, Square, RectangleHorizontal, Fingerprint } from 'lucide-react'
import type { Point, FingerHole } from '@/types'
import { simplifyPolygon, smoothEpsilon, snapToGrid as snapToGridUtil } from '@/lib/svg'
import { DISPLAY_SCALE, SNAP_GRID, ZOOM_FACTOR } from '@/lib/constants'
import { useHistory } from '@/hooks/useHistory'
import { ToolEditorToolbar } from '@/components/ToolEditorToolbar'
import { ToolEditorCanvas } from '@/components/ToolEditorCanvas'
import type { EditMode, Selection } from '@/components/ToolEditorToolbar'

interface Props {
  points: Point[]
  fingerHoles: FingerHole[]
  interiorRings?: Point[][]
  smoothed: boolean
  smoothLevel: number
  onPointsChange: (points: Point[]) => void
  onFingerHolesChange: (holes: FingerHole[]) => void
  onSmoothedChange: (smoothed: boolean) => void
  onSmoothLevelChange: (level: number) => void
}

const PADDING_MM = 20

type DragState =
  | { type: 'vertex'; pointIdx: number }
  | { type: 'hole'; holeId: string; startX: number; startY: number; origX: number; origY: number }
  | { type: 'resize'; holeId: string; startX: number; startY: number; origRadius: number; origWidth?: number; origHeight?: number; centerX: number; centerY: number }
  | { type: 'rotate-hole'; holeId: string; centerX: number; centerY: number; startAngle: number; origRotation: number }
  | { type: 'rotate-polygon'; centerX: number; centerY: number; startAngle: number; origPoints: Point[]; origHoles: FingerHole[] }
  | { type: 'pan'; startClientX: number; startClientY: number; origPanX: number; origPanY: number; svgScale: number }
  | null

interface HistoryEntry {
  points: Point[]
  fingerHoles: FingerHole[]
}

export function ToolEditor({ points, fingerHoles, interiorRings, smoothed, smoothLevel, onPointsChange, onFingerHolesChange, onSmoothedChange, onSmoothLevelChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [editMode, setEditMode] = useState<EditMode>('select')
  const [dragging, setDragging] = useState<DragState>(null)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [cutoutOpen, setCutoutOpen] = useState(false)
  const spaceHeld = useRef(false)
  const didPanRef = useRef(false)

  // undo/redo
  const historyOnChange = useCallback((entry: HistoryEntry) => {
    onPointsChange(entry.points)
    onFingerHolesChange(entry.fingerHoles)
  }, [onPointsChange, onFingerHolesChange])

  const { set: pushHistory, undo: handleUndo, redo: handleRedo, canUndo, canRedo } = useHistory<HistoryEntry>(
    { points, fingerHoles },
    historyOnChange
  )

  // local drag state: renders locally during drag, flushes to parent on mouseup
  const [dragPoints, setDragPoints] = useState<Point[] | null>(null)
  const [dragHoles, setDragHoles] = useState<FingerHole[] | null>(null)
  const rawDisplayPoints = dragPoints ?? points
  const displayHoles = dragHoles ?? fingerHoles
  const smoothedPoints = useMemo(() => {
    if (!smoothed || points.length <= 3) return null
    return simplifyPolygon(points, smoothEpsilon(points, smoothLevel))
  }, [smoothed, smoothLevel, points])
  const displayPoints = smoothed && smoothedPoints ? smoothedPoints : rawDisplayPoints

  // refs for stale closure avoidance
  const pointsRef = useRef(points)
  const holesRef = useRef(fingerHoles)
  const dragPointsRef = useRef(dragPoints)
  const dragHolesRef = useRef(dragHoles)
  const onPointsRef = useRef(onPointsChange)
  const onHolesRef = useRef(onFingerHolesChange)
  useEffect(() => { pointsRef.current = points }, [points])
  useEffect(() => { holesRef.current = fingerHoles }, [fingerHoles])
  useEffect(() => { dragPointsRef.current = dragPoints }, [dragPoints])
  useEffect(() => { dragHolesRef.current = dragHoles }, [dragHoles])
  useEffect(() => { onPointsRef.current = onPointsChange }, [onPointsChange])
  useEffect(() => { onHolesRef.current = onFingerHolesChange }, [onFingerHolesChange])
  const zoomRef = useRef(zoom)
  const panRef = useRef(pan)
  useEffect(() => { zoomRef.current = zoom }, [zoom])
  useEffect(() => { panRef.current = pan }, [pan])

  // compute viewBox from props (not drag state) so the coordinate frame stays stable during drag
  const bounds = (() => {
    if (points.length === 0) return { minX: -50, minY: -50, maxX: 50, maxY: 50 }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of points) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
    for (const fh of fingerHoles) {
      const r = fh.shape === 'rectangle' ? Math.max(fh.width || 0, fh.height || 0) / 2 : fh.radius
      minX = Math.min(minX, fh.x - r)
      minY = Math.min(minY, fh.y - r)
      maxX = Math.max(maxX, fh.x + r)
      maxY = Math.max(maxY, fh.y + r)
    }
    return { minX, minY, maxX, maxY }
  })()

  const vbX = (bounds.minX - PADDING_MM) * DISPLAY_SCALE
  const vbY = (bounds.minY - PADDING_MM) * DISPLAY_SCALE
  const vbW = (bounds.maxX - bounds.minX + PADDING_MM * 2) * DISPLAY_SCALE
  const vbH = (bounds.maxY - bounds.minY + PADDING_MM * 2) * DISPLAY_SCALE

  // zoomed viewBox
  const zvbW = vbW / zoom
  const zvbH = vbH / zoom
  const zvbX = vbX + (vbW - zvbW) / 2 + pan.x
  const zvbY = vbY + (vbH - zvbH) / 2 + pan.y

  // grid lines (10mm spacing, centered on origin)
  const gridStep = 10
  const visMinX = zvbX / DISPLAY_SCALE
  const visMaxX = (zvbX + zvbW) / DISPLAY_SCALE
  const visMinY = zvbY / DISPLAY_SCALE
  const visMaxY = (zvbY + zvbH) / DISPLAY_SCALE
  const gridMinX = Math.floor(visMinX / gridStep) * gridStep
  const gridMaxX = Math.ceil(visMaxX / gridStep) * gridStep
  const gridMinY = Math.floor(visMinY / gridStep) * gridStep
  const gridMaxY = Math.ceil(visMaxY / gridStep) * gridStep

  const screenToMm = useCallback((clientX: number, clientY: number): Point => {
    if (!svgRef.current) return { x: 0, y: 0 }
    const rect = svgRef.current.getBoundingClientRect()
    const scaleX = zvbW / rect.width
    const scaleY = zvbH / rect.height
    const scale = Math.max(scaleX, scaleY)
    const offsetX = (rect.width * scale - zvbW) / 2
    const offsetY = (rect.height * scale - zvbH) / 2
    const svgX = (clientX - rect.left) * scale - offsetX + zvbX
    const svgY = (clientY - rect.top) * scale - offsetY + zvbY
    return { x: svgX / DISPLAY_SCALE, y: svgY / DISPLAY_SCALE }
  }, [zvbW, zvbH, zvbX, zvbY])

  const screenToMmRef = useRef(screenToMm)
  useEffect(() => { screenToMmRef.current = screenToMm }, [screenToMm])

  // scroll-to-zoom (needs passive: false for preventDefault)
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR
      const oldZoom = zoomRef.current
      const newZoom = Math.min(20, Math.max(0.5, oldZoom * factor))
      if (newZoom === oldZoom) return

      const rect = svg.getBoundingClientRect()
      const curPan = panRef.current

      const curW = vbW / oldZoom
      const curH = vbH / oldZoom
      const curX = vbX + (vbW - curW) / 2 + curPan.x
      const curY = vbY + (vbH - curH) / 2 + curPan.y

      const svgScale = Math.min(rect.width / curW, rect.height / curH)
      const padLeft = (rect.width - curW * svgScale) / 2
      const padTop = (rect.height - curH * svgScale) / 2
      const cursorX = curX + (e.clientX - rect.left - padLeft) / svgScale
      const cursorY = curY + (e.clientY - rect.top - padTop) / svgScale

      const newW = vbW / newZoom
      const newH = vbH / newZoom
      const newX = vbX + (vbW - newW) / 2 + curPan.x
      const newY = vbY + (vbH - newH) / 2 + curPan.y

      const newSvgScale = Math.min(rect.width / newW, rect.height / newH)
      const newPadLeft = (rect.width - newW * newSvgScale) / 2
      const newPadTop = (rect.height - newH * newSvgScale) / 2
      const newCursorX = newX + (e.clientX - rect.left - newPadLeft) / newSvgScale
      const newCursorY = newY + (e.clientY - rect.top - newPadTop) / newSvgScale

      setPan({ x: curPan.x + (cursorX - newCursorX), y: curPan.y + (cursorY - newCursorY) })
      setZoom(newZoom)
    }
    svg.addEventListener('wheel', handleWheel, { passive: false })
    return () => svg.removeEventListener('wheel', handleWheel)
  }, [vbW, vbH, vbX, vbY])

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

  const snapToGrid = useCallback((v: number) => {
    if (!snapEnabled) return v
    return snapToGridUtil(v, SNAP_GRID)
  }, [snapEnabled])

  const snapRef = useRef(snapToGrid)
  useEffect(() => { snapRef.current = snapToGrid }, [snapToGrid])

  const centroid = (() => {
    if (displayPoints.length === 0) return { x: 0, y: 0 }
    const cx = displayPoints.reduce((s, p) => s + p.x, 0) / displayPoints.length
    const cy = displayPoints.reduce((s, p) => s + p.y, 0) / displayPoints.length
    return { x: cx, y: cy }
  })()

  const rotateAll = useCallback((angleDeg: number) => {
    const n = pointsRef.current.length
    if (n === 0) return
    const pts = pointsRef.current
    const holes = holesRef.current
    const cx = pts.reduce((s, p) => s + p.x, 0) / n
    const cy = pts.reduce((s, p) => s + p.y, 0) / n
    const rad = angleDeg * Math.PI / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const newPts = pts.map(p => {
      const dx = p.x - cx, dy = p.y - cy
      return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
    })
    const newHoles = holes.map(fh => {
      const dx = fh.x - cx, dy = fh.y - cy
      return { ...fh, x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos, rotation: ((fh.rotation || 0) + angleDeg) % 360 }
    })
    pushHistory({ points: newPts, fingerHoles: newHoles })
    onPointsRef.current(newPts)
    onHolesRef.current(newHoles)
  }, [pushHistory])

  const handleRotatePolygonMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    const pos = screenToMm(e.clientX, e.clientY)
    const cx = centroid.x
    const cy = centroid.y
    const startAngle = Math.atan2(pos.y - cy, pos.x - cx)
    setDragging({
      type: 'rotate-polygon',
      centerX: cx,
      centerY: cy,
      startAngle,
      origPoints: JSON.parse(JSON.stringify(points)),
      origHoles: JSON.parse(JSON.stringify(fingerHoles)),
    })
  }

  const createCutout = (xMm: number, yMm: number): FingerHole | null => {
    const base = { id: `fh-${Date.now()}`, x: xMm, y: yMm, rotation: 0 }
    switch (editMode) {
      case 'finger-hole': return { ...base, radius: 15, shape: 'circle' as const }
      case 'circle': return { ...base, radius: 10, shape: 'circle' as const }
      case 'square': return { ...base, radius: 10, shape: 'square' as const }
      case 'rectangle': return { ...base, radius: 15, width: 30, height: 20, shape: 'rectangle' as const }
      default: return null
    }
  }

  // vertex interactions
  const handleVertexMouseDown = (pointIdx: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (editMode === 'delete-vertex') {
      if (points.length <= 3) return
      const updated = [...points]
      updated.splice(pointIdx, 1)
      pushHistory({ points: updated, fingerHoles })
      onPointsChange(updated)
      return
    }
    setSelection({ type: 'vertex', pointIdx })
    setDragging({ type: 'vertex', pointIdx })
  }

  const handleEdgeClick = (edgeIdx: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (editMode !== 'add-vertex') return
    const pos = screenToMm(e.clientX, e.clientY)
    const updated = [...points]
    updated.splice(edgeIdx + 1, 0, pos)
    pushHistory({ points: updated, fingerHoles })
    onPointsChange(updated)
  }

  // hole interactions
  const handleHoleMouseDown = (holeId: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (editMode !== 'select') {
      const pos = screenToMm(e.clientX, e.clientY)
      const cutout = createCutout(pos.x, pos.y)
      if (cutout) {
        const updated = [...fingerHoles, cutout]
        pushHistory({ points, fingerHoles: updated })
        onFingerHolesChange(updated)
      }
      return
    }
    const hole = fingerHoles.find(fh => fh.id === holeId)
    if (!hole) return
    setSelection({ type: 'hole', holeId })
    const pos = screenToMm(e.clientX, e.clientY)
    setDragging({ type: 'hole', holeId, startX: pos.x, startY: pos.y, origX: hole.x, origY: hole.y })
  }

  const handleResizeMouseDown = (holeId: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    const hole = fingerHoles.find(fh => fh.id === holeId)
    if (!hole) return
    const pos = screenToMm(e.clientX, e.clientY)
    setDragging({
      type: 'resize', holeId, startX: pos.x, startY: pos.y,
      origRadius: hole.radius, origWidth: hole.width, origHeight: hole.height,
      centerX: hole.x, centerY: hole.y,
    })
  }

  const handleHoleRotateMouseDown = (holeId: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    const hole = fingerHoles.find(fh => fh.id === holeId)
    if (!hole) return
    const pos = screenToMm(e.clientX, e.clientY)
    const startAngle = Math.atan2(pos.y - hole.y, pos.x - hole.x)
    setDragging({ type: 'rotate-hole', holeId, centerX: hole.x, centerY: hole.y, startAngle, origRotation: hole.rotation || 0 })
  }

  const handleBackgroundClick = (e: React.MouseEvent) => {
    if (didPanRef.current) {
      didPanRef.current = false
      return
    }
    if (editMode === 'finger-hole' || editMode === 'circle' || editMode === 'square' || editMode === 'rectangle') {
      const pos = screenToMm(e.clientX, e.clientY)
      const cutout = createCutout(snapToGrid(pos.x), snapToGrid(pos.y))
      if (cutout) {
        const updated = [...fingerHoles, cutout]
        pushHistory({ points, fingerHoles: updated })
        onFingerHolesChange(updated)
      }
      return
    }
    setSelection(null)
  }

  const handleSvgMouseDown = (e: React.MouseEvent) => {
    const isPanTrigger = e.button === 1 || (e.button === 0 && spaceHeld.current)
    if (!isPanTrigger) return
    e.preventDefault()
    if (!svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const svgScale = Math.min(rect.width / zvbW, rect.height / zvbH)
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

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging) return
    const pos = screenToMmRef.current(e.clientX, e.clientY)
    const snap = snapRef.current
    const currentPoints = dragPointsRef.current ?? pointsRef.current
    const currentHoles = dragHolesRef.current ?? holesRef.current

    if (dragging.type === 'vertex') {
      const updated = [...currentPoints]
      updated[dragging.pointIdx] = { x: snap(pos.x), y: snap(pos.y) }
      setDragPoints(updated)
    } else if (dragging.type === 'hole') {
      const dx = pos.x - dragging.startX
      const dy = pos.y - dragging.startY
      const updated = currentHoles.map(fh => {
        if (fh.id !== dragging.holeId) return fh
        return { ...fh, x: snap(dragging.origX + dx), y: snap(dragging.origY + dy) }
      })
      setDragHoles(updated)
    } else if (dragging.type === 'resize') {
      const dx = pos.x - dragging.centerX
      const dy = pos.y - dragging.centerY
      const newRadius = Math.max(5, Math.sqrt(dx * dx + dy * dy))
      const scaleMult = dragging.origRadius > 0 ? newRadius / dragging.origRadius : 1
      const updated = currentHoles.map(fh => {
        if (fh.id !== dragging.holeId) return fh
        if (fh.shape === 'rectangle' && dragging.origWidth && dragging.origHeight) {
          return { ...fh, radius: newRadius, width: Math.max(10, dragging.origWidth * scaleMult), height: Math.max(10, dragging.origHeight * scaleMult) }
        }
        return { ...fh, radius: newRadius }
      })
      setDragHoles(updated)
    } else if (dragging.type === 'rotate-hole') {
      const currentAngle = Math.atan2(pos.y - dragging.centerY, pos.x - dragging.centerX)
      const deltaAngle = (currentAngle - dragging.startAngle) * (180 / Math.PI)
      const updated = currentHoles.map(fh => {
        if (fh.id !== dragging.holeId) return fh
        return { ...fh, rotation: (dragging.origRotation + deltaAngle) % 360 }
      })
      setDragHoles(updated)
    } else if (dragging.type === 'rotate-polygon') {
      const currentAngle = Math.atan2(pos.y - dragging.centerY, pos.x - dragging.centerX)
      const delta = currentAngle - dragging.startAngle
      const cos = Math.cos(delta), sin = Math.sin(delta)
      const cx = dragging.centerX, cy = dragging.centerY
      const newPts = dragging.origPoints.map(p => {
        const dx = p.x - cx, dy = p.y - cy
        return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
      })
      const newHoles = dragging.origHoles.map(fh => {
        const dx = fh.x - cx, dy = fh.y - cy
        const origRot = fh.rotation || 0
        return { ...fh, x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos, rotation: (origRot + delta * 180 / Math.PI) % 360 }
      })
      setDragPoints(newPts)
      setDragHoles(newHoles)
    } else if (dragging.type === 'pan') {
      const dx = (e.clientX - dragging.startClientX) / dragging.svgScale
      const dy = (e.clientY - dragging.startClientY) / dragging.svgScale
      setPan({ x: dragging.origPanX - dx, y: dragging.origPanY - dy })
      didPanRef.current = true
    }
  }, [dragging])

  const handleMouseUp = useCallback(() => {
    if (dragging) {
      if (dragging.type === 'pan') {
        setDragging(null)
        return
      }
      const finalPoints = dragPointsRef.current ?? pointsRef.current
      const finalHoles = dragHolesRef.current ?? holesRef.current
      if (dragPointsRef.current) onPointsRef.current(finalPoints)
      if (dragHolesRef.current) onHolesRef.current(finalHoles)
      pushHistory({ points: finalPoints, fingerHoles: finalHoles })
      setDragPoints(null)
      setDragHoles(null)
    }
    setDragging(null)
  }, [dragging, pushHistory])

  useEffect(() => {
    if (dragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [dragging, handleMouseMove, handleMouseUp])

  const handleDeleteHole = () => {
    if (selection?.type !== 'hole') return
    const updated = fingerHoles.filter(fh => fh.id !== selection.holeId)
    pushHistory({ points, fingerHoles: updated })
    onFingerHolesChange(updated)
    setSelection(null)
  }

  const selectedHole = selection?.type === 'hole'
    ? displayHoles.find(fh => fh.id === selection.holeId)
    : null

  const isCutoutMode = editMode === 'finger-hole' || editMode === 'circle' || editMode === 'square' || editMode === 'rectangle'

  const cutoutModeIcon = editMode === 'finger-hole' ? <Fingerprint className="w-4.5 h-4.5" />
    : editMode === 'circle' ? <Circle className="w-4.5 h-4.5" />
    : editMode === 'square' ? <Square className="w-4.5 h-4.5" />
    : editMode === 'rectangle' ? <RectangleHorizontal className="w-4.5 h-4.5" />
    : <Plus className="w-4.5 h-4.5" />

  const cutoutModeLabel = editMode === 'finger-hole' ? 'Finger hole'
    : editMode === 'circle' ? 'Circle'
    : editMode === 'square' ? 'Square'
    : editMode === 'rectangle' ? 'Rectangle'
    : 'Cutout'

  return (
    <div className="h-full flex flex-col gap-3">
      <ToolEditorToolbar
        editMode={editMode}
        setEditMode={setEditMode}
        smoothed={smoothed}
        smoothLevel={smoothLevel}
        onSmoothedChange={onSmoothedChange}
        onSmoothLevelChange={onSmoothLevelChange}
        snapEnabled={snapEnabled}
        setSnapEnabled={setSnapEnabled}
        canUndo={canUndo}
        canRedo={canRedo}
        handleUndo={handleUndo}
        handleRedo={handleRedo}
        cutoutOpen={cutoutOpen}
        setCutoutOpen={setCutoutOpen}
        isCutoutMode={isCutoutMode}
        cutoutModeIcon={cutoutModeIcon}
        cutoutModeLabel={cutoutModeLabel}
        selection={selection}
        selectedHole={selectedHole}
        handleDeleteHole={handleDeleteHole}
        displayPointsCount={displayPoints.length}
        rotateAll={rotateAll}
      />
      <ToolEditorCanvas
        svgRef={svgRef}
        zvbX={zvbX}
        zvbY={zvbY}
        zvbW={zvbW}
        zvbH={zvbH}
        isCutoutMode={isCutoutMode}
        handleBackgroundClick={handleBackgroundClick}
        handleSvgMouseDown={handleSvgMouseDown}
        gridMinX={gridMinX}
        gridMaxX={gridMaxX}
        gridMinY={gridMinY}
        gridMaxY={gridMaxY}
        gridStep={gridStep}
        zoom={zoom}
        displayPoints={displayPoints}
        smoothed={smoothed}
        interiorRings={interiorRings}
        points={points}
        editMode={editMode}
        selection={selection}
        handleEdgeClick={handleEdgeClick}
        handleVertexMouseDown={handleVertexMouseDown}
        displayHoles={displayHoles}
        handleHoleMouseDown={handleHoleMouseDown}
        handleResizeMouseDown={handleResizeMouseDown}
        handleHoleRotateMouseDown={handleHoleRotateMouseDown}
        handleRotatePolygonMouseDown={handleRotatePolygonMouseDown}
        bounds={bounds}
        handleResetZoom={handleResetZoom}
      />
    </div>
  )
}
