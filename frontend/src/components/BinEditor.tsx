'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { MousePointer2, Trash2, Magnet, Type, Pencil, Maximize2 } from 'lucide-react'
import type { PlacedTool, TextLabel } from '@/types'
import { polygonPathData, smoothPathData, simplifyPolygon } from '@/lib/svg'

interface Props {
  placedTools: PlacedTool[]
  onPlacedToolsChange: (tools: PlacedTool[]) => void
  textLabels: TextLabel[]
  onTextLabelsChange: (labels: TextLabel[]) => void
  gridX: number
  gridY: number
  wallThickness: number
  onEditTool?: (toolId: string) => void
  smoothedToolIds?: Set<string>
  onToggleSmoothed?: (toolId: string, smoothed: boolean) => void
  smoothLevels?: Map<string, number>
  onSmoothLevelChange?: (toolId: string, level: number) => void
}

const GRID_UNIT = 42
const DISPLAY_SCALE = 8
const SNAP_GRID = 5

type Tool = 'select' | 'text'

type Selection =
  | { type: 'tool'; toolId: string }
  | { type: 'label'; labelId: string }
  | null

type DragState =
  | { type: 'tool'; toolId: string; startX: number; startY: number; origPoints: { x: number; y: number }[]; origHoles: { id: string; x: number; y: number }[]; origInteriorRings: { x: number; y: number }[][] }
  | { type: 'rotate'; toolId: string; centerX: number; centerY: number; startAngle: number; origRotation: number; origPoints: { x: number; y: number }[]; origHoles: { id: string; x: number; y: number }[]; origInteriorRings: { x: number; y: number }[][] }
  | { type: 'label'; labelId: string; startX: number; startY: number; origX: number; origY: number }
  | { type: 'rotate-label'; labelId: string; centerX: number; centerY: number; startAngle: number; origRotation: number }
  | null

