'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { BinSummary, ProjectBinPlacement } from '@/types'
import { GRID_UNIT } from '@/lib/constants'
import { polygonPathData } from '@/lib/svg'
import {
  DEFAULT_BIN_COLOR,
  binFootprint,
  binPointToDrawerMm,
  clampToDrawer,
  gridLines,
  placementRect,
  snapForBin,
  snapUnits,
} from '@/lib/drawerLayout'

export const BIN_DRAG_MIME = 'application/x-tracefinity-bin'

interface Props {
  bins: Map<string, BinSummary>
  placements: ProjectBinPlacement[]
  drawerX: number
  drawerY: number
  selectedPlacementId: string | null
  overlapping: Set<string>
  outOfBounds: Set<string>
  onSelect: (placementId: string | null) => void
  onMove: (placementId: string, x: number, y: number) => void
  onDropBin: (binId: string, x: number, y: number) => void
}

interface DragState {
  placementId: string
  grabX: number // pointer offset from the bin origin, in units
  grabY: number
}

const LABEL_FONT_SIZE = 6.5

/** Trim a label to what actually fits inside the bin footprint. */
function fitLabel(label: string, widthMm: number, fontSize: number): string {
  const maxChars = Math.floor((widthMm - 6) / (fontSize * 0.55))
  if (maxChars >= label.length) return label
  if (maxChars <= 1) return ''
  return `${label.slice(0, maxChars - 1)}…`
}

/**
 * Every bin is drawn as a tinted, translucent footprint so the drawer grid stays
 * visible underneath -- the default colour is styled exactly like a highlight.
 * Selection shows as a stronger tint plus a thicker stroke.
 */
function binColors(selected: boolean, overlap: boolean, outside: boolean, color: string | null) {
  // conflicts also get a dashed outline: the palette holds reds and oranges of
  // its own, so colour alone must not be what marks a warning
  if (overlap) {
    return { stroke: '#ef4444', fill: selected ? 'rgba(239, 68, 68, 0.26)' : 'rgba(239, 68, 68, 0.14)', dashed: true }
  }
  if (outside) {
    return { stroke: '#f59e0b', fill: selected ? 'rgba(245, 158, 11, 0.26)' : 'rgba(245, 158, 11, 0.14)', dashed: true }
  }
  // 8-digit hex alpha keeps the tint readable without hiding the tool outlines
  const base = color || DEFAULT_BIN_COLOR
  return { stroke: base, fill: `${base}${selected ? '4a' : '2e'}`, dashed: false }
}

/**
 * Stack of bars whose count is the bin height in gridfinity units, so a deep bin
 * reads as a taller stack in the top-down view.
 */
function HeightIndicator({ x, y, heightUnits }: { x: number; y: number; heightUnits: number }) {
  const barWidth = 7
  const barHeight = 1.4
  const gap = 0.8
  const bars = Math.max(1, Math.min(heightUnits, 12))

  return (
    <g className="pointer-events-none">
      {Array.from({ length: bars }).map((_, index) => (
        <rect
          key={index}
          x={x - barWidth}
          y={y - (index + 1) * (barHeight + gap)}
          width={barWidth}
          height={barHeight}
          rx={0.5}
          fill="var(--color-text-muted)"
          opacity={0.75}
        />
      ))}
      <text
        x={x - barWidth - 1.5}
        y={y - 0.5}
        textAnchor="end"
        fontSize={5.5}
        fontWeight={600}
        fill="var(--color-text-muted)"
      >
        {heightUnits}u
      </text>
    </g>
  )
}

