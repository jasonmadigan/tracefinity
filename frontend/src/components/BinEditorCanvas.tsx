'use client'

import { RefObject } from 'react'
import type { PlacedTool, TextLabel } from '@/types'
import { polygonPathData, smoothPathData, simplifyPolygon, smoothEpsilon } from '@/lib/svg'
import { GRID_UNIT, DISPLAY_SCALE } from '@/lib/constants'
import { CutoutOverlay } from '@/components/CutoutOverlay'

type Tool = 'select' | 'text'

type Selection =
  | { type: 'tool'; toolId: string }
  | { type: 'label'; labelId: string }
  | null

interface Props {
  svgRef: RefObject<SVGSVGElement | null>
  displayWidth: number
  displayHeight: number
  gridX: number
  gridY: number
  wallThickness: number
  placedTools: PlacedTool[]
  selection: Selection
  textLabels: TextLabel[]
  editingLabelId: string | null
  editingText: string
  pendingLabel: { x: number; y: number } | null
  pendingLabelText: string
  smoothedToolIds?: Set<string>
  smoothLevels?: Map<string, number>
  activeTool: Tool
  binWidthMm: number
  binHeightMm: number
  // handle sizing
  handleR: number
  handleStroke: number
  handleOffset: number
  // refs for inputs
  pendingInputRef: RefObject<HTMLInputElement | null>
  editInputRef: RefObject<HTMLInputElement | null>
  // event handlers
  handleToolMouseDown: (toolId: string) => (e: React.MouseEvent) => void
  handleRotateMouseDown: (toolId: string) => (e: React.MouseEvent) => void
  handleLabelMouseDown: (labelId: string) => (e: React.MouseEvent) => void
  handleLabelRotateMouseDown: (labelId: string) => (e: React.MouseEvent) => void
  handleLabelDoubleClick: (labelId: string) => (e: React.MouseEvent) => void
  handleBackgroundClick: (e: React.MouseEvent) => void
  stopClick: (e: React.MouseEvent) => void
  stopClickUnlessText: (e: React.MouseEvent) => void
  onEditingTextChange: (text: string) => void
  onEditingLabelKeyDown: (e: React.KeyboardEvent) => void
  onEditingLabelBlur: () => void
  onPendingTextChange: (text: string) => void
  onPendingLabelKeyDown: (e: React.KeyboardEvent) => void
  onPendingLabelBlur: () => void
}

export function BinEditorCanvas({
  svgRef,
  displayWidth,
  displayHeight,
  gridX,
  gridY,
  wallThickness,
  placedTools,
  selection,
  textLabels,
  editingLabelId,
  editingText,
  pendingLabel,
  pendingLabelText,
  smoothedToolIds,
  smoothLevels,
  activeTool,
  binWidthMm,
  binHeightMm,
  handleR,
  handleStroke,
  handleOffset,
  pendingInputRef,
  editInputRef,
  handleToolMouseDown,
  handleRotateMouseDown,
  handleLabelMouseDown,
  handleLabelRotateMouseDown,
  handleLabelDoubleClick,
  handleBackgroundClick,
  stopClick,
  stopClickUnlessText,
  onEditingTextChange,
  onEditingLabelKeyDown,
  onEditingLabelBlur,
  onPendingTextChange,
  onPendingLabelKeyDown,
  onPendingLabelBlur,
}: Props) {
  return (
    <>
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
              const level = smoothLevels?.get(tool.tool_id) ?? 0.5
              pathData = smoothPathData(simplifyPolygon(tool.points, smoothEpsilon(tool.points, level)), tool.interior_rings, DISPLAY_SCALE)
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

                <CutoutOverlay holes={tool.finger_holes} />
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
            const hitH = Math.max(fontSize * 1.4, handleR * 2)
            const hitW = Math.max(fontSize * label.text.length * 0.7, handleR * 4)

            return (
              <g key={label.id} transform={label.rotation !== 0 ? `rotate(${label.rotation} ${x} ${y})` : undefined}>
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

          {/* selection handles: tool */}
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

          {/* selection handles: label */}
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
                  onChange={e => onEditingTextChange(e.target.value)}
                  onKeyDown={onEditingLabelKeyDown}
                  onBlur={onEditingLabelBlur}
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
                value={pendingLabelText}
                onChange={e => onPendingTextChange(e.target.value)}
                onKeyDown={onPendingLabelKeyDown}
                onBlur={onPendingLabelBlur}
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
    </>
  )
}
