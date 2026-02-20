'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Move, Plus, Minus, Undo2, Redo2, Trash2, Circle, Square, RectangleHorizontal, Fingerprint, Magnet, RotateCw } from 'lucide-react'
import type { Point, FingerHole } from '@/types'
import { polygonPathData } from '@/lib/svg'

interface Props {
  points: Point[]
  fingerHoles: FingerHole[]
  interiorRings?: Point[][]
  onPointsChange: (points: Point[]) => void
  onFingerHolesChange: (holes: FingerHole[]) => void
}

const DISPLAY_SCALE = 8
const SNAP_GRID = 5
const MAX_HISTORY = 50
const PADDING_MM = 20

type EditMode = 'select' | 'add-vertex' | 'delete-vertex' | 'finger-hole' | 'circle' | 'square' | 'rectangle'

type Selection =
  | { type: 'vertex'; pointIdx: number }
  | { type: 'hole'; holeId: string }
  | null

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

export function ToolEditor({ points, fingerHoles, interiorRings, onPointsChange, onFingerHolesChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [editMode, setEditMode] = useState<EditMode>('select')
  const [dragging, setDragging] = useState<DragState>(null)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const spaceHeld = useRef(false)
  const didPanRef = useRef(false)

  // undo/redo
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const isUndoRedo = useRef(false)

  // local drag state: renders locally during drag, flushes to parent on mouseup
  const [dragPoints, setDragPoints] = useState<Point[] | null>(null)
  const [dragHoles, setDragHoles] = useState<FingerHole[] | null>(null)
  const displayPoints = dragPoints ?? points
  const displayHoles = dragHoles ?? fingerHoles

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

  const pushHistory = useCallback((entry: HistoryEntry) => {
    if (isUndoRedo.current) {
      isUndoRedo.current = false
      return
    }
    setHistory(prev => {
      const next = prev.slice(0, historyIndex + 1)
      next.push(JSON.parse(JSON.stringify(entry)))
      if (next.length > MAX_HISTORY) next.shift()
      return next
    })
    setHistoryIndex(prev => Math.min(prev + 1, MAX_HISTORY - 1))
  }, [historyIndex])

  useEffect(() => {
    if (history.length === 0 && points.length > 0) {
      setHistory([{ points: JSON.parse(JSON.stringify(points)), fingerHoles: JSON.parse(JSON.stringify(fingerHoles)) }])
      setHistoryIndex(0)
    }
  }, [points, fingerHoles, history.length])

  const canUndo = historyIndex > 0
  const canRedo = historyIndex < history.length - 1

  const handleUndo = useCallback(() => {
    if (!canUndo) return
    isUndoRedo.current = true
    const idx = historyIndex - 1
    setHistoryIndex(idx)
    const entry = JSON.parse(JSON.stringify(history[idx]))
    onPointsChange(entry.points)
    onFingerHolesChange(entry.fingerHoles)
  }, [canUndo, historyIndex, history, onPointsChange, onFingerHolesChange])

  const handleRedo = useCallback(() => {
    if (!canRedo) return
    isUndoRedo.current = true
    const idx = historyIndex + 1
    setHistoryIndex(idx)
    const entry = JSON.parse(JSON.stringify(history[idx]))
    onPointsChange(entry.points)
    onFingerHolesChange(entry.fingerHoles)
  }, [canRedo, historyIndex, history, onPointsChange, onFingerHolesChange])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        if (e.shiftKey) handleRedo()
        else handleUndo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleUndo, handleRedo])

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

  // grid lines (10mm spacing, centered on origin) — cover visible area
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
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      const oldZoom = zoomRef.current
      const newZoom = Math.min(20, Math.max(0.5, oldZoom * factor))
      if (newZoom === oldZoom) return

      const rect = svg.getBoundingClientRect()
      const curPan = panRef.current

      // current zoomed viewBox
      const curW = vbW / oldZoom
      const curH = vbH / oldZoom
      const curX = vbX + (vbW - curW) / 2 + curPan.x
      const curY = vbY + (vbH - curH) / 2 + curPan.y

      // cursor position in SVG space
      const svgScale = Math.min(rect.width / curW, rect.height / curH)
      const padLeft = (rect.width - curW * svgScale) / 2
      const padTop = (rect.height - curH * svgScale) / 2
      const cursorX = curX + (e.clientX - rect.left - padLeft) / svgScale
      const cursorY = curY + (e.clientY - rect.top - padTop) / svgScale

      // new viewBox (without pan adjustment)
      const newW = vbW / newZoom
      const newH = vbH / newZoom
      const newX = vbX + (vbW - newW) / 2 + curPan.x
      const newY = vbY + (vbH - newH) / 2 + curPan.y

      // where cursor would map in new viewBox
      const newSvgScale = Math.min(rect.width / newW, rect.height / newH)
      const newPadLeft = (rect.width - newW * newSvgScale) / 2
      const newPadTop = (rect.height - newH * newSvgScale) / 2
      const newCursorX = newX + (e.clientX - rect.left - newPadLeft) / newSvgScale
      const newCursorY = newY + (e.clientY - rect.top - newPadTop) / newSvgScale

      // adjust pan so cursor stays fixed
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
    return Math.round(v / SNAP_GRID) * SNAP_GRID
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
      // place a new cutout near this one
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

  const handleDoubleClick = (e: React.MouseEvent) => {
    // only reset on background double-click (not on elements that stopPropagation)
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const stopClick = (e: React.MouseEvent) => e.stopPropagation()

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
      // flush to parent
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

  return (
    <div className="h-full flex flex-col gap-3">
      {/* toolbar */}
      <div className="flex items-center gap-4 flex-shrink-0">
        <div className="flex gap-1 bg-elevated rounded-lg p-1 border border-border">
          <button
            onClick={() => setEditMode('select')}
            className={`p-2 rounded ${editMode === 'select' ? 'bg-accent-muted text-blue-400' : 'hover:bg-border text-text-secondary'}`}
            title="Move vertices / cutouts"
          >
            <Move className="w-5 h-5" />
          </button>
          <button
            onClick={() => setEditMode('add-vertex')}
            className={`p-2 rounded ${editMode === 'add-vertex' ? 'bg-accent-muted text-blue-400' : 'hover:bg-border text-text-secondary'}`}
            title="Add vertex"
          >
            <Plus className="w-5 h-5" />
          </button>
          <button
            onClick={() => setEditMode('delete-vertex')}
            className={`p-2 rounded ${editMode === 'delete-vertex' ? 'bg-accent-muted text-blue-400' : 'hover:bg-border text-text-secondary'}`}
            title="Delete vertex"
            disabled={displayPoints.length <= 3}
          >
            <Minus className="w-5 h-5" />
          </button>
        </div>

        <div className="h-6 w-px bg-border-subtle" />

        <div className="flex gap-1 bg-elevated rounded-lg p-1 border border-border">
          <button
            onClick={() => setEditMode('finger-hole')}
            className={`p-2 rounded ${editMode === 'finger-hole' ? 'bg-accent-muted text-blue-400' : 'hover:bg-border text-text-secondary'}`}
            title="Add finger hole (15mm)"
          >
            <Fingerprint className="w-5 h-5" />
          </button>
          <button
            onClick={() => setEditMode('circle')}
            className={`p-2 rounded ${editMode === 'circle' ? 'bg-accent-muted text-blue-400' : 'hover:bg-border text-text-secondary'}`}
            title="Add circle cutout (10mm)"
          >
            <Circle className="w-5 h-5" />
          </button>
          <button
            onClick={() => setEditMode('square')}
            className={`p-2 rounded ${editMode === 'square' ? 'bg-accent-muted text-blue-400' : 'hover:bg-border text-text-secondary'}`}
            title="Add square cutout (20mm)"
          >
            <Square className="w-5 h-5" />
          </button>
          <button
            onClick={() => setEditMode('rectangle')}
            className={`p-2 rounded ${editMode === 'rectangle' ? 'bg-accent-muted text-blue-400' : 'hover:bg-border text-text-secondary'}`}
            title="Add rectangle cutout (30x20mm)"
          >
            <RectangleHorizontal className="w-5 h-5" />
          </button>
        </div>

        <div className="h-6 w-px bg-border-subtle" />

        <div className="flex items-center gap-1">
          <button
            onClick={handleUndo}
            disabled={!canUndo}
            className="p-2 rounded hover:bg-border text-text-secondary disabled:opacity-30 disabled:cursor-not-allowed"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-5 h-5" />
          </button>
          <button
            onClick={handleRedo}
            disabled={!canRedo}
            className="p-2 rounded hover:bg-border text-text-secondary disabled:opacity-30 disabled:cursor-not-allowed"
            title="Redo (Ctrl+Shift+Z)"
          >
            <Redo2 className="w-5 h-5" />
          </button>
        </div>

        <button
          onClick={() => setSnapEnabled(!snapEnabled)}
          className={`p-2 rounded flex items-center gap-1 ${snapEnabled ? 'bg-green-900/30 text-green-400' : 'bg-elevated text-text-muted'}`}
          title={`Snap to grid (${SNAP_GRID}mm)`}
        >
          <Magnet className="w-5 h-5" />
          <span className="text-xs font-medium">{snapEnabled ? 'ON' : 'OFF'}</span>
        </button>

        <div className="h-6 w-px bg-border-subtle" />

        <div className="flex gap-1 bg-elevated rounded-lg p-1 border border-border">
          <button
            onClick={() => rotateAll(-90)}
            className="p-2 rounded hover:bg-border text-text-secondary"
            title="Rotate 90° counter-clockwise"
          >
            <RotateCw className="w-5 h-5 -scale-x-100" />
          </button>
          <button
            onClick={() => rotateAll(90)}
            className="p-2 rounded hover:bg-border text-text-secondary"
            title="Rotate 90° clockwise"
          >
            <RotateCw className="w-5 h-5" />
          </button>
        </div>

        <span className="text-sm text-text-muted">
          {editMode === 'select' && 'Drag vertices or cutouts to move them'}
          {editMode === 'add-vertex' && 'Click on an edge to add a vertex'}
          {editMode === 'delete-vertex' && 'Click a vertex to remove it'}
          {editMode === 'finger-hole' && 'Click to add finger hole (15mm)'}
          {editMode === 'circle' && 'Click to add circle (10mm)'}
          {editMode === 'square' && 'Click to add square (20mm)'}
          {editMode === 'rectangle' && 'Click to add rectangle (30x20mm)'}
        </span>

        {selection?.type === 'hole' && (
          <button
            onClick={handleDeleteHole}
            className="ml-auto px-3 py-1.5 text-sm text-red-400 hover:bg-red-900/20 rounded border border-red-800 flex items-center gap-1"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        )}
      </div>

      {selectedHole && (
        <div className="text-sm text-text-secondary bg-elevated rounded border border-border px-3 py-2 flex-shrink-0">
          Selected: {selectedHole.shape || 'circle'}
          {selectedHole.shape === 'rectangle' && selectedHole.width && selectedHole.height
            ? ` (${selectedHole.width.toFixed(0)}x${selectedHole.height.toFixed(0)}mm)`
            : selectedHole.shape === 'square'
            ? ` (${(selectedHole.radius * 2).toFixed(0)}mm)`
            : ` (r=${selectedHole.radius.toFixed(1)}mm)`
          }
          {selectedHole.rotation ? `, rot: ${selectedHole.rotation.toFixed(0)}deg` : ''}
        </div>
      )}

      {/* SVG canvas */}
      <div className="flex-1 min-h-0 bg-inset rounded-lg p-4 flex items-center justify-center">
        <svg
          ref={svgRef}
          viewBox={`${zvbX} ${zvbY} ${zvbW} ${zvbH}`}
          preserveAspectRatio="xMidYMid meet"
          className={`rounded w-full h-full ${isCutoutMode ? 'cursor-crosshair' : 'cursor-default'}`}
          style={{ overflow: 'hidden', backgroundColor: 'rgb(30, 41, 59)' }}
          onClick={handleBackgroundClick}
          onMouseDown={handleSvgMouseDown}
          onDoubleClick={handleDoubleClick}
        >
          {/* background fill */}
          <rect x={zvbX} y={zvbY} width={zvbW} height={zvbH} fill="rgb(30, 41, 59)" />

          {/* grid lines */}
          {Array.from({ length: Math.ceil((gridMaxX - gridMinX) / gridStep) + 1 }).map((_, i) => {
            const x = (gridMinX + i * gridStep) * DISPLAY_SCALE
            const isOrigin = gridMinX + i * gridStep === 0
            return (
              <line
                key={`v${i}`}
                x1={x} y1={gridMinY * DISPLAY_SCALE}
                x2={x} y2={gridMaxY * DISPLAY_SCALE}
                stroke={isOrigin ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)'}
                strokeWidth={(isOrigin ? 1.5 : 0.5) / zoom}
              />
            )
          })}
          {Array.from({ length: Math.ceil((gridMaxY - gridMinY) / gridStep) + 1 }).map((_, i) => {
            const y = (gridMinY + i * gridStep) * DISPLAY_SCALE
            const isOrigin = gridMinY + i * gridStep === 0
            return (
              <line
                key={`h${i}`}
                x1={gridMinX * DISPLAY_SCALE} y1={y}
                x2={gridMaxX * DISPLAY_SCALE} y2={y}
                stroke={isOrigin ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)'}
                strokeWidth={(isOrigin ? 1.5 : 0.5) / zoom}
              />
            )
          })}

          {/* polygon fill */}
          <path
            d={polygonPathData(displayPoints, interiorRings, DISPLAY_SCALE)}
            fillRule="evenodd"
            fill="rgb(71, 85, 105)"
            stroke="rgb(148, 163, 184)"
            strokeWidth={2 / zoom}
          />

          {/* edge click targets for add-vertex mode */}
          {editMode === 'add-vertex' && displayPoints.map((p, idx) => {
            const next = displayPoints[(idx + 1) % displayPoints.length]
            const midX = ((p.x + next.x) / 2) * DISPLAY_SCALE
            const midY = ((p.y + next.y) / 2) * DISPLAY_SCALE
            return (
              <g key={`edge-${idx}`}>
                <line
                  x1={p.x * DISPLAY_SCALE} y1={p.y * DISPLAY_SCALE}
                  x2={next.x * DISPLAY_SCALE} y2={next.y * DISPLAY_SCALE}
                  stroke="transparent" strokeWidth={20}
                  className="cursor-crosshair"
                  onClick={handleEdgeClick(idx)}
                />
                <circle
                  cx={midX} cy={midY} r={5}
                  fill="rgb(34, 197, 94)" stroke="#27272a" strokeWidth={2}
                  className="pointer-events-none"
                />
              </g>
            )
          })}

          {/* vertex handles */}
          {(editMode === 'select' || editMode === 'add-vertex' || editMode === 'delete-vertex') && displayPoints.map((p, idx) => (
            <circle
              key={`v-${idx}`}
              cx={p.x * DISPLAY_SCALE}
              cy={p.y * DISPLAY_SCALE}
              r={8}
              fill={editMode === 'delete-vertex' ? 'rgb(239, 68, 68)' : selection?.type === 'vertex' && selection.pointIdx === idx ? 'rgb(37, 99, 235)' : '#27272a'}
              stroke={editMode === 'delete-vertex' ? 'rgb(185, 28, 28)' : 'rgb(37, 99, 235)'}
              strokeWidth={2}
              className={editMode === 'delete-vertex' ? 'cursor-pointer' : 'cursor-move'}
              onMouseDown={handleVertexMouseDown(idx)}
              onClick={stopClick}
            />
          ))}

          {/* polygon rotate handle */}
          {editMode === 'select' && displayPoints.length > 0 && (() => {
            const cx = centroid.x * DISPLAY_SCALE
            const topY = bounds.minY * DISPLAY_SCALE
            const armLen = 25
            return (
              <g>
                <line
                  x1={cx} y1={topY}
                  x2={cx} y2={topY - armLen}
                  stroke="rgba(59, 130, 246, 0.6)" strokeWidth={2} strokeDasharray="4,4"
                />
                <circle
                  cx={cx} cy={topY - armLen - 12}
                  r={12}
                  fill="rgb(59, 130, 246)" stroke="white" strokeWidth={2}
                  className="cursor-grab"
                  onMouseDown={handleRotatePolygonMouseDown}
                  onClick={stopClick}
                />
                <text
                  x={cx} y={topY - armLen - 7.5}
                  textAnchor="middle" fill="white" fontSize="15"
                  className="pointer-events-none select-none"
                >&#x21BB;</text>
              </g>
            )
          })()}

          {/* finger holes / cutouts (shapes only) */}
          {displayHoles.map(fh => {
            const x = fh.x * DISPLAY_SCALE
            const y = fh.y * DISPLAY_SCALE
            const r = fh.radius * DISPLAY_SCALE
            const shape = fh.shape || 'circle'
            const rotation = fh.rotation || 0
            const isSelected = selection?.type === 'hole' && selection.holeId === fh.id

            const w = shape === 'rectangle' && fh.width ? fh.width * DISPLAY_SCALE : r * 2
            const h = shape === 'rectangle' && fh.height ? fh.height * DISPLAY_SCALE : r * 2

            return (
              <g key={fh.id} transform={rotation !== 0 ? `rotate(${rotation} ${x} ${y})` : undefined}>
                {shape === 'circle' && (
                  <circle
                    cx={x} cy={y} r={r}
                    fill={isSelected ? 'rgb(30, 41, 59)' : 'rgb(51, 65, 85)'}
                    stroke={isSelected ? 'rgb(59, 130, 246)' : 'rgb(30, 41, 59)'}
                    strokeWidth={(isSelected ? 3 : 1) / zoom}
                    className={editMode === 'select' ? 'cursor-move' : 'cursor-default'}
                    onMouseDown={handleHoleMouseDown(fh.id)}
                    onClick={stopClick}
                  />
                )}
                {(shape === 'square' || shape === 'rectangle') && (
                  <rect
                    x={x - w / 2} y={y - h / 2} width={w} height={h}
                    fill={isSelected ? 'rgb(30, 41, 59)' : 'rgb(51, 65, 85)'}
                    stroke={isSelected ? 'rgb(59, 130, 246)' : 'rgb(30, 41, 59)'}
                    strokeWidth={(isSelected ? 3 : 1) / zoom}
                    className={editMode === 'select' ? 'cursor-move' : 'cursor-default'}
                    onMouseDown={handleHoleMouseDown(fh.id)}
                    onClick={stopClick}
                  />
                )}
              </g>
            )
          })}

          {/* selected hole handles (rendered last so they're always on top) */}
          {selection?.type === 'hole' && (() => {
            const fh = displayHoles.find(h => h.id === selection.holeId)
            if (!fh) return null
            const x = fh.x * DISPLAY_SCALE
            const y = fh.y * DISPLAY_SCALE
            const r = fh.radius * DISPLAY_SCALE
            const shape = fh.shape || 'circle'
            const rotation = fh.rotation || 0
            const w = shape === 'rectangle' && fh.width ? fh.width * DISPLAY_SCALE : r * 2
            const h = shape === 'rectangle' && fh.height ? fh.height * DISPLAY_SCALE : r * 2
            const resizeOffset = shape === 'circle' ? r : w / 2
            const topEdge = shape === 'circle' ? r : h / 2

            return (
              <g transform={rotation !== 0 ? `rotate(${rotation} ${x} ${y})` : undefined}>
                <circle
                  cx={x + resizeOffset} cy={y} r={8}
                  fill="rgb(59, 130, 246)" stroke="white" strokeWidth={2}
                  className="cursor-ew-resize"
                  onMouseDown={handleResizeMouseDown(fh.id)}
                  onClick={stopClick}
                />
                <line
                  x1={x} y1={y}
                  x2={x} y2={y - topEdge - 13}
                  stroke="rgba(59, 130, 246, 0.6)" strokeWidth={2} strokeDasharray="4,4"
                />
                <circle
                  cx={x} cy={y - topEdge - 25}
                  r={12}
                  fill="rgb(59, 130, 246)" stroke="white" strokeWidth={2}
                  className="cursor-grab"
                  onMouseDown={handleHoleRotateMouseDown(fh.id)}
                  onClick={stopClick}
                />
                <text
                  x={x} y={y - topEdge - 20.5}
                  textAnchor="middle" fill="white" fontSize="15"
                  className="pointer-events-none select-none"
                >&#x21BB;</text>
              </g>
            )
          })()}
        </svg>
      </div>

      {/* bottom bar */}
      <div className="flex items-center justify-between text-sm flex-shrink-0">
        <span className="text-text-muted">
          {displayPoints.length} vertices, {displayHoles.length} cutout{displayHoles.length !== 1 ? 's' : ''}
        </span>
        <span className="text-text-muted">
          {Math.round(zoom * 100)}%{zoom !== 1 && ' · double-click to reset'}
        </span>
      </div>
    </div>
  )
}