export function BinEditor({
  placedTools,
  onPlacedToolsChange,
  textLabels,
  onTextLabelsChange,
  gridX,
  gridY,
  wallThickness,
  onEditTool,
  smoothedToolIds,
  onToggleSmoothed,
  smoothLevels,
  onSmoothLevelChange,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [activeTool, setActiveTool] = useState<Tool>('select')
  const [dragging, setDragging] = useState<DragState>(null)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [pendingLabel, setPendingLabel] = useState<{ x: number; y: number } | null>(null)
  const [pendingText, setPendingText] = useState('')
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const pendingInputRef = useRef<HTMLInputElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  const toolsRef = useRef(placedTools)
  const onChangeRef = useRef(onPlacedToolsChange)
  const textLabelsRef = useRef(textLabels)
  const onTextLabelsChangeRef = useRef(onTextLabelsChange)
  useEffect(() => { toolsRef.current = placedTools }, [placedTools])
  useEffect(() => { onChangeRef.current = onPlacedToolsChange }, [onPlacedToolsChange])
  useEffect(() => { textLabelsRef.current = textLabels }, [textLabels])
  useEffect(() => { onTextLabelsChangeRef.current = onTextLabelsChange }, [onTextLabelsChange])

  const binWidthMm = gridX * GRID_UNIT
  const binHeightMm = gridY * GRID_UNIT
  const displayWidth = binWidthMm * DISPLAY_SCALE
  const displayHeight = binHeightMm * DISPLAY_SCALE

  // handle sizes: scale gently with bin size but stay bounded
  const viewBoxShort = Math.min(displayWidth, displayHeight) + 30
  const handleR = Math.max(14, Math.min(28, viewBoxShort * 0.04))
  const handleOffset = handleR * 2.5
  const handleStroke = Math.max(1.5, handleR * 0.1)

  const getAllBounds = useCallback(() => {
    if (placedTools.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const tool of placedTools) {
      for (const p of tool.points) {
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }
    }
    return { minX, minY, maxX, maxY }
  }, [placedTools])

  const handleRecenter = useCallback(() => {
    const bounds = getAllBounds()
    const targetCenterX = binWidthMm / 2
    const targetCenterY = binHeightMm / 2
    const currentCenterX = (bounds.minX + bounds.maxX) / 2
    const currentCenterY = (bounds.minY + bounds.maxY) / 2
    const dx = targetCenterX - currentCenterX
    const dy = targetCenterY - currentCenterY

    const updated = placedTools.map(tool => ({
      ...tool,
      points: tool.points.map(p => ({ x: p.x + dx, y: p.y + dy })),
      finger_holes: tool.finger_holes.map(fh => ({ ...fh, x: fh.x + dx, y: fh.y + dy })),
      interior_rings: (tool.interior_rings ?? []).map(ring =>
        ring.map(p => ({ x: p.x + dx, y: p.y + dy }))
      ),
    }))
    onPlacedToolsChange(updated)
  }, [getAllBounds, binWidthMm, binHeightMm, placedTools, onPlacedToolsChange])

  const screenToMm = useCallback((clientX: number, clientY: number) => {
    if (!svgRef.current) return { x: 0, y: 0 }
    const rect = svgRef.current.getBoundingClientRect()
    const viewBoxWidth = displayWidth + 70
    const viewBoxHeight = displayHeight + 30
    const scaleX = viewBoxWidth / rect.width
    const scaleY = viewBoxHeight / rect.height
    const scale = Math.max(scaleX, scaleY)
    const offsetX = (rect.width * scale - viewBoxWidth) / 2
    const offsetY = (rect.height * scale - viewBoxHeight) / 2
    const svgX = (clientX - rect.left) * scale - offsetX - 10
    const svgY = (clientY - rect.top) * scale - offsetY - 10
    return { x: svgX / DISPLAY_SCALE, y: svgY / DISPLAY_SCALE }
  }, [displayWidth, displayHeight])

  const snapToGrid = useCallback((v: number) => {
    if (!snapEnabled) return v
    return Math.round(v / SNAP_GRID) * SNAP_GRID
  }, [snapEnabled])

  const handleToolMouseDown = (toolId: string) => (e: React.MouseEvent) => {
    if (activeTool === 'text') return
    e.stopPropagation()
    const tool = placedTools.find(t => t.id === toolId)
    if (!tool) return

    setSelection({ type: 'tool', toolId })
    const pos = screenToMm(e.clientX, e.clientY)
    setDragging({
      type: 'tool',
      toolId,
      startX: pos.x,
      startY: pos.y,
      origPoints: tool.points.map(p => ({ x: p.x, y: p.y })),
      origHoles: tool.finger_holes.map(fh => ({ id: fh.id, x: fh.x, y: fh.y })),
      origInteriorRings: (tool.interior_rings ?? []).map(ring => ring.map(p => ({ x: p.x, y: p.y }))),
    })
  }

  const stopClick = (e: React.MouseEvent) => e.stopPropagation()
  const stopClickUnlessText = (e: React.MouseEvent) => { if (activeTool !== 'text') e.stopPropagation() }

  const handleRotateMouseDown = (toolId: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    const tool = placedTools.find(t => t.id === toolId)
    if (!tool) return

    const pos = screenToMm(e.clientX, e.clientY)
    const centerX = tool.points.reduce((sum, p) => sum + p.x, 0) / tool.points.length
    const centerY = tool.points.reduce((sum, p) => sum + p.y, 0) / tool.points.length
    const startAngle = Math.atan2(pos.y - centerY, pos.x - centerX)

    setDragging({
      type: 'rotate', toolId,
      centerX, centerY, startAngle,
      origRotation: tool.rotation || 0,
      origPoints: tool.points.map(p => ({ x: p.x, y: p.y })),
      origHoles: tool.finger_holes.map(fh => ({ id: fh.id, x: fh.x, y: fh.y })),
      origInteriorRings: (tool.interior_rings ?? []).map(ring => ring.map(p => ({ x: p.x, y: p.y }))),
    })
  }

  const handleLabelMouseDown = (labelId: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    const label = textLabels.find(l => l.id === labelId)
    if (!label) return

    setSelection({ type: 'label', labelId })
    const pos = screenToMm(e.clientX, e.clientY)
    setDragging({
      type: 'label', labelId,
      startX: pos.x, startY: pos.y,
      origX: label.x, origY: label.y,
    })
  }

  const handleLabelRotateMouseDown = (labelId: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    const label = textLabels.find(l => l.id === labelId)
    if (!label) return

    const pos = screenToMm(e.clientX, e.clientY)
    const startAngle = Math.atan2(pos.y - label.y, pos.x - label.x)
    setDragging({
      type: 'rotate-label', labelId,
      centerX: label.x, centerY: label.y,
      startAngle, origRotation: label.rotation,
    })
  }

  const handleLabelDoubleClick = (labelId: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    const label = textLabels.find(l => l.id === labelId)
    if (!label) return
    setEditingLabelId(labelId)
    setEditingText(label.text)
    setSelection({ type: 'label', labelId })
  }

  const commitEditingLabel = useCallback(() => {
    if (!editingLabelId) return
    const trimmed = editingText.trim()
    if (trimmed) {
      onTextLabelsChange(textLabels.map(l =>
        l.id === editingLabelId ? { ...l, text: trimmed } : l
      ))
    } else {
      // empty text = delete the label
      onTextLabelsChange(textLabels.filter(l => l.id !== editingLabelId))
      setSelection(null)
    }
    setEditingLabelId(null)
    setEditingText('')
  }, [editingLabelId, editingText, textLabels, onTextLabelsChange])

  useEffect(() => {
    if (editingLabelId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingLabelId])

  // ray-casting point-in-polygon
  const pointInRing = useCallback((px: number, py: number, ring: { x: number; y: number }[]) => {
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i].x, yi = ring[i].y
      const xj = ring[j].x, yj = ring[j].y
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
        inside = !inside
      }
    }
    return inside
  }, [])

  // true if point is inside a tool cutout (outer polygon minus interior rings)
  const isInsideCutout = useCallback((px: number, py: number) => {
    for (const tool of toolsRef.current) {
      if (!pointInRing(px, py, tool.points)) continue
      // inside outer polygon; check if rescued by an interior ring (raised island)
      let inIsland = false
      for (const ring of (tool.interior_rings ?? [])) {
        if (pointInRing(px, py, ring)) { inIsland = true; break }
      }
      if (!inIsland) return true
    }
    return false
  }, [pointInRing])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging) return
    const pos = screenToMm(e.clientX, e.clientY)
    const currentTools = toolsRef.current
    const onChange = onChangeRef.current
    const currentLabels = textLabelsRef.current
    const onLabelsChange = onTextLabelsChangeRef.current

    if (dragging.type === 'tool') {
      const origCenterX = dragging.origPoints.reduce((sum, p) => sum + p.x, 0) / dragging.origPoints.length
      const origCenterY = dragging.origPoints.reduce((sum, p) => sum + p.y, 0) / dragging.origPoints.length
      const rawDx = pos.x - dragging.startX
      const rawDy = pos.y - dragging.startY
      const newCenterX = snapToGrid(origCenterX + rawDx)
      const newCenterY = snapToGrid(origCenterY + rawDy)
      const dx = newCenterX - origCenterX
      const dy = newCenterY - origCenterY
      const updated = currentTools.map(tool => {
        if (tool.id !== dragging.toolId) return tool
        return {
          ...tool,
          points: dragging.origPoints.map(p => ({ x: p.x + dx, y: p.y + dy })),
          finger_holes: tool.finger_holes.map(fh => {
            const orig = dragging.origHoles.find(h => h.id === fh.id)
            if (!orig) return fh
            return { ...fh, x: orig.x + dx, y: orig.y + dy }
          }),
          interior_rings: dragging.origInteriorRings.map(ring =>
            ring.map(p => ({ x: p.x + dx, y: p.y + dy }))
          ),
        }
      })
      onChange(updated)
    } else if (dragging.type === 'rotate') {
      const currentAngle = Math.atan2(pos.y - dragging.centerY, pos.x - dragging.centerX)
      const deltaAngle = currentAngle - dragging.startAngle
      const cos = Math.cos(deltaAngle)
      const sin = Math.sin(deltaAngle)
      const cx = dragging.centerX
      const cy = dragging.centerY

      const deltaDeg = deltaAngle * (180 / Math.PI)
      const updated = currentTools.map(tool => {
        if (tool.id !== dragging.toolId) return tool
        return {
          ...tool,
          rotation: (dragging.origRotation + deltaDeg) % 360,
          points: dragging.origPoints.map(p => {
            const pdx = p.x - cx
            const pdy = p.y - cy
            return { x: cx + pdx * cos - pdy * sin, y: cy + pdx * sin + pdy * cos }
          }),
          finger_holes: tool.finger_holes.map(fh => {
            const orig = dragging.origHoles.find(h => h.id === fh.id)
            if (!orig) return fh
            const fdx = orig.x - cx
            const fdy = orig.y - cy
            return { ...fh, x: cx + fdx * cos - fdy * sin, y: cy + fdx * sin + fdy * cos }
          }),
          interior_rings: dragging.origInteriorRings.map(ring =>
            ring.map(p => {
              const pdx = p.x - cx
              const pdy = p.y - cy
              return { x: cx + pdx * cos - pdy * sin, y: cy + pdx * sin + pdy * cos }
            })
          ),
        }
      })
      onChange(updated)
    } else if (dragging.type === 'label') {
      const dx = pos.x - dragging.startX
      const dy = pos.y - dragging.startY
      const newX = snapToGrid(dragging.origX + dx)
      const newY = snapToGrid(dragging.origY + dy)
      if (isInsideCutout(newX, newY)) return
      const updated = currentLabels.map(l => {
        if (l.id !== dragging.labelId) return l
        return { ...l, x: newX, y: newY }
      })
      onLabelsChange(updated)
    } else if (dragging.type === 'rotate-label') {
      const currentAngle = Math.atan2(pos.y - dragging.centerY, pos.x - dragging.centerX)
      const deltaAngle = (currentAngle - dragging.startAngle) * (180 / Math.PI)
      const updated = currentLabels.map(l => {
        if (l.id !== dragging.labelId) return l
        return { ...l, rotation: (dragging.origRotation + deltaAngle) % 360 }
      })
      onLabelsChange(updated)
    }
  }, [dragging, screenToMm, snapToGrid, isInsideCutout])

  const handleMouseUp = useCallback(() => {
    setDragging(null)
  }, [])

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

  const handleDeleteTool = () => {
    if (selection?.type !== 'tool') return
    onPlacedToolsChange(placedTools.filter(t => t.id !== selection.toolId))
    setSelection(null)
  }

  const handleDeleteLabel = () => {
    if (selection?.type !== 'label') return
    onTextLabelsChange(textLabels.filter(l => l.id !== selection.labelId))
    setSelection(null)
  }

  const commitPendingLabel = useCallback(() => {
    if (!pendingLabel || !pendingText.trim()) {
      setPendingLabel(null)
      setPendingText('')
      return
    }
    const newLabel: TextLabel = {
      id: `tl-${Date.now()}`,
      text: pendingText.trim(),
      x: pendingLabel.x,
      y: pendingLabel.y,
      font_size: 5,
      rotation: 0,
      emboss: true,
      depth: 0.5,
    }
    onTextLabelsChange([...textLabels, newLabel])
    setSelection({ type: 'label', labelId: newLabel.id })
    setPendingLabel(null)
    setPendingText('')
  }, [pendingLabel, pendingText, textLabels, onTextLabelsChange])

  const handleBackgroundClick = (e: React.MouseEvent) => {
    if (activeTool === 'text') {
      if (pendingLabel) {
        commitPendingLabel()
        return
      }
      const pos = screenToMm(e.clientX, e.clientY)
      if (pos.x >= 0 && pos.x <= binWidthMm && pos.y >= 0 && pos.y <= binHeightMm && !isInsideCutout(pos.x, pos.y)) {
        setPendingLabel({ x: snapToGrid(pos.x), y: snapToGrid(pos.y) })
        setPendingText('')
      }
      return
    }

    setSelection(null)
  }

  useEffect(() => {
    if (pendingLabel && pendingInputRef.current) {
      pendingInputRef.current.focus()
    }
  }, [pendingLabel])

  const selectedLabel = selection?.type === 'label'
    ? textLabels.find(l => l.id === selection.labelId)
    : null

  const selectedTool = selection?.type === 'tool'
    ? placedTools.find(t => t.id === selection.toolId)
    : null

  const updateSelectedLabel = (updates: Partial<TextLabel>) => {
    if (selection?.type !== 'label') return
    onTextLabelsChange(textLabels.map(l => {
      if (l.id !== selection.labelId) return l
      return { ...l, ...updates }
    }))
  }

  return (
    <div className="h-full flex flex-col gap-3">
      {/* toolbar */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {/* mode selector */}
        <div className="flex bg-elevated rounded-lg p-0.5 border border-border">
          <button
            onClick={() => setActiveTool('select')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${
              activeTool === 'select' ? 'bg-accent-muted text-accent' : 'hover:bg-border/50 text-text-secondary'
            }`}
            title="Select & move tools"
          >
            <MousePointer2 className="w-4 h-4" />
            Select
          </button>
          <button
            onClick={() => setActiveTool('text')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${
              activeTool === 'text' ? 'bg-accent-muted text-accent' : 'hover:bg-border/50 text-text-secondary'
            }`}
            title="Place text label"
          >
            <Type className="w-4 h-4" />
            Text
          </button>
        </div>

        {/* utility */}
        <div className="flex items-center gap-1 text-text-muted">
          <button
            onClick={() => setSnapEnabled(!snapEnabled)}
            className={`px-2 py-1.5 rounded text-xs flex items-center gap-1 transition-colors ${
              snapEnabled ? 'text-accent' : 'hover:bg-border/50 hover:text-text-secondary'
            }`}
            title={`Snap to ${SNAP_GRID}mm grid${snapEnabled ? ' (on)' : ' (off)'}`}
          >
            <Magnet className="w-3.5 h-3.5" />
            Snap
          </button>
          <button
            onClick={handleRecenter}
            className="px-2 py-1.5 rounded text-xs flex items-center gap-1 hover:bg-border/50 hover:text-text-secondary transition-colors"
            title="Recenter view"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            Recenter
          </button>
        </div>

        {selection?.type === 'tool' && selectedTool && (
          <div className="ml-auto flex items-center gap-2">
            {onToggleSmoothed && (
              <div className="flex items-center bg-elevated rounded overflow-hidden border border-border-subtle text-xs">
                <button
                  onClick={() => onToggleSmoothed(selectedTool.tool_id, false)}
                  className={`px-2 py-1 transition-colors ${!smoothedToolIds?.has(selectedTool.tool_id) ? 'bg-accent text-white' : 'text-text-muted hover:text-text-secondary'}`}
                >
                  Accurate
                </button>
                <button
                  onClick={() => onToggleSmoothed(selectedTool.tool_id, true)}
                  className={`px-2 py-1 transition-colors ${smoothedToolIds?.has(selectedTool.tool_id) ? 'bg-accent text-white' : 'text-text-muted hover:text-text-secondary'}`}
                >
                  Smooth
                </button>
              </div>
            )}
            {smoothedToolIds?.has(selectedTool.tool_id) && onSmoothLevelChange && (
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={smoothLevels?.get(selectedTool.tool_id) ?? 0.5}
                onChange={e => onSmoothLevelChange(selectedTool.tool_id, parseFloat(e.target.value))}
                className="w-20 h-1 accent-accent"
                title={`Smooth level: ${Math.round((smoothLevels?.get(selectedTool.tool_id) ?? 0.5) * 100)}%`}
              />
            )}
            {onEditTool && (
              <button
                onClick={() => onEditTool(selectedTool.tool_id)}
                className="px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-muted rounded-lg border border-accent/30 flex items-center gap-1"
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit Tool
              </button>
            )}
            <button
              onClick={handleDeleteTool}
              className="px-3 py-1.5 text-xs font-medium text-white bg-red-700 hover:bg-red-600 rounded-lg flex items-center gap-1 shadow-sm"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Remove
            </button>
          </div>
        )}
        {selection?.type === 'label' && (
          <button
            onClick={handleDeleteLabel}
            className="ml-auto px-3 py-1.5 text-xs font-medium text-white bg-red-700 hover:bg-red-600 rounded-lg flex items-center gap-1 shadow-sm"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        )}
      </div>

      {selectedLabel && (
        <div className="text-sm text-text-secondary bg-elevated rounded border border-border px-3 py-2 flex-shrink-0 flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1">
            Text
            <input
              type="text"
              value={selectedLabel.text}
              onChange={e => updateSelectedLabel({ text: e.target.value })}
              className="w-28 px-1 py-0.5 border border-border-subtle rounded bg-surface text-text-primary"
            />
          </label>
          <label className="flex items-center gap-1">
            Size
            <input
              type="number"
              value={selectedLabel.font_size}
              onChange={e => updateSelectedLabel({ font_size: Math.max(1, Math.min(50, parseFloat(e.target.value) || 1)) })}
              className="w-14 px-1 py-0.5 border border-border-subtle rounded bg-surface text-text-primary"
              min={1} max={50} step={0.5}
            />
            mm
          </label>
          <label className="flex items-center gap-1">
            Depth
            <input
              type="number"
              value={selectedLabel.depth}
              onChange={e => updateSelectedLabel({ depth: Math.max(0.1, Math.min(5, parseFloat(e.target.value) || 0.1)) })}
              className="w-14 px-1 py-0.5 border border-border-subtle rounded bg-surface text-text-primary"
              min={0.1} max={5} step={0.1}
            />
            mm
          </label>
          <button
            onClick={() => updateSelectedLabel({ emboss: !selectedLabel.emboss })}
            className={`px-2 py-0.5 rounded border text-xs font-medium ${
              selectedLabel.emboss
                ? 'bg-teal-900/30 border-teal-700 text-teal-400'
                : 'bg-orange-900/30 border-orange-700 text-orange-400'
            }`}
          >
            {selectedLabel.emboss ? 'Embossed' : 'Recessed'}
          </button>
        </div>
      )}

      {/* SVG area */}
      <div className="flex-1 min-h-0 bg-inset rounded-lg p-4 flex items-center justify-center">
        <svg
          ref={svgRef}
          viewBox={`-10 -10 ${displayWidth + 70} ${displayHeight + 30}`}
          preserveAspectRatio="xMidYMid meet"
          className={`rounded max-w-full max-h-full ${activeTool === 'select' ? 'cursor-default' : 'cursor-crosshair'}`}
          style={{ overflow: 'visible' }}
          onClick={handleBackgroundClick}
        >
          <rect x="0" y="0" width={displayWidth} height={displayHeight} fill="rgb(30, 41, 59)" rx="4" />
          {Array.from({ length: gridX + 1 }).map((_, i) => (
            <line
              key={`v${i}`}
              x1={i * GRID_UNIT * DISPLAY_SCALE} y1={0}
              x2={i * GRID_UNIT * DISPLAY_SCALE} y2={displayHeight}
              stroke="rgba(255,255,255,0.1)" strokeWidth={1}
              strokeDasharray={i === 0 || i === gridX ? undefined : '4,4'}
            />
          ))}
          {Array.from({ length: gridY + 1 }).map((_, i) => (
            <line
              key={`h${i}`}
              x1={0} y1={i * GRID_UNIT * DISPLAY_SCALE}
              x2={displayWidth} y2={i * GRID_UNIT * DISPLAY_SCALE}
              stroke="rgba(255,255,255,0.1)" strokeWidth={1}
              strokeDasharray={i === 0 || i === gridY ? undefined : '4,4'}
            />
          ))}

          {/* wall inset boundary */}
          {(() => {
            const inset = (wallThickness + 0.25) * DISPLAY_SCALE
            return (
              <rect
                x={inset} y={inset}
                width={displayWidth - 2 * inset} height={displayHeight - 2 * inset}
                fill="none" stroke="rgba(255,255,255,0.15)"
                strokeWidth={1} strokeDasharray="6,4"
              />
            )
          })()}

          {placedTools.map(tool => {
            let pathData: string
            if (smoothedToolIds?.has(tool.tool_id)) {
              let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity
              for (const p of tool.points) { mnX = Math.min(mnX, p.x); mnY = Math.min(mnY, p.y); mxX = Math.max(mxX, p.x); mxY = Math.max(mxY, p.y) }
              const level = smoothLevels?.get(tool.tool_id) ?? 0.5
              const factor = 0.002 + level * (0.008 - 0.002)
              const eps = Math.max(0.3, Math.hypot(mxX - mnX, mxY - mnY) * factor)
              pathData = smoothPathData(simplifyPolygon(tool.points, eps), tool.interior_rings, DISPLAY_SCALE)
            } else {
              pathData = polygonPathData(tool.points, tool.interior_rings, DISPLAY_SCALE)
            }
            const isSelected = selection?.type === 'tool' && selection.toolId === tool.id

            return (
              <g key={tool.id} onClick={stopClickUnlessText}>
                <path
                  d={pathData}
                  fillRule="evenodd"
                  fill={isSelected ? 'rgb(51, 65, 85)' : 'rgb(71, 85, 105)'}
                  stroke={isSelected ? 'rgb(148, 163, 184)' : 'rgb(100, 116, 139)'}
                  strokeWidth={handleStroke}
                  className={activeTool === 'text' ? 'cursor-crosshair' : 'cursor-move'}
                  onMouseDown={handleToolMouseDown(tool.id)}
                  onClick={stopClickUnlessText}
                />

                {/* read-only cutout display */}
                {tool.finger_holes.map(fh => {
                  const x = fh.x * DISPLAY_SCALE
                  const y = fh.y * DISPLAY_SCALE
                  const r = fh.radius * DISPLAY_SCALE
                  const shape = fh.shape || 'circle'
                  const rotation = fh.rotation || 0
                  const w = shape === 'rectangle' && fh.width ? fh.width * DISPLAY_SCALE : r * 2
                  const h = shape === 'rectangle' && fh.height ? fh.height * DISPLAY_SCALE : r * 2

                  return (
                    <g key={fh.id} transform={rotation !== 0 ? `rotate(${rotation} ${x} ${y})` : undefined}>
                      {shape === 'circle' && (
                        <circle
                          cx={x} cy={y} r={r}
                          fill="rgb(51, 65, 85)" stroke="rgb(30, 41, 59)" strokeWidth={1}
                          className="pointer-events-none"
                        />
                      )}
                      {(shape === 'square' || shape === 'rectangle') && (
                        <rect
                          x={x - w / 2} y={y - h / 2} width={w} height={h}
                          fill="rgb(51, 65, 85)" stroke="rgb(30, 41, 59)" strokeWidth={1}
                          className="pointer-events-none"
                        />
                      )}
                    </g>
                  )
                })}
              </g>
            )
          })}

          {/* text labels */}
          {textLabels.map(label => {
            const x = label.x * DISPLAY_SCALE
            const y = label.y * DISPLAY_SCALE
            const fontSize = label.font_size * DISPLAY_SCALE
            const isSelected = selection?.type === 'label' && selection.labelId === label.id
            const isEditing = editingLabelId === label.id
            // expanded hit area: at least handleR*2 tall, and wider than text
            const hitH = Math.max(fontSize * 1.4, handleR * 2)
            const hitW = Math.max(fontSize * label.text.length * 0.7, handleR * 4)

            return (
              <g key={label.id} transform={label.rotation !== 0 ? `rotate(${label.rotation} ${x} ${y})` : undefined}>
                {/* invisible expanded hit area */}
                <rect
                  x={x - hitW / 2} y={y - hitH / 2}
                  width={hitW} height={hitH}
                  fill="transparent"
                  className="cursor-move"
                  onMouseDown={handleLabelMouseDown(label.id)}
                  onDoubleClick={handleLabelDoubleClick(label.id)}
                  onClick={stopClick}
                />
                {!isEditing && (
                  <text
                    x={x} y={y}
                    textAnchor="middle" dominantBaseline="central"
                    fill={isSelected ? 'rgb(13, 148, 136)' : 'rgb(20, 184, 166)'}
                    stroke={isSelected ? 'rgb(13, 148, 136)' : 'none'}
                    strokeWidth={isSelected ? 0.5 : 0}
                    fontSize={fontSize} fontWeight="600" fontFamily="Arial, sans-serif"
                    className="pointer-events-none"
                  >
                    {label.text}
                  </text>
                )}
              </g>
            )
          })}

          {/* selection handles: bounding box with corner rotation zones */}
          {selection?.type === 'tool' && (() => {
            const tool = placedTools.find(t => t.id === selection.toolId)
            if (!tool) return null
            const pad = handleR * 0.4
            let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity
            for (const p of tool.points) {
              bMinX = Math.min(bMinX, p.x); bMinY = Math.min(bMinY, p.y)
              bMaxX = Math.max(bMaxX, p.x); bMaxY = Math.max(bMaxY, p.y)
            }
            const dMinX = bMinX * DISPLAY_SCALE - pad
            const dMinY = bMinY * DISPLAY_SCALE - pad
            const dMaxX = bMaxX * DISPLAY_SCALE + pad
            const dMaxY = bMaxY * DISPLAY_SCALE + pad
            const cornerSize = handleR * 2
            const cornerLen = handleR * 0.7
            const corners = [
              { x: dMinX, y: dMinY },
              { x: dMaxX, y: dMinY },
              { x: dMaxX, y: dMaxY },
              { x: dMinX, y: dMaxY },
            ]
            return (
              <g>
                <rect
                  x={dMinX} y={dMinY}
                  width={dMaxX - dMinX} height={dMaxY - dMinY}
                  fill="none" stroke="rgba(90, 180, 222, 0.3)" strokeWidth={handleStroke}
                  strokeDasharray={`${handleR * 0.4},${handleR * 0.25}`}
                  className="pointer-events-none"
                />
                {corners.map((c, i) => {
                  const dx = i === 0 || i === 3 ? 1 : -1
                  const dy = i < 2 ? 1 : -1
                  const arcR = cornerLen
                  return (
                    <g key={i}>
                      <path
                        d={`M${c.x},${c.y + dy * arcR} A${arcR},${arcR} 0 0 ${dy * dx > 0 ? 1 : 0} ${c.x + dx * arcR},${c.y}`}
                        fill="none" stroke="rgba(90, 180, 222, 0.5)" strokeWidth={handleStroke}
                        className="pointer-events-none"
                      />
                      <rect
                        x={c.x - cornerSize / 2} y={c.y - cornerSize / 2}
                        width={cornerSize} height={cornerSize}
                        fill="transparent"
                        className="cursor-rotate"
                        onMouseDown={handleRotateMouseDown(tool.id)}
                        onClick={stopClick}
                      />
                    </g>
                  )
                })}
              </g>
            )
          })()}
          {selection?.type === 'label' && !editingLabelId && (() => {
            const label = textLabels.find(l => l.id === selection.labelId)
            if (!label) return null
            const x = label.x * DISPLAY_SCALE
            const y = label.y * DISPLAY_SCALE
            const fontSize = label.font_size * DISPLAY_SCALE
            const hitH = Math.max(fontSize * 1.4, handleR * 2)
            const hitW = Math.max(fontSize * label.text.length * 0.7, handleR * 4)
            const pad = handleR * 0.3
            const bMinX = x - hitW / 2 - pad
            const bMinY = y - hitH / 2 - pad
            const bMaxX = x + hitW / 2 + pad
            const bMaxY = y + hitH / 2 + pad
            const cornerSize = handleR * 2
            const cornerLen = handleR * 0.7
            const corners = [
              { x: bMinX, y: bMinY },
              { x: bMaxX, y: bMinY },
              { x: bMaxX, y: bMaxY },
              { x: bMinX, y: bMaxY },
            ]
            return (
              <g transform={label.rotation !== 0 ? `rotate(${label.rotation} ${x} ${y})` : undefined}>
                <rect
                  x={bMinX} y={bMinY}
                  width={bMaxX - bMinX} height={bMaxY - bMinY}
                  fill="none" stroke="rgba(13, 148, 136, 0.4)" strokeWidth={handleStroke}
                  strokeDasharray={`${handleR * 0.4},${handleR * 0.25}`}
                  className="pointer-events-none"
                />
                {corners.map((c, i) => {
                  const dx = i === 0 || i === 3 ? 1 : -1
                  const dy = i < 2 ? 1 : -1
                  const arcR = cornerLen
                  return (
                    <g key={i}>
                      <path
                        d={`M${c.x},${c.y + dy * arcR} A${arcR},${arcR} 0 0 ${dy * dx > 0 ? 1 : 0} ${c.x + dx * arcR},${c.y}`}
                        fill="none" stroke="rgba(13, 148, 136, 0.5)" strokeWidth={handleStroke}
                        className="pointer-events-none"
                      />
                      <rect
                        x={c.x - cornerSize / 2} y={c.y - cornerSize / 2}
                        width={cornerSize} height={cornerSize}
                        fill="transparent"
                        className="cursor-rotate"
                        onMouseDown={handleLabelRotateMouseDown(label.id)}
                        onClick={stopClick}
                      />
                    </g>
                  )
                })}
              </g>
            )
          })()}

          {editingLabelId && (() => {
            const label = textLabels.find(l => l.id === editingLabelId)
            if (!label) return null
            const x = label.x * DISPLAY_SCALE
            const y = label.y * DISPLAY_SCALE
            return (
              <foreignObject
                x={x - 120} y={y - 20}
                width={240} height={40}
                transform={label.rotation !== 0 ? `rotate(${label.rotation} ${x} ${y})` : undefined}
              >
                <input
                  ref={editInputRef}
                  type="text"
                  value={editingText}
                  onChange={e => setEditingText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitEditingLabel()
                    if (e.key === 'Escape') { setEditingLabelId(null); setEditingText('') }
                  }}
                  onBlur={commitEditingLabel}
                  onClick={stopClick}
                  className="w-full bg-elevated border-2 border-teal-500 rounded text-text-primary outline-none"
                  style={{ fontSize: '20px', padding: '4px 8px', height: '100%', boxSizing: 'border-box', textAlign: 'center' }}
                />
              </foreignObject>
            )
          })()}

          {pendingLabel && (
            <foreignObject
              x={pendingLabel.x * DISPLAY_SCALE - 120}
              y={pendingLabel.y * DISPLAY_SCALE - 20}
              width={240} height={40}
            >
              <input
                ref={pendingInputRef}
                type="text"
                value={pendingText}
                onChange={e => setPendingText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitPendingLabel()
                  if (e.key === 'Escape') { setPendingLabel(null); setPendingText('') }
                }}
                onBlur={commitPendingLabel}
                onClick={stopClick}
                placeholder="Label text..."
                className="w-full bg-elevated border-2 border-teal-500 rounded text-text-primary outline-none"
                style={{ fontSize: '20px', padding: '4px 8px', height: '100%', boxSizing: 'border-box' }}
              />
            </foreignObject>
          )}
        </svg>
      </div>

      {/* bottom bar */}
      <div className="flex items-center justify-between text-xs flex-shrink-0">
        <span className="text-text-muted">{gridX}x{gridY} Grid ({binWidthMm}x{binHeightMm}mm)</span>
        <span className="text-text-muted">
          {activeTool === 'select' && 'Drag to move, double-click text to edit'}
          {activeTool === 'text' && 'Click to place, double-click to edit'}
        </span>
        <span />
      </div>
    </div>
  )
}
