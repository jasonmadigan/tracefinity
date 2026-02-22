'use client'

import { RefObject } from 'react'
import type { Point, FingerHole } from '@/types'
import { polygonPathData, smoothPathData } from '@/lib/svg'
import { DISPLAY_SCALE } from '@/lib/constants'
import { CutoutOverlay } from '@/components/CutoutOverlay'
import type { EditMode, Selection } from '@/components/ToolEditorToolbar'

interface Props {
  svgRef: RefObject<SVGSVGElement | null>
  zvbX: number
  zvbY: number
  zvbW: number
  zvbH: number
  isCutoutMode: boolean
  handleBackgroundClick: (e: React.MouseEvent) => void
  handleSvgMouseDown: (e: React.MouseEvent) => void

  // grid
  gridMinX: number
  gridMaxX: number
  gridMinY: number
  gridMaxY: number
  gridStep: number
  zoom: number

  // polygon
  displayPoints: Point[]
  smoothed: boolean
  interiorRings?: Point[][]

  // edge/vertex interactions
  points: Point[]
  editMode: EditMode
  selection: Selection
  handleEdgeClick: (edgeIdx: number) => (e: React.MouseEvent) => void
  handleVertexMouseDown: (pointIdx: number) => (e: React.MouseEvent) => void

  // cutout holes
  displayHoles: FingerHole[]
  handleHoleMouseDown: (holeId: string) => (e: React.MouseEvent) => void
  handleResizeMouseDown: (holeId: string) => (e: React.MouseEvent) => void
  handleHoleRotateMouseDown: (holeId: string) => (e: React.MouseEvent) => void
  handleRotatePolygonMouseDown: (e: React.MouseEvent) => void

  // bottom bar
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  handleResetZoom: () => void
}

