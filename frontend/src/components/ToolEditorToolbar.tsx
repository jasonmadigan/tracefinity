'use client'

import { ReactNode } from 'react'
import { MousePointer2, Plus, Minus, Undo2, Redo2, Trash2, Circle, Disc, Square, RectangleHorizontal, Fingerprint, Magnet, RotateCw, RotateCcw, FlipHorizontal2, FlipVertical2, ChevronDown, PaintBucket, Locate, Columns2, Rows2, ArrowLeftRight, Waypoints } from 'lucide-react'
import type { AxisOrientation, KeepSide } from '@/lib/symmetry'
import type { FingerHole } from '@/types'
import { SNAP_GRID_MIN, SNAP_GRID_MAX } from '@/lib/constants'
import { NumericInput } from '@/components/NumericInput'

export type EditMode = 'select' | 'add-vertex' | 'delete-vertex' | 'finger-hole' | 'circle' | 'cylinder' | 'square' | 'rectangle' | 'filleted_rectangle' | 'fill-ring'

export type Selection =
  | { type: 'vertex'; pointIdx: number }
  | { type: 'hole'; holeId: string }
  | null

interface Props {
  editMode: EditMode
  setEditMode: (mode: EditMode) => void
  previewSmoothed: boolean
  setPreviewSmoothed: (smoothed: boolean) => void
  outputSmoothed: boolean
  smoothLevel: number
  onOutputSmoothedChange: (smoothed: boolean) => void
  onSmoothLevelChange: (level: number) => void
  snapEnabled: boolean
  setSnapEnabled: (enabled: boolean) => void
  snapGrid: number
  setSnapGrid: (grid: number) => void
  mirrorMode: boolean
  toggleMirror: () => void
  axisOrientation: AxisOrientation
  setAxisOrientation: (o: AxisOrientation) => void
  keepSide: KeepSide
  flipKeepSide: () => void
  simplifyLevel: number
  onSimplifyPreview: (level: number) => void
  onSimplifyCommit: () => void
  simplifyDisabled: boolean
  nodeCount: number
  canUndo: boolean
  canRedo: boolean
  handleUndo: () => void
  handleRedo: () => void
  cutoutOpen: boolean
  setCutoutOpen: (open: boolean | ((prev: boolean) => boolean)) => void
  isCutoutMode: boolean
  cutoutModeIcon: ReactNode
  cutoutModeLabel: string
  selection: Selection
  selectedHole: FingerHole | null | undefined
  handleDeleteHole: () => void
  displayPointsCount: number
  rotateAll: (angleDeg: number) => void
  flipAll: (axis: 'horizontal' | 'vertical') => void
  onAutoRotate?: () => void
  autoRotating?: boolean
  hasInteriorRings: boolean
}

