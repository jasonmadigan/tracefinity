'use client'

import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react'
import { Plus, Circle, Disc, Square, RectangleHorizontal, Fingerprint, ImageIcon, Eye, EyeOff } from 'lucide-react'
import type { Point, FingerHole, ToolImageContext, AffineMatrix } from '@/types'
import { simplifyPolygon, smoothEpsilon, simplifyEpsilon, snapToGrid as snapToGridUtil } from '@/lib/svg'
import { rotateAround, flipAround } from '@/lib/affine'
import { rotateGeometry, centroidOf } from '@/lib/geometry'
import {
  symmetrize, reflectPoint, reflectHole, constrainToAxis, partnerIndex,
  insertMirroredVertex, deleteMirroredVertex, findHolePartner, isHoleOnAxis,
  type SymmetryAxis, type KeepSide,
} from '@/lib/symmetry'
import { DISPLAY_SCALE, SNAP_GRID, ZOOM_FACTOR } from '@/lib/constants'
import { cutoutShapeLabel, isRectangularCutout, resizeRectCutout, resizeRoundCutout } from '@/lib/cutouts'
import { useHistory } from '@/hooks/useHistory'
import { ToolEditorToolbar } from '@/components/ToolEditorToolbar'
import { ToolEditorCanvas } from '@/components/ToolEditorCanvas'
import type { EditMode, Selection } from '@/components/ToolEditorToolbar'
import { cn } from '@/lib/utils'
import { useTheme } from '@/hooks/useTheme'

interface Props {
  points: Point[]
  fingerHoles: FingerHole[]
  interiorRings?: Point[][]
  smoothed: boolean
  smoothLevel: number
  sourceImageContext?: ToolImageContext | null
  showSourceImage?: boolean
  onShowSourceImageChange?: (show: boolean) => void
  sourceImageOpacity?: number
  onSourceImageOpacityChange?: (opacity: number) => void
  onImageTransformChange?: (transform: AffineMatrix) => void
  onPointsChange: (points: Point[]) => void
  onFingerHolesChange: (holes: FingerHole[]) => void
  onSmoothedChange: (smoothed: boolean) => void
  onSmoothLevelChange: (level: number) => void
  onInteriorRingsChange?: (rings: Point[][]) => void
  onAutoRotate?: () => Promise<number | null>
  autoRotating?: boolean
}

const PADDING_MM = 20

type DragState =
  | { type: 'vertex'; pointIdx: number }
  | { type: 'hole'; holeId: string; startX: number; startY: number; origX: number; origY: number; mirrorId?: string; onAxis?: boolean }
  | { type: 'resize'; holeId: string; startX: number; startY: number; origRadius: number; origWidth?: number; origHeight?: number; centerX: number; centerY: number; anchorX?: number; anchorY?: number; rotation?: number; mirrorId?: string }
  | { type: 'rotate-hole'; holeId: string; centerX: number; centerY: number; startAngle: number; origRotation: number; mirrorId?: string }
  | { type: 'rotate-polygon'; centerX: number; centerY: number; startAngle: number; origPoints: Point[]; origHoles: FingerHole[]; origRings: Point[][] }
  | { type: 'pan'; startClientX: number; startClientY: number; origPanX: number; origPanY: number; svgScale: number }
  | { type: 'axis' }
  | null

interface HistoryEntry {
  points: Point[]
  fingerHoles: FingerHole[]
  interiorRings: Point[][]
  imageTransform: AffineMatrix | null
}

