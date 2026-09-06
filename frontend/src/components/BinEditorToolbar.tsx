'use client'

import { useEffect, useState } from 'react'
import { MousePointer2, Trash2, Magnet, Type, Pencil, Maximize2 } from 'lucide-react'
import type { FingerHole, PlacedTool, TextLabel } from '@/types'
import { SNAP_GRID_MIN, SNAP_GRID_MAX } from '@/lib/constants'
import { cutoutShapeLabel, isRectangularCutout } from '@/lib/cutouts'
import { NumericInput } from '@/components/NumericInput'

interface DepthInputProps {
  value: number | null | undefined
  defaultDepth: number
  maxDepth: number
  onCommit: (depth: number | null) => void
  resetKey: string
}

function DepthInput({ value, defaultDepth, maxDepth, onCommit, resetKey }: DepthInputProps) {
  const [text, setText] = useState<string>(value == null ? '' : String(value))

  // sync local text when the selected item changes (resetKey switches)
  useEffect(() => {
    setText(value == null ? '' : String(value))
  }, [resetKey, value])

  const commit = (raw: string) => {
    const trimmed = raw.trim()
    if (trimmed === '') {
      onCommit(null)
      return
    }
    const n = parseFloat(trimmed)
    if (Number.isNaN(n)) {
      // revert local text to last committed value
      setText(value == null ? '' : String(value))
      return
    }
    const clamped = Math.max(1.5, Math.min(maxDepth, n))
    setText(String(clamped))
    onCommit(clamped)
  }

  return (
    <>
      <input
        type="number"
        value={text}
        placeholder={defaultDepth.toFixed(1)}
        step={0.5}
        onChange={e => setText(e.target.value)}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setText(value == null ? '' : String(value))
            ;(e.currentTarget as HTMLInputElement).blur()
          }
        }}
        className="w-12 px-1 py-1 bg-elevated border border-border-subtle rounded-[6px] text-text-primary text-[10px] text-center outline-none focus:border-accent"
      />
      {value != null && (
        <button
          onClick={() => { setText(''); onCommit(null) }}
          className="text-[10px] text-text-muted hover:text-text-secondary px-1"
          title="Reset to default"
        >
          ×
        </button>
      )}
    </>
  )
}

type Tool = 'select' | 'text'

interface Props {
  activeTool: Tool
  setActiveTool: (tool: Tool) => void
  snapEnabled: boolean
  setSnapEnabled: (enabled: boolean) => void
  snapGrid: number
  setSnapGrid: (grid: number) => void
  handleRecenter: () => void
  selectedTool: PlacedTool | null
  selectedLabel: TextLabel | null
  selectedHole: FingerHole | null
  selectedHoleToolId: string | null
  onEditTool?: (toolId: string) => void
  onRemoveTool: () => void
  onRemoveLabel: () => void
  smoothedToolIds?: Set<string>
  smoothLevels?: Map<string, number>
  onToggleSmoothed?: (toolId: string, smoothed: boolean) => void
  onSmoothLevelChange?: (toolId: string, level: number) => void
  onUpdateLabel: (updates: Partial<TextLabel>) => void
  defaultCutoutDepth: number
  maxCutoutDepth: number
  onSetCutoutDepthOverride: (toolId: string, depth: number | null) => void
  onSetHoleDepthOverride: (toolId: string, holeId: string, depth: number | null) => void
}

const tbBtn = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-[7px] text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap'
const tbActive = 'bg-accent-muted text-accent'
const tbInactive = 'text-text-muted hover:text-text-secondary hover:bg-[rgba(255,255,255,0.03)]'

