'use client'

import { MousePointer2, Trash2, Magnet, Type, Pencil, Maximize2 } from 'lucide-react'
import type { PlacedTool, TextLabel } from '@/types'
import { SNAP_GRID } from '@/lib/constants'

type Tool = 'select' | 'text'

interface Props {
  activeTool: Tool
  setActiveTool: (tool: Tool) => void
  snapEnabled: boolean
  setSnapEnabled: (enabled: boolean) => void
  handleRecenter: () => void
  selectedTool: PlacedTool | null
  selectedLabel: TextLabel | null
  onEditTool?: (toolId: string) => void
  onRemoveTool: () => void
  onRemoveLabel: () => void
  smoothedToolIds?: Set<string>
  smoothLevels?: Map<string, number>
  onToggleSmoothed?: (toolId: string, smoothed: boolean) => void
  onSmoothLevelChange?: (toolId: string, level: number) => void
  onUpdateLabel: (updates: Partial<TextLabel>) => void
}

export function BinEditorToolbar({
  activeTool,
  setActiveTool,
  snapEnabled,
  setSnapEnabled,
  handleRecenter,
  selectedTool,
  selectedLabel,
  onEditTool,
  onRemoveTool,
  onRemoveLabel,
  smoothedToolIds,
  smoothLevels,
  onToggleSmoothed,
  onSmoothLevelChange,
  onUpdateLabel,
}: Props) {
  return (
    <>
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

        {selectedTool && (
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
              onClick={onRemoveTool}
              className="px-3 py-1.5 text-xs font-medium text-white bg-red-700 hover:bg-red-600 rounded-lg flex items-center gap-1 shadow-sm"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Remove
            </button>
          </div>
        )}
        {selectedLabel && (
          <button
            onClick={onRemoveLabel}
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
              onChange={e => onUpdateLabel({ text: e.target.value })}
              className="w-28 px-1 py-0.5 border border-border-subtle rounded bg-surface text-text-primary"
            />
          </label>
          <label className="flex items-center gap-1">
            Size
            <input
              type="number"
              value={selectedLabel.font_size}
              onChange={e => onUpdateLabel({ font_size: Math.max(1, Math.min(50, parseFloat(e.target.value) || 1)) })}
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
              onChange={e => onUpdateLabel({ depth: Math.max(0.1, Math.min(5, parseFloat(e.target.value) || 0.1)) })}
              className="w-14 px-1 py-0.5 border border-border-subtle rounded bg-surface text-text-primary"
              min={0.1} max={5} step={0.1}
            />
            mm
          </label>
          <button
            onClick={() => onUpdateLabel({ emboss: !selectedLabel.emboss })}
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
    </>
  )
}