export function ToolEditor({ points, fingerHoles, interiorRings, smoothed, smoothLevel, sourceImageContext, showSourceImage = false, onShowSourceImageChange, sourceImageOpacity = 0.45, onSourceImageOpacityChange, onImageTransformChange, onPointsChange, onFingerHolesChange, onSmoothedChange, onSmoothLevelChange, onInteriorRingsChange, onAutoRotate, autoRotating }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [editMode, setEditMode] = useState<EditMode>('select')
  const [previewSmoothed, setPreviewSmoothed] = useState(false)
  const [dragging, setDragging] = useState<DragState>(null)
  // off by default: outline vertices carry the traced size, a 5mm lattice
  // would quantise corrections by up to ~3.5mm
  const [snapEnabled, setSnapEnabled] = useState(false)
  const [snapGrid, setSnapGrid] = useState(SNAP_GRID)
  const [mirrorMode, setMirrorMode] = useState(false)
  const [symmetryAxis, setSymmetryAxis] = useState<SymmetryAxis | null>(null)
  const [keepSide, setKeepSide] = useState<KeepSide>('low')
  const [mirrorNote, setMirrorNote] = useState<string | null>(null)
  const [simplifyLevel, setSimplifyLevel] = useState(1)
  const simplifyLevelRef = useRef(1)
  // session-scoped "most accurate available" reference the slider re-derives from
  const baseRef = useRef<Point[] | null>(null)
  if (baseRef.current === null && points.length > 0) baseRef.current = points
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [cutoutOpen, setCutoutOpen] = useState(false)
  const spaceHeld = useRef(false)
  const didPanRef = useRef(false)
  const mirrorModeRef = useRef(mirrorMode)
  const axisRef = useRef(symmetryAxis)
  const keepSideRef = useRef(keepSide)
  useEffect(() => { mirrorModeRef.current = mirrorMode }, [mirrorMode])
  useEffect(() => { axisRef.current = symmetryAxis }, [symmetryAxis])
  useEffect(() => { keepSideRef.current = keepSide }, [keepSide])

  const imageTransformRef = useRef<AffineMatrix | null>(sourceImageContext?.transform ?? null)
  const onImageTransformRef = useRef(onImageTransformChange)
  const { theme } = useTheme()

  // undo/redo
  const historyOnChange = useCallback((entry: HistoryEntry) => {
    onPointsChange(entry.points)
    onFingerHolesChange(entry.fingerHoles)
    onInteriorRingsChange?.(entry.interiorRings)
    // restore the photo transform captured with this entry so the source
    // image stays aligned with the outline across undo/redo
    if (entry.imageTransform) {
      imageTransformRef.current = entry.imageTransform
      onImageTransformRef.current?.(entry.imageTransform)
    }
  }, [onPointsChange, onFingerHolesChange, onInteriorRingsChange])

  const currentRings = interiorRings ?? []

  const { set: pushEntry, undo: handleUndo, redo: handleRedo, canUndo, canRedo } = useHistory<HistoryEntry>(
    { points, fingerHoles, interiorRings: currentRings, imageTransform: sourceImageContext?.transform ?? null },
    historyOnChange
  )

  // every entry snapshots the photo transform alongside the geometry;
  // rotate/flip pass their post-op transform explicitly
  const pushHistory = useCallback(
    (entry: Omit<HistoryEntry, 'imageTransform'>, imageTransform: AffineMatrix | null = imageTransformRef.current) => {
      pushEntry({ ...entry, imageTransform })
    },
    [pushEntry]
  )

  // local drag state: renders locally during drag, flushes to parent on mouseup
  const [dragPoints, setDragPoints] = useState<Point[] | null>(null)
  const [dragHoles, setDragHoles] = useState<FingerHole[] | null>(null)
  const [dragRings, setDragRings] = useState<Point[][] | null>(null)
  const rawDisplayPoints = dragPoints ?? points
  const displayHoles = dragHoles ?? fingerHoles
  const displayRings = dragRings ?? currentRings
  const smoothedPoints = useMemo(() => {
    if (!previewSmoothed || rawDisplayPoints.length <= 3) return null
    return simplifyPolygon(rawDisplayPoints, smoothEpsilon(smoothLevel))
  }, [previewSmoothed, smoothLevel, rawDisplayPoints])
  const displayPoints = previewSmoothed && smoothedPoints ? smoothedPoints : rawDisplayPoints

  // refs for stale closure avoidance
  const pointsRef = useRef(points)
  const holesRef = useRef(fingerHoles)
  const dragPointsRef = useRef(dragPoints)
  const dragHolesRef = useRef(dragHoles)
  const dragRingsRef = useRef(dragRings)
  const onPointsRef = useRef(onPointsChange)
  const onHolesRef = useRef(onFingerHolesChange)
  const onRingsRef = useRef(onInteriorRingsChange)
  useEffect(() => { pointsRef.current = points }, [points])
  useEffect(() => { holesRef.current = fingerHoles }, [fingerHoles])
  useEffect(() => { dragPointsRef.current = dragPoints }, [dragPoints])
  useEffect(() => { dragHolesRef.current = dragHoles }, [dragHoles])
  useEffect(() => { dragRingsRef.current = dragRings }, [dragRings])
  useEffect(() => { onPointsRef.current = onPointsChange }, [onPointsChange])
  useEffect(() => { onHolesRef.current = onFingerHolesChange }, [onFingerHolesChange])
  useEffect(() => { onRingsRef.current = onInteriorRingsChange }, [onInteriorRingsChange])
  useEffect(() => { imageTransformRef.current = sourceImageContext?.transform ?? null }, [sourceImageContext?.transform])
  useEffect(() => { onImageTransformRef.current = onImageTransformChange }, [onImageTransformChange])
  const rotateDragRef = useRef<{ delta: number; cx: number; cy: number } | null>(null)
  const currentRingsRef = useRef(currentRings)
  useEffect(() => { currentRingsRef.current = currentRings }, [currentRings])
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
      const r = isRectangularCutout(fh.shape) ? Math.max(fh.width || 0, fh.height || 0) / 2 : fh.radius
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
    return snapToGridUtil(v, snapGrid)
  }, [snapEnabled, snapGrid])

  const snapRef = useRef(snapToGrid)
  useEffect(() => { snapRef.current = snapToGrid }, [snapToGrid])

  // ---- symmetric editing ----
  const idCounter = useRef(0)
  const newHoleId = useCallback((seed: string) => `${seed}-m${++idCounter.current}`, [])

  // mirror one half onto the other, establishing the canonical symmetric order
  const applySymmetrize = useCallback((axis: SymmetryAxis, keep: KeepSide): boolean => {
    const result = symmetrize(pointsRef.current, holesRef.current, axis, keep, newHoleId)
    if (!result) {
      setMirrorNote('Outline crosses the axis more than twice — can’t mirror cleanly here.')
      return false
    }
    setMirrorNote(null)
    pushHistory({ points: result.points, fingerHoles: result.fingerHoles, interiorRings: currentRingsRef.current })
    onPointsRef.current(result.points)
    onHolesRef.current(result.fingerHoles)
    return true
  }, [newHoleId, pushHistory])

  const applySymmetrizeRef = useRef(applySymmetrize)
  useEffect(() => { applySymmetrizeRef.current = applySymmetrize }, [applySymmetrize])

  // ---- node-count slider (simplify <-> accurate) ----
  // Always re-derives from the session base, so it's lossless within a session.
  const deriveSimplified = useCallback((level: number): Point[] | null => {
    const base = baseRef.current
    if (!base) return null
    return level >= 1 ? [...base] : simplifyPolygon(base, simplifyEpsilon(base, level))
  }, [])

  const previewSimplify = useCallback((level: number) => {
    simplifyLevelRef.current = level
    setSimplifyLevel(level)
    const next = deriveSimplified(level)
    if (next) onPointsRef.current(next)
  }, [deriveSimplified])

  const commitSimplify = useCallback(() => {
    const next = deriveSimplified(simplifyLevelRef.current)
    if (!next) return
    pushHistory({ points: next, fingerHoles: holesRef.current, interiorRings: currentRingsRef.current })
    onPointsRef.current(next)
  }, [deriveSimplified, pushHistory])

  const toggleMirror = useCallback(() => {
    if (mirrorMode) {
      setMirrorMode(false)
      setMirrorNote(null)
      return
    }
    const pts = pointsRef.current
    if (pts.length < 3) return
    const c = centroidOf(pts)
    const axis: SymmetryAxis = { orientation: 'vertical', pos: c.x }
    if (applySymmetrize(axis, keepSide)) {
      setSymmetryAxis(axis)
      setMirrorMode(true)
    }
  }, [mirrorMode, keepSide, applySymmetrize])

  // re-mirror when the user changes orientation or which half is kept
  const setAxisOrientation = useCallback((orientation: SymmetryAxis['orientation']) => {
    const pts = pointsRef.current
    const c = centroidOf(pts)
    const axis: SymmetryAxis = { orientation, pos: orientation === 'vertical' ? c.x : c.y }
    if (applySymmetrize(axis, keepSide)) setSymmetryAxis(axis)
  }, [keepSide, applySymmetrize])

  const flipKeepSide = useCallback(() => {
    const axis = axisRef.current
    if (!axis) return
    const next: KeepSide = keepSide === 'low' ? 'high' : 'low'
    if (applySymmetrize(axis, next)) setKeepSide(next)
  }, [keepSide, applySymmetrize])

  const centroid = (() => {
    if (displayPoints.length === 0) return { x: 0, y: 0 }
    const cx = displayPoints.reduce((s, p) => s + p.x, 0) / displayPoints.length
    const cy = displayPoints.reduce((s, p) => s + p.y, 0) / displayPoints.length
    return { x: cx, y: cy }
  })()

  const rotateAll = useCallback((angleDeg: number) => {
    const pts = pointsRef.current
    if (pts.length === 0) return
    const { x: cx, y: cy } = centroidOf(pts)
    const rotated = rotateGeometry(pts, holesRef.current, currentRingsRef.current, angleDeg)
    // rotate the photo about the same centre so it stays under the outline
    const m = imageTransformRef.current
    const nextTransform = m ? rotateAround(m, angleDeg * Math.PI / 180, cx, cy) : null
    pushHistory({ points: rotated.points, fingerHoles: rotated.fingerHoles, interiorRings: rotated.interiorRings }, nextTransform)
    onPointsRef.current(rotated.points)
    onHolesRef.current(rotated.fingerHoles)
    onRingsRef.current?.(rotated.interiorRings)
    if (nextTransform) {
      imageTransformRef.current = nextTransform
      onImageTransformRef.current?.(nextTransform)
    }
  }, [pushHistory])

  // edits can land while the angle fetch is in flight; the ref must point at
  // the latest rotateAll (whose history push closes over the current index)
  // before the await resumes, hence layout effect rather than passive effect
  const rotateAllRef = useRef(rotateAll)
  useLayoutEffect(() => { rotateAllRef.current = rotateAll }, [rotateAll])

  // fetches the optimal angle from the parent, then applies it through
  // rotateAll so geometry, photo and undo history stay in lockstep
  const handleAutoRotateWrapped = useCallback(async () => {
    if (!onAutoRotate) return
    const angle = await onAutoRotate()
    if (angle != null && Math.abs(angle) >= 0.01) rotateAllRef.current(angle)
  }, [onAutoRotate])

  const flipAll = useCallback((axis: 'horizontal' | 'vertical') => {
    const pts = pointsRef.current
    const holes = holesRef.current
    const rings = currentRingsRef.current
    const n = pts.length
    if (n === 0) return
    const cx = pts.reduce((s, p) => s + p.x, 0) / n
    const cy = pts.reduce((s, p) => s + p.y, 0) / n
    const flip = (p: Point) => axis === 'horizontal'
      ? { x: 2 * cx - p.x, y: p.y }
      : { x: p.x, y: 2 * cy - p.y }
    // flipping reverses winding order
    const newPts = pts.map(flip).reverse()
    const newHoles = holes.map(fh => ({
      ...fh,
      ...(axis === 'horizontal' ? { x: 2 * cx - fh.x } : { y: 2 * cy - fh.y }),
      rotation: -((fh.rotation || 0) % 360),
    }))
    const newRings = rings.map(ring => ring.map(flip).reverse())
    // mirror the photo about the same axis so it stays under the outline
    const m = imageTransformRef.current
    const nextTransform = m ? flipAround(m, axis, cx, cy) : null
    pushHistory({ points: newPts, fingerHoles: newHoles, interiorRings: newRings }, nextTransform)
    onPointsRef.current(newPts)
    onHolesRef.current(newHoles)
    onInteriorRingsChange?.(newRings)
    if (nextTransform) {
      imageTransformRef.current = nextTransform
      onImageTransformRef.current?.(nextTransform)
    }
  }, [pushHistory, onInteriorRingsChange])

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
      origRings: JSON.parse(JSON.stringify(currentRings)),
    })
  }

  const createCutout = (xMm: number, yMm: number): FingerHole | null => {
    const base = { id: `fh-${Date.now()}`, x: xMm, y: yMm, rotation: 0 }
    switch (editMode) {
      case 'finger-hole': return { ...base, radius: 15, shape: 'circle' as const }
      case 'circle': return { ...base, radius: 10, shape: 'circle' as const }
      case 'cylinder': return { ...base, radius: 10, shape: 'cylinder' as const }
      case 'square': return { ...base, radius: 10, shape: 'square' as const }
      case 'rectangle': return { ...base, radius: 15, width: 30, height: 20, shape: 'rectangle' as const }
      case 'filleted_rectangle': return { ...base, radius: 15, width: 30, height: 20, shape: 'filleted_rectangle' as const }
      default: return null
    }
  }

  // add a cutout, mirroring it across the axis when symmetric editing is on
  const commitCutout = (xMm: number, yMm: number) => {
    const cutout = createCutout(xMm, yMm)
    if (!cutout) return
    const axis = axisRef.current
    let updated: FingerHole[]
    if (mirrorModeRef.current && axis) {
      if (isHoleOnAxis(cutout, axis)) {
        updated = [...fingerHoles, { ...cutout, ...constrainToAxis({ x: xMm, y: yMm }, axis) }]
      } else {
        updated = [...fingerHoles, cutout, reflectHole(cutout, axis, newHoleId(cutout.id))]
      }
    } else {
      updated = [...fingerHoles, cutout]
    }
    pushHistory({ points, fingerHoles: updated, interiorRings: currentRings })
    onFingerHolesChange(updated)
  }

  // vertex interactions
  const handleVertexMouseDown = (pointIdx: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (editMode === 'delete-vertex') {
      if (mirrorModeRef.current && axisRef.current) {
        const updated = deleteMirroredVertex(points, pointIdx)
        if (!updated) return
        pushHistory({ points: updated, fingerHoles, interiorRings: currentRings })
        onPointsChange(updated)
        return
      }
      if (points.length <= 3) return
      const updated = [...points]
      updated.splice(pointIdx, 1)
      pushHistory({ points: updated, fingerHoles, interiorRings: currentRings })
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
    const axis = axisRef.current
    const updated = mirrorModeRef.current && axis
      ? insertMirroredVertex(points, edgeIdx, pos, axis)
      : (() => { const u = [...points]; u.splice(edgeIdx + 1, 0, pos); return u })()
    pushHistory({ points: updated, fingerHoles, interiorRings: currentRings })
    onPointsChange(updated)
  }

  // hole interactions
  const handleHoleMouseDown = (holeId: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (editMode !== 'select' && editMode !== 'fill-ring') {
      const pos = screenToMm(e.clientX, e.clientY)
      commitCutout(pos.x, pos.y)
      return
    }
    const hole = fingerHoles.find(fh => fh.id === holeId)
    if (!hole) return
    setSelection({ type: 'hole', holeId })
    const pos = screenToMm(e.clientX, e.clientY)
    const axis = axisRef.current
    const mirror = mirrorModeRef.current && axis ? findHolePartner(hole, fingerHoles, axis) : undefined
    const onAxis = !!(mirrorModeRef.current && axis && isHoleOnAxis(hole, axis))
    setDragging({ type: 'hole', holeId, startX: pos.x, startY: pos.y, origX: hole.x, origY: hole.y, mirrorId: mirror?.id, onAxis })
  }

  const handleResizeMouseDown = (holeId: string, cornerIndex?: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    const hole = fingerHoles.find(fh => fh.id === holeId)
    if (!hole) return
    const pos = screenToMm(e.clientX, e.clientY)
    // for rectangle corners, pin the opposite corner in world coords
    let anchorX: number | undefined, anchorY: number | undefined
    if (cornerIndex !== undefined && isRectangularCutout(hole.shape) && hole.width && hole.height) {
      const rot = (hole.rotation || 0) * Math.PI / 180
      const cosR = Math.cos(rot), sinR = Math.sin(rot)
      const hw = hole.width / 2, hh = hole.height / 2
      // local corner offsets: 0=TL(-hw,-hh) 1=TR(hw,-hh) 2=BR(hw,hh) 3=BL(-hw,hh)
      const opp = (cornerIndex + 2) % 4
      const lx = (opp === 0 || opp === 3) ? -hw : hw
      const ly = (opp < 2) ? -hh : hh
      anchorX = hole.x + lx * cosR - ly * sinR
      anchorY = hole.y + lx * sinR + ly * cosR
    }
    const axisR = axisRef.current
    const mirrorR = mirrorModeRef.current && axisR ? findHolePartner(hole, fingerHoles, axisR) : undefined
    setDragging({
      type: 'resize', holeId, startX: pos.x, startY: pos.y,
      origRadius: hole.radius, origWidth: hole.width, origHeight: hole.height,
      centerX: hole.x, centerY: hole.y,
      anchorX, anchorY, rotation: hole.rotation, mirrorId: mirrorR?.id,
    })
  }

  const handleHoleRotateMouseDown = (holeId: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    const hole = fingerHoles.find(fh => fh.id === holeId)
    if (!hole) return
    const pos = screenToMm(e.clientX, e.clientY)
    const startAngle = Math.atan2(pos.y - hole.y, pos.x - hole.x)
    const axisRo = axisRef.current
    const mirrorRo = mirrorModeRef.current && axisRo ? findHolePartner(hole, fingerHoles, axisRo) : undefined
    setDragging({ type: 'rotate-hole', holeId, centerX: hole.x, centerY: hole.y, startAngle, origRotation: hole.rotation || 0, mirrorId: mirrorRo?.id })
  }

  const handleBackgroundClick = (e: React.MouseEvent) => {
    if (didPanRef.current) {
      didPanRef.current = false
      return
    }
    if (editMode === 'finger-hole' || editMode === 'circle' || editMode === 'cylinder' || editMode === 'square' || editMode === 'rectangle' || editMode === 'filleted_rectangle') {
      const pos = screenToMm(e.clientX, e.clientY)
      commitCutout(snapToGrid(pos.x), snapToGrid(pos.y))
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

    const axis = axisRef.current
    const mirror = mirrorModeRef.current && axis

    if (dragging.type === 'vertex') {
      const updated = [...currentPoints]
      if (mirror && axis) {
        const n = updated.length
        const j = partnerIndex(dragging.pointIdx, n)
        let np = { x: snap(pos.x), y: snap(pos.y) }
        if (j === dragging.pointIdx) np = constrainToAxis(np, axis) // seam: stays on axis
        updated[dragging.pointIdx] = np
        if (j !== dragging.pointIdx) updated[j] = reflectPoint(np, axis)
      } else {
        updated[dragging.pointIdx] = { x: snap(pos.x), y: snap(pos.y) }
      }
      setDragPoints(updated)
    } else if (dragging.type === 'hole') {
      const dx = pos.x - dragging.startX
      const dy = pos.y - dragging.startY
      let nx = snap(dragging.origX + dx)
      let ny = snap(dragging.origY + dy)
      if (dragging.onAxis && axis) { const c = constrainToAxis({ x: nx, y: ny }, axis); nx = c.x; ny = c.y }
      const twin = mirror && axis && dragging.mirrorId ? reflectPoint({ x: nx, y: ny }, axis) : null
      const updated = currentHoles.map(fh => {
        if (fh.id === dragging.holeId) return { ...fh, x: nx, y: ny }
        if (twin && fh.id === dragging.mirrorId) return { ...fh, x: twin.x, y: twin.y }
        return fh
      })
      setDragHoles(updated)
    } else if (dragging.type === 'resize') {
      let resized: FingerHole | null = null
      let updated = currentHoles.map(fh => {
        if (fh.id !== dragging.holeId) return fh
        if (isRectangularCutout(fh.shape) && dragging.anchorX !== undefined && dragging.anchorY !== undefined) {
          const r = resizeRectCutout(dragging.anchorX, dragging.anchorY, pos.x, pos.y, dragging.rotation || 0)
          resized = { ...fh, x: snap(r.x), y: snap(r.y), width: r.width, height: r.height, radius: Math.max(r.width, r.height) / 2 }
          return resized
        }
        resized = { ...fh, radius: resizeRoundCutout(dragging.centerX, dragging.centerY, pos.x, pos.y) }
        return resized
      })
      if (mirror && axis && dragging.mirrorId && resized) {
        const r = resized as FingerHole
        const c = reflectPoint({ x: r.x, y: r.y }, axis)
        updated = updated.map(fh => fh.id === dragging.mirrorId
          ? { ...fh, x: c.x, y: c.y, radius: r.radius, width: r.width, height: r.height }
          : fh)
      }
      setDragHoles(updated)
    } else if (dragging.type === 'rotate-hole') {
      const currentAngle = Math.atan2(pos.y - dragging.centerY, pos.x - dragging.centerX)
      const deltaAngle = (currentAngle - dragging.startAngle) * (180 / Math.PI)
      const newRot = (dragging.origRotation + deltaAngle) % 360
      const mirrorRot = ((-newRot % 360) + 360) % 360
      const updated = currentHoles.map(fh => {
        if (fh.id === dragging.holeId) return { ...fh, rotation: newRot }
        if (mirror && fh.id === dragging.mirrorId) return { ...fh, rotation: mirrorRot }
        return fh
      })
      setDragHoles(updated)
    } else if (dragging.type === 'axis') {
      if (axis) setSymmetryAxis({ ...axis, pos: axis.orientation === 'vertical' ? pos.x : pos.y })
    } else if (dragging.type === 'rotate-polygon') {
      const currentAngle = Math.atan2(pos.y - dragging.centerY, pos.x - dragging.centerX)
      const delta = currentAngle - dragging.startAngle
      const cos = Math.cos(delta), sin = Math.sin(delta)
      const cx = dragging.centerX, cy = dragging.centerY
      const rotPt = (p: Point): Point => {
        const dx = p.x - cx, dy = p.y - cy
        return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
      }
      const newPts = dragging.origPoints.map(rotPt)
      const newHoles = dragging.origHoles.map(fh => {
        const dx = fh.x - cx, dy = fh.y - cy
        const origRot = fh.rotation || 0
        return { ...fh, x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos, rotation: (origRot + delta * 180 / Math.PI) % 360 }
      })
      setDragPoints(newPts)
      setDragHoles(newHoles)
      setDragRings(dragging.origRings.map(ring => ring.map(rotPt)))
      rotateDragRef.current = { delta, cx, cy }
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
      if (dragging.type === 'axis') {
        setDragging(null)
        const axis = axisRef.current
        if (axis) applySymmetrizeRef.current(axis, keepSideRef.current)
        return
      }
      const finalPoints = dragPointsRef.current ?? pointsRef.current
      const finalHoles = dragHolesRef.current ?? holesRef.current
      const finalRings = dragRingsRef.current ?? currentRingsRef.current
      if (dragPointsRef.current) onPointsRef.current(finalPoints)
      if (dragHolesRef.current) onHolesRef.current(finalHoles)
      if (dragRingsRef.current) onRingsRef.current?.(finalRings)
      // rotate-polygon drags carry the photo with them
      const m = imageTransformRef.current
      const rotDrag = dragging.type === 'rotate-polygon' ? rotateDragRef.current : null
      const nextTransform = m && rotDrag && rotDrag.delta !== 0
        ? rotateAround(m, rotDrag.delta, rotDrag.cx, rotDrag.cy)
        : m
      pushHistory({ points: finalPoints, fingerHoles: finalHoles, interiorRings: finalRings }, nextTransform)
      if (nextTransform && nextTransform !== m) {
        imageTransformRef.current = nextTransform
        onImageTransformRef.current?.(nextTransform)
      }
      rotateDragRef.current = null
      setDragPoints(null)
      setDragHoles(null)
      setDragRings(null)
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
    const target = fingerHoles.find(fh => fh.id === selection.holeId)
    const axis = axisRef.current
    const partner = mirrorModeRef.current && axis && target ? findHolePartner(target, fingerHoles, axis) : undefined
    const remove = new Set([selection.holeId, ...(partner ? [partner.id] : [])])
    const updated = fingerHoles.filter(fh => !remove.has(fh.id))
    pushHistory({ points, fingerHoles: updated, interiorRings: currentRings })
    onFingerHolesChange(updated)
    setSelection(null)
  }

  const handleAxisMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    setDragging({ type: 'axis' })
  }

  const selectedHole = selection?.type === 'hole'
    ? displayHoles.find(fh => fh.id === selection.holeId)
    : null

  const handleFillRing = useCallback((ringIndex: number) => {
    if (!onInteriorRingsChange) return
    const updated = currentRings.filter((_, i) => i !== ringIndex)
    pushHistory({ points, fingerHoles, interiorRings: updated })
    onInteriorRingsChange(updated)
  }, [currentRings, points, fingerHoles, pushHistory, onInteriorRingsChange])

  const isCutoutMode = editMode === 'finger-hole' || editMode === 'circle' || editMode === 'cylinder' || editMode === 'square' || editMode === 'rectangle' || editMode === 'filleted_rectangle'

  const cutoutModeIcon = editMode === 'finger-hole' ? <Fingerprint className="w-4.5 h-4.5" />
    : editMode === 'circle' ? <Circle className="w-4.5 h-4.5" />
    : editMode === 'cylinder' ? <Disc className="w-4.5 h-4.5" />
    : editMode === 'square' ? <Square className="w-4.5 h-4.5" />
    : editMode === 'rectangle' ? <RectangleHorizontal className="w-4.5 h-4.5" />
    : editMode === 'filleted_rectangle' ? <RectangleHorizontal className="w-4.5 h-4.5" />
    : <Plus className="w-4.5 h-4.5" />

  const cutoutModeLabel = editMode === 'finger-hole' ? 'Finger hole'
    : editMode === 'circle' ? 'Circle'
    : editMode === 'cylinder' ? 'Cylinder'
    : editMode === 'square' ? 'Square'
    : editMode === 'rectangle' ? 'Rectangle'
    : editMode === 'filleted_rectangle' ? 'Filleted'
    : 'Cutout'

  return (
    <div className="h-full w-full relative">
      {/* canvas fills entire area */}
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
        smoothed={previewSmoothed}
        interiorRings={displayRings}
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
        onRingClick={handleFillRing}
        sourceImageContext={sourceImageContext}
        showSourceImage={showSourceImage}
        sourceImageOpacity={sourceImageOpacity}
        symmetryAxis={mirrorMode ? symmetryAxis : null}
        onAxisMouseDown={handleAxisMouseDown}
      />

      {/* floating toolbar: centred in the free space to the right of the
          breadcrumb / projects panels (left-[330px]) so it never overlaps and
          intercepts their clicks. The band is click-through; only the panel
          itself catches pointer events. */}
      <div className="absolute top-3.5 left-[330px] right-3.5 z-20 flex justify-center pointer-events-none">
        <div className="glass-toolbar px-2 py-1 max-w-full pointer-events-auto">
        <ToolEditorToolbar
          editMode={editMode}
          setEditMode={setEditMode}
          previewSmoothed={previewSmoothed}
          setPreviewSmoothed={setPreviewSmoothed}
          outputSmoothed={smoothed}
          smoothLevel={smoothLevel}
          onOutputSmoothedChange={onSmoothedChange}
          onSmoothLevelChange={onSmoothLevelChange}
          snapEnabled={snapEnabled}
          setSnapEnabled={setSnapEnabled}
          snapGrid={snapGrid}
          setSnapGrid={setSnapGrid}
          mirrorMode={mirrorMode}
          toggleMirror={toggleMirror}
          axisOrientation={symmetryAxis?.orientation ?? 'vertical'}
          setAxisOrientation={setAxisOrientation}
          keepSide={keepSide}
          flipKeepSide={flipKeepSide}
          simplifyLevel={simplifyLevel}
          onSimplifyPreview={previewSimplify}
          onSimplifyCommit={commitSimplify}
          simplifyDisabled={mirrorMode}
          nodeCount={points.length}
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
          flipAll={flipAll}
          onAutoRotate={handleAutoRotateWrapped}
          autoRotating={autoRotating}
          hasInteriorRings={currentRings.length > 0}
        />
        </div>
      </div>

      {mirrorNote && (
        <div className={cn("absolute top-[58px] left-1/2 -translate-x-1/2 z-20 glass-toolbar px-3 py-1.5 text-[11px] max-w-[320px] text-center pointer-events-none", theme === 'dark' ? 'text-amber-300' : 'text-amber-600')}>
          {mirrorNote}
        </div>
      )}

      {/* floating properties panel: right edge, shown when hole selected */}
      {selectedHole && (
        <div className="absolute top-[70px] right-3.5 z-20 w-[200px] glass-toolbar px-3 py-2 text-[11px] text-text-secondary">
          <div className="font-medium text-text-primary text-[12px] mb-1">Selection</div>
          <div>
            {cutoutShapeLabel(selectedHole.shape)}
            {isRectangularCutout(selectedHole.shape) && selectedHole.width && selectedHole.height
              ? ` ${selectedHole.width.toFixed(0)}x${selectedHole.height.toFixed(0)}mm`
              : selectedHole.shape === 'square'
              ? ` ${(selectedHole.radius * 2).toFixed(0)}mm`
              : ` r=${selectedHole.radius.toFixed(1)}mm`
            }
          </div>
          {selectedHole.rotation ? <div>rotation: {selectedHole.rotation.toFixed(0)}deg</div> : null}
        </div>
      )}

      {/* floating info pill: bottom left */}
      <div className="absolute bottom-3.5 left-3.5 z-20 glass-toolbar px-3 py-1.5 text-[11px] text-text-secondary">
        {displayPoints.length} vertices{previewSmoothed ? ` (${points.length} raw)` : ''}, {displayHoles.length} cutout{displayHoles.length !== 1 ? 's' : ''}
        {' \u00b7 '}
        {((bounds.maxX - bounds.minX)).toFixed(1)}&times;{((bounds.maxY - bounds.minY)).toFixed(1)} mm
      </div>

      {/* floating zoom controls: bottom right */}
      <div className="absolute bottom-3.5 right-3.5 z-20 glass-toolbar px-1 py-0.5 flex items-center gap-0.5 text-[11px]">
        {sourceImageContext && (
          <>
            <button
              onClick={() => onShowSourceImageChange?.(!showSourceImage)}
              className={`p-1 rounded-[7px] transition-colors ${showSourceImage ? 'text-accent bg-accent-muted' : 'text-text-muted hover:text-text-secondary hover:bg-border/50'}`}
              title={showSourceImage ? 'Hide source photo' : 'Show source photo'}
            >
              {showSourceImage ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            </button>
            <ImageIcon className={`w-3.5 h-3.5 mx-0.5 ${showSourceImage ? 'text-text-secondary' : 'text-text-muted opacity-50'}`} />
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={sourceImageOpacity}
              disabled={!showSourceImage}
              onChange={e => onSourceImageOpacityChange?.(parseFloat(e.target.value))}
              className="w-16 h-1 accent-accent disabled:opacity-40"
              title={`Source photo opacity: ${Math.round(sourceImageOpacity * 100)}%`}
            />
            <div className="h-3.5 w-px bg-border-subtle mx-0.5" />
          </>
        )}
        <button
          onClick={() => setZoom(z => Math.max(0.5, z / ZOOM_FACTOR))}
          className="px-2 py-1 rounded-[7px] text-text-muted hover:text-text-primary hover:bg-border/50 transition-colors"
        >
          -
        </button>
        <span className="px-1.5 text-text-secondary min-w-[36px] text-center">{Math.round(zoom * 100)}%</span>
        <button
          onClick={() => setZoom(z => Math.min(20, z * ZOOM_FACTOR))}
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
  )
}