export function ToolEditorToolbar({
  editMode, setEditMode,
  previewSmoothed, setPreviewSmoothed, outputSmoothed, smoothLevel, onOutputSmoothedChange, onSmoothLevelChange,
  snapEnabled, setSnapEnabled, snapGrid, setSnapGrid,
  mirrorMode, toggleMirror, axisOrientation, setAxisOrientation, keepSide, flipKeepSide,
  simplifyLevel, onSimplifyPreview, onSimplifyCommit, simplifyDisabled, nodeCount,
  canUndo, canRedo, handleUndo, handleRedo,
  cutoutOpen, setCutoutOpen,
  isCutoutMode, cutoutModeIcon, cutoutModeLabel,
  selection, selectedHole, handleDeleteHole,
  displayPointsCount, rotateAll, flipAll, onAutoRotate, autoRotating, hasInteriorRings,
}: Props) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {/* mode selector */}
        <div className="flex rounded-[7px] p-0.5">
          <button
            onClick={() => setEditMode('select')}
            className={`px-2.5 py-1 rounded-[7px] text-[11px] font-medium flex items-center gap-1.5 transition-colors ${
              editMode === 'select' ? 'bg-accent-muted text-accent' : 'hover:bg-border/50 text-text-secondary'
            }`}
            title="Select and drag vertices / cutouts"
          >
            <MousePointer2 className="w-4 h-4" />
            Select
          </button>
          <button
            onClick={() => setEditMode('add-vertex')}
            className={`px-2.5 py-1 rounded-[7px] text-[11px] font-medium flex items-center gap-1.5 transition-colors ${
              previewSmoothed ? 'opacity-30 cursor-not-allowed text-text-muted' : editMode === 'add-vertex' ? 'bg-accent-muted text-accent' : 'hover:bg-border/50 text-text-secondary'
            }`}
            title={previewSmoothed ? 'Switch to Accurate view to add points' : 'Add vertex on edge'}
            disabled={previewSmoothed}
          >
            <Plus className="w-4 h-4" />
            Add point
          </button>
          <button
            onClick={() => setEditMode('delete-vertex')}
            className={`px-2.5 py-1 rounded-[7px] text-[11px] font-medium flex items-center gap-1.5 transition-colors ${
              previewSmoothed || displayPointsCount <= 3 ? 'opacity-30 cursor-not-allowed text-text-muted' : editMode === 'delete-vertex' ? 'bg-accent-muted text-accent' : 'hover:bg-border/50 text-text-secondary'
            }`}
            title={previewSmoothed ? 'Switch to Accurate view to remove points' : 'Delete vertex'}
            disabled={previewSmoothed || displayPointsCount <= 3}
          >
            <Minus className="w-4 h-4" />
            Remove
          </button>
          <div className="relative">
            <button
              onClick={() => setCutoutOpen(prev => !prev)}
              className={`px-2.5 py-1 rounded-[7px] text-[11px] font-medium flex items-center gap-1.5 transition-colors ${
                isCutoutMode ? 'bg-accent-muted text-accent' : 'hover:bg-border/50 text-text-secondary'
              }`}
            >
              {cutoutModeIcon}
              <span>{cutoutModeLabel}</span>
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>
            {cutoutOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setCutoutOpen(false)} />
                <div className="absolute top-full left-0 mt-1 bg-elevated border border-border rounded-lg shadow-lg z-20 py-1 min-w-[210px]">
                  {([
                    { mode: 'finger-hole' as EditMode, icon: <Fingerprint className="w-4 h-4" />, label: 'Finger hole', size: '15mm' },
                    { mode: 'circle' as EditMode, icon: <Circle className="w-4 h-4" />, label: 'Circle (sphere)', size: '10mm' },
                    { mode: 'cylinder' as EditMode, icon: <Disc className="w-4 h-4" />, label: 'Cylinder (flat)', size: '10mm' },
                    { mode: 'square' as EditMode, icon: <Square className="w-4 h-4" />, label: 'Square', size: '20mm' },
                    { mode: 'rectangle' as EditMode, icon: <RectangleHorizontal className="w-4 h-4" />, label: 'Rectangle', size: '30x20mm' },
                    { mode: 'filleted_rectangle' as EditMode, icon: <RectangleHorizontal className="w-4 h-4" />, label: 'Filleted rectangle', size: '30x20mm' },
                  ]).map(item => (
                    <button
                      key={item.mode}
                      onClick={() => { setEditMode(item.mode); setCutoutOpen(false) }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-border ${
                        editMode === item.mode ? 'text-accent' : 'text-text-primary'
                      }`}
                    >
                      <span className="flex-shrink-0">{item.icon}</span>
                      <span className="flex-1 text-left">{item.label}</span>
                      <span className="text-text-muted text-xs flex-shrink-0">{item.size}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {hasInteriorRings && (
            <button
              onClick={() => setEditMode('fill-ring')}
              className={`px-2.5 py-1 rounded-[7px] text-[11px] font-medium flex items-center gap-1.5 transition-colors ${
                editMode === 'fill-ring' ? 'bg-accent-muted text-accent' : 'hover:bg-border/50 text-text-secondary'
              }`}
              title="Fill in interior holes"
            >
              <PaintBucket className="w-4 h-4" />
              Fill in
            </button>
          )}
        </div>

        <div className="h-4 w-px bg-border-subtle mx-0.5" />

        {/* utility actions */}
        <div className="flex items-center gap-0.5 text-text-muted">
          <button
            onClick={() => rotateAll(-90)}
            className="p-1 rounded-[7px] hover:bg-border/50 hover:text-text-secondary"
            title="Rotate 90 counter-clockwise"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => rotateAll(90)}
            className="p-1 rounded-[7px] hover:bg-border/50 hover:text-text-secondary"
            title="Rotate 90 clockwise"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => flipAll('horizontal')}
            className="p-1 rounded-[7px] hover:bg-border/50 hover:text-text-secondary"
            title="Flip horizontally"
          >
            <FlipHorizontal2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => flipAll('vertical')}
            className="p-1 rounded-[7px] hover:bg-border/50 hover:text-text-secondary"
            title="Flip vertically"
          >
            <FlipVertical2 className="w-3.5 h-3.5" />
          </button>
          {onAutoRotate && (
            <button
              onClick={onAutoRotate}
              disabled={autoRotating}
              className="px-2 py-1 rounded-[7px] text-[11px] flex items-center gap-1 transition-colors hover:bg-border/50 text-text-secondary disabled:opacity-40 disabled:cursor-wait"
              title="Auto-rotate to minimise bounding box"
            >
              <Locate className="w-3.5 h-3.5" />
              Auto
            </button>
          )}
        </div>

        <div className="h-4 w-px bg-border-subtle mx-0.5" />

        <button
          onClick={() => setSnapEnabled(!snapEnabled)}
          className={`px-2 py-1 rounded-[7px] text-[11px] flex items-center gap-1 transition-colors ${
            snapEnabled ? 'bg-accent-muted text-accent' : 'hover:bg-border/50 text-text-secondary'
          }`}
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
          onClick={toggleMirror}
          className={`px-2 py-1 rounded-[7px] text-[11px] flex items-center gap-1 transition-colors ${
            mirrorMode ? 'bg-accent-muted text-accent' : 'hover:bg-border/50 text-text-secondary'
          }`}
          title="Symmetric editing — mirror one half onto the other and keep edits symmetric"
        >
          <FlipHorizontal2 className="w-3.5 h-3.5" />
          Mirror
        </button>
        {mirrorMode && (
          <>
            <div className="flex items-center rounded-[7px] overflow-hidden border border-border-subtle">
              <button
                onClick={() => setAxisOrientation('vertical')}
                className={`px-1.5 py-1 transition-colors ${axisOrientation === 'vertical' ? 'bg-accent-muted text-accent' : 'text-text-muted hover:text-text-secondary'}`}
                title="Vertical axis (mirror left/right)"
              >
                <Columns2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setAxisOrientation('horizontal')}
                className={`px-1.5 py-1 transition-colors ${axisOrientation === 'horizontal' ? 'bg-accent-muted text-accent' : 'text-text-muted hover:text-text-secondary'}`}
                title="Horizontal axis (mirror top/bottom)"
              >
                <Rows2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <button
              onClick={flipKeepSide}
              className="px-1.5 py-1 rounded-[7px] text-[11px] flex items-center gap-1 transition-colors hover:bg-border/50 text-text-secondary"
              title={`Keep ${axisOrientation === 'vertical' ? (keepSide === 'low' ? 'left' : 'right') : (keepSide === 'low' ? 'top' : 'bottom')} half — click to swap`}
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
            </button>
          </>
        )}

        <div
          className="flex items-center rounded-[7px] overflow-hidden border border-border-subtle text-[11px]"
          aria-label="Outline view"
        >
          <button
            onClick={() => setPreviewSmoothed(false)}
            aria-pressed={!previewSmoothed}
            className={`px-2 py-1 transition-colors ${!previewSmoothed ? 'bg-accent-muted text-accent' : 'text-text-muted hover:text-text-secondary'}`}
          >
            Accurate
          </button>
          <button
            onClick={() => { setPreviewSmoothed(true); if (editMode === 'add-vertex' || editMode === 'delete-vertex') setEditMode('select') }}
            aria-pressed={previewSmoothed}
            className={`px-2 py-1 transition-colors ${previewSmoothed ? 'bg-accent-muted text-accent' : 'text-text-muted hover:text-text-secondary'}`}
          >
            Smooth
          </button>
        </div>
        {previewSmoothed && (
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={smoothLevel}
            onChange={e => onSmoothLevelChange(parseFloat(e.target.value))}
            className="w-16 h-1 accent-accent"
            title={`Smooth level: ${Math.round(smoothLevel * 100)}%`}
          />
        )}
        <button
          onClick={() => onOutputSmoothedChange(!outputSmoothed)}
          aria-pressed={outputSmoothed}
          className={`px-2 py-1 rounded-[7px] text-[11px] transition-colors ${
            outputSmoothed ? 'bg-accent-muted text-accent' : 'hover:bg-border/50 text-text-secondary'
          }`}
          title={`Bins and exports use the ${outputSmoothed ? 'smooth' : 'accurate'} outline`}
        >
          Output: {outputSmoothed ? 'Smooth' : 'Accurate'}
        </button>

        <div className="h-4 w-px bg-border-subtle mx-0.5" />

        {/* node-count slider: simple <-> accurate (re-derives from the original trace) */}
        <div
          className={`flex items-center gap-1.5 text-text-muted ${simplifyDisabled ? 'opacity-30' : ''}`}
          title={simplifyDisabled
            ? 'Detail is unavailable while Mirror mode is on'
            : `Detail: ${nodeCount} nodes — drag toward Accurate for full trace detail, Simple for fewer nodes`}
        >
          <Waypoints className="w-3.5 h-3.5" />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={simplifyLevel}
            disabled={simplifyDisabled}
            onChange={e => onSimplifyPreview(parseFloat(e.target.value))}
            onPointerUp={onSimplifyCommit}
            onKeyUp={onSimplifyCommit}
            className="w-20 h-1 accent-accent disabled:cursor-not-allowed"
          />
          <span className="text-[10px] tabular-nums w-7 text-right">{nodeCount}</span>
        </div>

        <div className="h-4 w-px bg-border-subtle mx-0.5" />

        <button
          onClick={handleUndo}
          disabled={!canUndo}
          className="p-1 rounded-[7px] hover:bg-border/50 hover:text-text-secondary disabled:opacity-30 disabled:cursor-not-allowed"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleRedo}
          disabled={!canRedo}
          className="p-1 rounded-[7px] hover:bg-border/50 hover:text-text-secondary disabled:opacity-30 disabled:cursor-not-allowed"
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>

        {selection?.type === 'hole' && (
          <>
            <div className="h-4 w-px bg-border-subtle mx-0.5" />
            <button
              onClick={handleDeleteHole}
              className="px-2 py-1 text-[11px] font-medium text-white bg-red-700 hover:bg-red-600 rounded-[7px] flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              Delete
            </button>
          </>
        )}
      </div>

    </>
  )
}
