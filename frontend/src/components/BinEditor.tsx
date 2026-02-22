'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import type { PlacedTool, TextLabel } from '@/types'
import { snapToGrid as snapToGridUtil } from '@/lib/svg'
import { GRID_UNIT, DISPLAY_SCALE, SNAP_GRID } from '@/lib/constants'
import { BinEditorToolbar } from '@/components/BinEditorToolbar'
import { BinEditorCanvas } from '@/components/BinEditorCanvas'

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
    return snapToGridUtil(v, SNAP_GRID)
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

  const isInsideCutout = useCallback((px: number, py: number) => {
    for (const tool of toolsRef.current) {
      if (!pointInRing(px, py, tool.points)) continue
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

  const handleEditingLabelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitEditingLabel()
    if (e.key === 'Escape') { setEditingLabelId(null); setEditingText('') }
  }

  const handlePendingLabelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitPendingLabel()
    if (e.key === 'Escape') { setPendingLabel(null); setPendingText('') }
  }

  return (
    <div className="h-full flex flex-col gap-3">
      <BinEditorToolbar
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        snapEnabled={snapEnabled}
        setSnapEnabled={setSnapEnabled}
        handleRecenter={handleRecenter}
        selectedTool={selectedTool ?? null}
        selectedLabel={selectedLabel ?? null}
        onEditTool={onEditTool}
        onRemoveTool={handleDeleteTool}
        onRemoveLabel={handleDeleteLabel}
        smoothedToolIds={smoothedToolIds}
        smoothLevels={smoothLevels}
        onToggleSmoothed={onToggleSmoothed}
        onSmoothLevelChange={onSmoothLevelChange}
        onUpdateLabel={updateSelectedLabel}
      />
      <BinEditorCanvas
        svgRef={svgRef}
        displayWidth={displayWidth}
        displayHeight={displayHeight}
        gridX={gridX}
        gridY={gridY}
        wallThickness={wallThickness}
        placedTools={placedTools}
        selection={selection}
        textLabels={textLabels}
        editingLabelId={editingLabelId}
        editingText={editingText}
        pendingLabel={pendingLabel}
        pendingLabelText={pendingText}
        smoothedToolIds={smoothedToolIds}
        smoothLevels={smoothLevels}
        activeTool={activeTool}
        binWidthMm={binWidthMm}
        binHeightMm={binHeightMm}
        handleR={handleR}
        handleStroke={handleStroke}
        handleOffset={handleOffset}
        pendingInputRef={pendingInputRef}
        editInputRef={editInputRef}
        handleToolMouseDown={handleToolMouseDown}
        handleRotateMouseDown={handleRotateMouseDown}
        handleLabelMouseDown={handleLabelMouseDown}
        handleLabelRotateMouseDown={handleLabelRotateMouseDown}
        handleLabelDoubleClick={handleLabelDoubleClick}
        handleBackgroundClick={handleBackgroundClick}
        stopClick={stopClick}
        stopClickUnlessText={stopClickUnlessText}
        onEditingTextChange={setEditingText}
        onEditingLabelKeyDown={handleEditingLabelKeyDown}
        onEditingLabelBlur={commitEditingLabel}
        onPendingTextChange={setPendingText}
        onPendingLabelKeyDown={handlePendingLabelKeyDown}
        onPendingLabelBlur={commitPendingLabel}
      />
    </div>
  )
}