export function BinEditorToolbar({
  activeTool,
  setActiveTool,
  snapEnabled,
  setSnapEnabled,
  snapGrid,
  setSnapGrid,
  handleRecenter,
  selectedTool,
  selectedLabel,
  selectedHole,
  selectedHoleToolId,
  onEditTool,
  onRemoveTool,
  onRemoveLabel,
  smoothedToolIds,
  smoothLevels,
  onToggleSmoothed,
  onSmoothLevelChange,
  onUpdateLabel,
  defaultCutoutDepth,
  maxCutoutDepth,
  onSetCutoutDepthOverride,
  onSetHoleDepthOverride,
}: Props) {
  return (
    <>
      <button
        onClick={() => setActiveTool('select')}
        className={`${tbBtn} ${activeTool === 'select' ? tbActive : tbInactive}`}
        title="Select & move tools"
      >
        <MousePointer2 className="w-3.5 h-3.5" />
        Select
      </button>
      <button
        onClick={() => setActiveTool('text')}
        className={`${tbBtn} ${activeTool === 'text' ? tbActive : tbInactive}`}
        title="Place text label"
      >
        <Type className="w-3.5 h-3.5" />
        Text
      </button>

      <div className="w-px h-4 bg-glass-border mx-1 flex-shrink-0" />

      <button
        onClick={() => setSnapEnabled(!snapEnabled)}
        className={`${tbBtn} ${snapEnabled ? 'text-accent' : tbInactive}`}
        title={`Snap to ${snapGrid}mm grid${snapEnabled ? ' (on)' : ' (off)'}`}
      >
        <Magnet className="w-3.5 h-3.5" />
        Snap
      </button>
      {snapEnabled && (
        <NumericInput
          value={snapGrid}
          onChange={setSnapGrid}
          min={SNAP_GRID_MIN}
          max={SNAP_GRID_MAX}
          step={0.5}
          title="Snap distance (mm) — how far apart the snap grid points are"
          className="w-12 px-1 py-1 bg-elevated border border-border-subtle rounded-[6px] text-text-primary text-[10px] text-center outline-none focus:border-accent"
        />
      )}
      <button
        onClick={handleRecenter}
        className={`${tbBtn} ${tbInactive}`}
        title="Recenter view"
      >
        <Maximize2 className="w-3.5 h-3.5" />
        Recenter
      </button>

      {selectedTool && (
        <>
          <div className="w-px h-4 bg-glass-border mx-1 flex-shrink-0" />
          {onToggleSmoothed && (
            <div className="flex items-center rounded-[6px] overflow-hidden border border-glass-border">
              <button
                onClick={() => onToggleSmoothed(selectedTool.tool_id, false)}
                className={`px-2 py-1 text-[10px] font-medium transition-colors cursor-pointer ${!smoothedToolIds?.has(selectedTool.tool_id) ? 'bg-accent text-white' : 'text-text-muted hover:text-text-secondary'}`}
              >
                Accurate
              </button>
              <button
                onClick={() => onToggleSmoothed(selectedTool.tool_id, true)}
                className={`px-2 py-1 text-[10px] font-medium transition-colors cursor-pointer ${smoothedToolIds?.has(selectedTool.tool_id) ? 'bg-accent text-white' : 'text-text-muted hover:text-text-secondary'}`}
              >
                Smooth
              </button>
            </div>
          )}
          {smoothedToolIds?.has(selectedTool.tool_id) && onSmoothLevelChange && (
            <input
              type="range" min={0} max={1} step={0.05}
              value={smoothLevels?.get(selectedTool.tool_id) ?? 0.5}
              onChange={e => onSmoothLevelChange(selectedTool.tool_id, parseFloat(e.target.value))}
              className="w-16 h-1 accent-accent"
            />
          )}
          <div
            className="flex items-center gap-1 text-[10px] text-text-muted"
            title={`Cutout depth (mm). Default: ${defaultCutoutDepth.toFixed(1)}mm. Max: ${maxCutoutDepth.toFixed(1)}mm.`}
          >
            <span>Depth</span>
            <DepthInput
              value={selectedTool.depth_override}
              defaultDepth={defaultCutoutDepth}
              maxDepth={maxCutoutDepth}
              onCommit={(d) => onSetCutoutDepthOverride(selectedTool.id, d)}
              resetKey={`tool:${selectedTool.id}`}
            />
          </div>
          {onEditTool && (
            <button
              onClick={() => onEditTool(selectedTool.tool_id)}
              className={`${tbBtn} text-accent`}
            >
              <Pencil className="w-3 h-3" />
              Edit
            </button>
          )}
          <button
            onClick={onRemoveTool}
            className={`${tbBtn} text-red-400 hover:bg-red-900/20`}
            aria-label="Remove"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </>
      )}

      {selectedLabel && (
        <>
          <div className="w-px h-4 bg-glass-border mx-1 flex-shrink-0" />
          <input
            type="text"
            value={selectedLabel.text}
            onChange={e => onUpdateLabel({ text: e.target.value })}
            className="w-24 px-2 py-1 bg-elevated border border-border-subtle rounded-[6px] text-text-primary text-[11px] outline-none focus:border-accent"
            placeholder="Label text"
          />
          <div className="flex items-center gap-0.5 text-[10px] text-text-muted" title="Text size">
            <span>Size</span>
            <NumericInput
              value={selectedLabel.font_size}
              onChange={v => onUpdateLabel({ font_size: v })}
              className="w-10 px-1 py-1 bg-elevated border border-border-subtle rounded-[6px] text-text-primary text-[10px] text-center outline-none focus:border-accent"
              min={1} max={50} step={0.5}
            />
          </div>
          <div className="flex items-center gap-0.5 text-[10px] text-text-muted" title="Depth into surface">
            <span>Depth</span>
            <NumericInput
              value={selectedLabel.depth}
              onChange={v => onUpdateLabel({ depth: v })}
              className="w-10 px-1 py-1 bg-elevated border border-border-subtle rounded-[6px] text-text-primary text-[10px] text-center outline-none focus:border-accent"
              min={0.1} max={5} step={0.1}
            />
          </div>
          <div className="flex items-center rounded-[6px] overflow-hidden border border-glass-border">
            <button
              onClick={() => onUpdateLabel({ emboss: true })}
              className={`px-2 py-1 text-[10px] font-medium transition-colors cursor-pointer ${
                selectedLabel.emboss ? 'bg-accent-muted text-accent' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Emboss
            </button>
            <button
              onClick={() => onUpdateLabel({ emboss: false })}
              className={`px-2 py-1 text-[10px] font-medium transition-colors cursor-pointer ${
                !selectedLabel.emboss ? 'bg-accent-muted text-accent' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Recess
            </button>
          </div>
          <button onClick={onRemoveLabel} className={`${tbBtn} text-red-400 hover:bg-red-900/20`}>
            <Trash2 className="w-3 h-3" />
          </button>
        </>
      )}

      {selectedHole && selectedHoleToolId && (
        <>
          <div className="w-px h-4 bg-glass-border mx-1 flex-shrink-0" />
          <span className="text-[10px] text-text-muted">
            {cutoutShapeLabel(selectedHole.shape)}
            {isRectangularCutout(selectedHole.shape) && selectedHole.width && selectedHole.height
              ? ` ${selectedHole.width.toFixed(0)}×${selectedHole.height.toFixed(0)}mm`
              : selectedHole.shape === 'square'
              ? ` ${(selectedHole.radius * 2).toFixed(0)}mm`
              : ` r=${selectedHole.radius.toFixed(1)}mm`}
          </span>
          <div
            className="flex items-center gap-1 text-[10px] text-text-muted"
            title={`Cutout depth (mm). Default: ${defaultCutoutDepth.toFixed(1)}mm. Max: ${maxCutoutDepth.toFixed(1)}mm. Set deeper than the tool to clear protruding features.`}
          >
            <span>Depth</span>
            <DepthInput
              value={selectedHole.depth_override}
              defaultDepth={defaultCutoutDepth}
              maxDepth={maxCutoutDepth}
              onCommit={(d) => onSetHoleDepthOverride(selectedHoleToolId, selectedHole.id, d)}
              resetKey={`hole:${selectedHoleToolId}:${selectedHole.id}`}
            />
          </div>
        </>
      )}
    </>
  )
}