export function ToolEditorCanvas({
  svgRef, zvbX, zvbY, zvbW, zvbH, isCutoutMode,
  handleBackgroundClick, handleSvgMouseDown,
  gridMinX, gridMaxX, gridMinY, gridMaxY, gridStep, zoom,
  displayPoints, smoothed, interiorRings,
  points, editMode, selection,
  handleEdgeClick, handleVertexMouseDown,
  displayHoles, handleHoleMouseDown, handleResizeMouseDown, handleHoleRotateMouseDown,
  handleRotatePolygonMouseDown,
  bounds, handleResetZoom,
}: Props) {
  const stopClick = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <>
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
            d={smoothed ? smoothPathData(displayPoints, interiorRings, DISPLAY_SCALE) : polygonPathData(displayPoints, interiorRings, DISPLAY_SCALE)}
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
                  fill="rgb(34, 197, 94)" stroke="#1e293b" strokeWidth={2}
                  className="pointer-events-none"
                />
              </g>
            )
          })}

          {/* vertex handles (hidden when smoothed) */}
          {!smoothed && (editMode === 'select' || editMode === 'add-vertex' || editMode === 'delete-vertex') && displayPoints.map((p, idx) => (
            <circle
              key={`v-${idx}`}
              cx={p.x * DISPLAY_SCALE}
              cy={p.y * DISPLAY_SCALE}
              r={8}
              fill={editMode === 'delete-vertex' ? 'rgb(239, 68, 68)' : selection?.type === 'vertex' && selection.pointIdx === idx ? 'rgb(72, 168, 214)' : '#1e293b'}
              stroke={editMode === 'delete-vertex' ? 'rgb(185, 28, 28)' : 'rgb(72, 168, 214)'}
              strokeWidth={2}
              className={editMode === 'delete-vertex' ? 'cursor-pointer' : 'cursor-move'}
              onMouseDown={handleVertexMouseDown(idx)}
              onClick={stopClick}
            />
          ))}

          {/* bounding box with corner rotation zones */}
          {editMode === 'select' && displayPoints.length > 0 && (() => {
            const s = zvbW / 800
            const pad = 8 * s
            let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity
            for (const p of displayPoints) {
              bMinX = Math.min(bMinX, p.x); bMinY = Math.min(bMinY, p.y)
              bMaxX = Math.max(bMaxX, p.x); bMaxY = Math.max(bMaxY, p.y)
            }
            for (const fh of displayHoles) {
              const r = fh.shape === 'rectangle' ? Math.max(fh.width || 0, fh.height || 0) / 2 : fh.radius
              bMinX = Math.min(bMinX, fh.x - r); bMinY = Math.min(bMinY, fh.y - r)
              bMaxX = Math.max(bMaxX, fh.x + r); bMaxY = Math.max(bMaxY, fh.y + r)
            }
            const dMinX = bMinX * DISPLAY_SCALE - pad
            const dMinY = bMinY * DISPLAY_SCALE - pad
            const dMaxX = bMaxX * DISPLAY_SCALE + pad
            const dMaxY = bMaxY * DISPLAY_SCALE + pad
            const cornerSize = 28 * s
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
                  fill="none" stroke="rgba(90, 180, 222, 0.3)" strokeWidth={1.5 * s}
                  strokeDasharray={`${6 * s},${4 * s}`}
                  className="pointer-events-none"
                />
                {corners.map((c, i) => {
                  const dx = i === 0 || i === 3 ? 1 : -1
                  const dy = i < 2 ? 1 : -1
                  const r = 14 * s
                  return (
                    <g key={i}>
                      <path
                        d={`M${c.x},${c.y + dy * r} A${r},${r} 0 0 ${dy * dx > 0 ? 1 : 0} ${c.x + dx * r},${c.y}`}
                        fill="none" stroke="rgba(90, 180, 222, 0.5)" strokeWidth={2 * s}
                        className="pointer-events-none"
                      />
                      <rect
                        x={c.x - cornerSize / 2} y={c.y - cornerSize / 2}
                        width={cornerSize} height={cornerSize}
                        fill="transparent"
                        className="cursor-rotate"
                        onMouseDown={handleRotatePolygonMouseDown}
                        onClick={stopClick}
                      />
                    </g>
                  )
                })}
              </g>
            )
          })()}

          {/* finger holes / cutouts */}
          <CutoutOverlay
            holes={displayHoles}
            zoom={zoom}
            interactive
            selectedId={selection?.type === 'hole' ? selection.holeId : undefined}
            editMode={editMode}
            onMouseDown={(id, e) => { e.stopPropagation(); handleHoleMouseDown(id)(e) }}
            onClick={stopClick}
          />

          {/* selected hole handles */}
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
            const s = zvbW / 800
            const hr = 18 * s

            return (
              <g transform={rotation !== 0 ? `rotate(${rotation} ${x} ${y})` : undefined}>
                <circle
                  cx={x + resizeOffset} cy={y} r={12 * s}
                  fill="rgb(90, 180, 222)" stroke="white" strokeWidth={2 * s}
                  className="cursor-ew-resize"
                  onMouseDown={handleResizeMouseDown(fh.id)}
                  onClick={stopClick}
                />
                <line
                  x1={x} y1={y}
                  x2={x} y2={y - topEdge - 20 * s}
                  stroke="rgba(90, 180, 222, 0.6)" strokeWidth={2 * s} strokeDasharray={`${6 * s},${5 * s}`}
                />
                <circle
                  cx={x} cy={y - topEdge - 20 * s - hr}
                  r={hr}
                  fill="rgb(90, 180, 222)" stroke="white" strokeWidth={2 * s}
                  className="cursor-rotate"
                  onMouseDown={handleHoleRotateMouseDown(fh.id)}
                  onClick={stopClick}
                />
                <text
                  x={x} y={y - topEdge - 20 * s - hr * 0.4}
                  textAnchor="middle" fill="white" fontSize={hr * 1.3}
                  className="pointer-events-none select-none"
                >&#x21BB;</text>
              </g>
            )
          })()}
        </svg>
      </div>

      {/* bottom bar */}
      <div className="flex items-center justify-between text-xs flex-shrink-0">
        <span className="text-text-secondary">
          {displayPoints.length} vertices{smoothed ? ` (${points.length} raw)` : ''}, {displayHoles.length} cutout{displayHoles.length !== 1 ? 's' : ''}
          {' \u00b7 '}
          {((bounds.maxX - bounds.minX)).toFixed(1)}\u00d7{((bounds.maxY - bounds.minY)).toFixed(1)} mm
        </span>
        <span className="text-text-muted">
          {editMode === 'select' && 'Drag vertices or cutouts to move'}
          {editMode === 'add-vertex' && 'Click an edge to add a vertex'}
          {editMode === 'delete-vertex' && 'Click a vertex to remove it'}
          {editMode === 'finger-hole' && 'Click to place finger hole'}
          {editMode === 'circle' && 'Click to place circle'}
          {editMode === 'square' && 'Click to place square'}
          {editMode === 'rectangle' && 'Click to place rectangle'}
        </span>
        {zoom !== 1 ? (
          <button onClick={handleResetZoom} className="text-text-muted hover:text-text-secondary">
            {Math.round(zoom * 100)}% · reset
          </button>
        ) : (
          <span className="text-text-muted">{Math.round(zoom * 100)}%</span>
        )}
      </div>
    </>
  )
}