export function DrawerSketchCanvas({
  bins,
  placements,
  drawerX,
  drawerY,
  selectedPlacementId,
  overlapping,
  outOfBounds,
  onSelect,
  onMove,
  onDropBin,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [dropHint, setDropHint] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  const drawerWidthMm = drawerX * GRID_UNIT
  const drawerHeightMm = drawerY * GRID_UNIT
  const pad = Math.max(drawerWidthMm, drawerHeightMm) * 0.04

  // pointer position in grid units, using the live SVG transform
  const toUnits = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm) return null
    const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
    return { x: point.x / GRID_UNIT, y: point.y / GRID_UNIT }
  }, [])

  const moveRef = useRef(onMove)
  useEffect(() => { moveRef.current = onMove }, [onMove])

  useEffect(() => {
    if (!drag) return
    const placement = placements.find(p => p.id === drag.placementId)
    const bin = placement && bins.get(placement.bin_id)
    if (!placement || !bin) return

    function handleMouseMove(e: MouseEvent) {
      const pos = toUnits(e.clientX, e.clientY)
      if (!pos || !drag || !placement || !bin) return
      const { w, h } = binFootprint(bin, placement.rotation)
      const snap = snapForBin(bin)
      const snapped = clampToDrawer(
        { x: snapUnits(pos.x - drag.grabX, snap), y: snapUnits(pos.y - drag.grabY, snap), w, h },
        drawerX,
        drawerY,
      )
      moveRef.current(drag.placementId, snapped.x, snapped.y)
    }

    function handleMouseUp() {
      setDrag(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [drag, bins, placements, drawerX, drawerY, toUnits])

  function handleBinMouseDown(placement: ProjectBinPlacement) {
    return (e: React.MouseEvent) => {
      e.stopPropagation()
      const pos = toUnits(e.clientX, e.clientY)
      onSelect(placement.id)
      if (!pos) return
      setDrag({ placementId: placement.id, grabX: pos.x - placement.x, grabY: pos.y - placement.y })
    }
  }

  function handleDragOver(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes(BIN_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    // the bin id is only readable on drop, so hint with a generic single cell
    const pos = toUnits(e.clientX, e.clientY)
    if (pos) setDropHint({ x: snapUnits(pos.x - 0.5), y: snapUnits(pos.y - 0.5), w: 1, h: 1 })
  }

  function handleDrop(e: React.DragEvent) {
    const binId = e.dataTransfer.getData(BIN_DRAG_MIME)
    setDropHint(null)
    if (!binId) return
    e.preventDefault()
    const pos = toUnits(e.clientX, e.clientY)
    if (!pos) return
    const bin = bins.get(binId)
    const { w, h } = binFootprint(bin ?? { grid_x: 1, grid_y: 1 })
    const snap = snapForBin(bin)
    // drop centred under the cursor
    const spot = clampToDrawer(
      { x: snapUnits(pos.x - w / 2, snap), y: snapUnits(pos.y - h / 2, snap), w, h },
      drawerX,
      drawerY,
    )
    onDropBin(binId, spot.x, spot.y)
  }

  return (
    <div
      className="absolute inset-0 bg-inset flex items-center justify-center p-4"
      onDragOver={handleDragOver}
      onDragLeave={() => setDropHint(null)}
      onDrop={handleDrop}
      data-testid="drawer-sketch-canvas"
    >
      <svg
        ref={svgRef}
        viewBox={`${-pad} ${-pad} ${drawerWidthMm + pad * 2} ${drawerHeightMm + pad * 2}`}
        preserveAspectRatio="xMidYMid meet"
        className="max-w-full max-h-full w-full h-full"
        onClick={() => onSelect(null)}
      >
        <rect
          x={0} y={0}
          width={drawerWidthMm} height={drawerHeightMm}
          fill="var(--color-inset)"
          stroke="var(--color-border-subtle)"
          strokeWidth={1.5}
          rx={2}
        />

        {gridLines(drawerX).map(unit => (
          <line
            key={`v${unit}`}
            x1={unit * GRID_UNIT} y1={0}
            x2={unit * GRID_UNIT} y2={drawerHeightMm}
            stroke="var(--color-bin-preview-grid)" strokeWidth={0.6}
          />
        ))}
        {gridLines(drawerY).map(unit => (
          <line
            key={`h${unit}`}
            x1={0} y1={unit * GRID_UNIT}
            x2={drawerWidthMm} y2={unit * GRID_UNIT}
            stroke="var(--color-bin-preview-grid)" strokeWidth={0.6}
          />
        ))}

        {placements.map(placement => {
          const bin = bins.get(placement.bin_id)
          if (!bin) return null
          const rect = placementRect(placement, bin)
          const isSelected = selectedPlacementId === placement.id
          const colors = binColors(
            isSelected,
            overlapping.has(placement.id),
            outOfBounds.has(placement.id),
            placement.color,
          )
          const label = bin.name || `Bin ${bin.id.slice(0, 8)}`
          const left = rect.x * GRID_UNIT
          const top = rect.y * GRID_UNIT
          const right = (rect.x + rect.w) * GRID_UNIT
          const bottom = (rect.y + rect.h) * GRID_UNIT

          return (
            <g
              key={placement.id}
              className="cursor-move"
              onMouseDown={handleBinMouseDown(placement)}
              onClick={e => e.stopPropagation()}
            >
              <title>
                {`${label} · ${bin.grid_x}x${bin.grid_y} · ${bin.height_units}u high`}
                {bin.half_grid_base ? ' · half-grid base' : ''}
              </title>
              <rect
                x={left} y={top}
                width={rect.w * GRID_UNIT} height={rect.h * GRID_UNIT}
                fill={colors.fill}
                stroke={colors.stroke}
                strokeWidth={isSelected ? 2 : 1.2}
                strokeDasharray={colors.dashed ? '5,3' : undefined}
                rx={2}
              />
              {bin.preview_tools.map((tool, index) => (
                <path
                  key={index}
                  d={polygonPathData(
                    tool.points.map(p => binPointToDrawerMm(p, placement, bin)),
                    tool.interior_rings.map(ring => ring.map(p => binPointToDrawerMm(p, placement, bin))),
                  )}
                  fillRule="evenodd"
                  fill="var(--color-tool-fill)"
                  stroke="var(--color-tool-stroke)"
                  strokeWidth={0.8}
                  className="pointer-events-none"
                />
              ))}
              {/* stroke-behind-fill keeps the name legible on top of a tool outline */}
              <text
                x={left + 3}
                y={top + 8}
                fontSize={LABEL_FONT_SIZE}
                fontWeight={600}
                fill="var(--color-text-primary)"
                stroke="var(--color-inset)"
                strokeWidth={1.6}
                strokeLinejoin="round"
                paintOrder="stroke"
                className="pointer-events-none select-none"
              >
                {fitLabel(label, rect.w * GRID_UNIT, LABEL_FONT_SIZE)}
              </text>
              <text
                x={left + 3}
                y={bottom - 3}
                fontSize={5.5}
                fill="var(--color-text-muted)"
                stroke="var(--color-inset)"
                strokeWidth={1.4}
                strokeLinejoin="round"
                paintOrder="stroke"
                className="pointer-events-none select-none"
              >
                {bin.grid_x}x{bin.grid_y}{placement.rotation !== 0 ? ` · ${placement.rotation}°` : ''}
              </text>
              <HeightIndicator x={right - 3} y={bottom - 3} heightUnits={bin.height_units} />
            </g>
          )
        })}

        {dropHint && (
          <rect
            x={dropHint.x * GRID_UNIT} y={dropHint.y * GRID_UNIT}
            width={dropHint.w * GRID_UNIT} height={dropHint.h * GRID_UNIT}
            fill="var(--color-accent-muted)"
            stroke="var(--color-accent)"
            strokeWidth={1.2}
            strokeDasharray="6,4"
            className="pointer-events-none"
          />
        )}
      </svg>
    </div>
  )
}
