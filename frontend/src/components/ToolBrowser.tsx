'use client'

import { useState, useEffect, useMemo } from 'react'
import { Plus, Loader2, Search } from 'lucide-react'
import { listTools } from '@/lib/api'
import type { ToolSummary, PlacedTool, Point } from '@/types'
import { getTool } from '@/lib/api'
import { polygonPathData } from '@/lib/svg'

interface Props {
  onAddTool: (tool: PlacedTool) => void
  binWidthMm: number
  binHeightMm: number
}

function ToolThumbnail({ points, interiorRings }: { points: Point[]; interiorRings?: Point[][] }) {
  if (points.length === 0) return null

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }

  const w = maxX - minX
  const h = maxY - minY
  const pad = Math.max(w, h) * 0.1
  const vx = minX - pad
  const vy = minY - pad
  const vw = w + pad * 2
  const vh = h + pad * 2

  const pathData = polygonPathData(points, interiorRings)

  return (
    <svg viewBox={`${vx} ${vy} ${vw} ${vh}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      <path
        d={pathData}
        fillRule="evenodd"
        fill="rgb(100, 116, 139)"
        stroke="rgb(148, 163, 184)"
        strokeWidth={Math.max(vw, vh) * 0.015}
      />
    </svg>
  )
}

export function ToolBrowser({ onAddTool, binWidthMm, binHeightMm }: Props) {
  const [tools, setTools] = useState<ToolSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return tools
    const q = search.toLowerCase()
    return tools.filter(t => t.name.toLowerCase().includes(q))
  }, [tools, search])

  useEffect(() => {
    listTools().then(setTools).catch(() => {}).finally(() => setLoading(false))
  }, [])

  async function handleAdd(toolSummary: ToolSummary) {
    setAdding(toolSummary.id)
    try {
      const tool = await getTool(toolSummary.id)

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const p of tool.points) {
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }
      const toolCx = (minX + maxX) / 2
      const toolCy = (minY + maxY) / 2
      const binCx = binWidthMm / 2
      const binCy = binHeightMm / 2
      const dx = binCx - toolCx
      const dy = binCy - toolCy

      const placed: PlacedTool = {
        id: `pt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        tool_id: tool.id,
        name: tool.name,
        points: tool.points.map(p => ({ x: p.x + dx, y: p.y + dy })),
        finger_holes: tool.finger_holes.map(fh => ({ ...fh, x: fh.x + dx, y: fh.y + dy })),
        interior_rings: (tool.interior_rings ?? []).map(ring =>
          ring.map(p => ({ x: p.x + dx, y: p.y + dy }))
        ),
        rotation: 0,
      }
      onAddTool(placed)
    } catch {
      // ignore
    } finally {
      setAdding(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-text-muted text-xs py-4 justify-center">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading tools...
      </div>
    )
  }

  if (tools.length === 0) {
    return (
      <p className="text-xs text-text-muted py-4 text-center">
        No tools in library yet. Upload and trace tools first.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {tools.length > 6 && (
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter tools..."
            className="w-full pl-6 pr-2 py-1.5 text-xs bg-elevated border border-border-subtle rounded text-text-primary outline-none focus:border-blue-500"
          />
        </div>
      )}
      <div className="grid grid-cols-2 gap-1.5">
      {filtered.map(tool => (
        <button
          key={tool.id}
          onClick={() => handleAdd(tool)}
          disabled={adding === tool.id}
          className="group relative bg-elevated hover:bg-border rounded overflow-hidden text-left transition-colors"
        >
          <div className="aspect-square p-2 flex items-center justify-center bg-inset/50">
            {adding === tool.id ? (
              <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
            ) : (
              <ToolThumbnail points={tool.points} interiorRings={tool.interior_rings} />
            )}
          </div>
          <div className="px-1.5 py-1 flex items-center justify-between gap-1">
            <span className="text-[10px] text-text-secondary truncate">{tool.name}</span>
            <Plus className="w-3 h-3 text-text-muted opacity-0 group-hover:opacity-100 flex-shrink-0 transition-opacity" />
          </div>
        </button>
      ))}
      {filtered.length === 0 && search && (
        <p className="text-xs text-text-muted py-2 text-center col-span-2">No matches</p>
      )}
      </div>
    </div>
  )
}
