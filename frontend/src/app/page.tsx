'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ImageUploader } from '@/components/ImageUploader'
import { ConfirmModal } from '@/components/ConfirmModal'
import { uploadImage, listTools, listBins, deleteTool, deleteBin, createBin, getImageUrl } from '@/lib/api'
import type { ToolSummary, BinSummary, BinPreviewTool, Point } from '@/types'
import { polygonPathData } from '@/lib/svg'
import { Trash2, Clock, Package, Plus, Loader2 } from 'lucide-react'
import { Alert } from '@/components/Alert'
import { PhotoIllustration, CornersIllustration, TraceIllustration, OrganiseIllustration } from '@/components/OnboardingIllustrations'
import { GRID_UNIT } from '@/lib/constants'

function ToolOutline({ points, interiorRings }: { points: Point[]; interiorRings?: Point[][] }) {
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
  const pad = Math.max(w, h) * 0.12
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
        strokeWidth={Math.max(vw, vh) * 0.012}
      />
    </svg>
  )
}

function BinPreview({ gridX, gridY, tools }: { gridX: number; gridY: number; tools: BinPreviewTool[] }) {
  const binW = gridX * GRID_UNIT
  const binH = gridY * GRID_UNIT
  const pad = Math.max(binW, binH) * 0.06

  return (
    <svg
      viewBox={`${-pad} ${-pad} ${binW + pad * 2} ${binH + pad * 2}`}
      className="w-full h-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect x={0} y={0} width={binW} height={binH} fill="rgb(30, 41, 59)" rx={2} />
      {Array.from({ length: gridX + 1 }).map((_, i) => (
        <line
          key={`v${i}`}
          x1={i * GRID_UNIT} y1={0} x2={i * GRID_UNIT} y2={binH}
          stroke="rgba(255,255,255,0.08)" strokeWidth={0.5}
        />
      ))}
      {Array.from({ length: gridY + 1 }).map((_, i) => (
        <line
          key={`h${i}`}
          x1={0} y1={i * GRID_UNIT} x2={binW} y2={i * GRID_UNIT}
          stroke="rgba(255,255,255,0.08)" strokeWidth={0.5}
        />
      ))}
      {tools.map((tool, ti) => {
        const d = polygonPathData(tool.points, tool.interior_rings)
        return (
          <path key={ti} d={d} fillRule="evenodd" fill="rgb(100, 116, 139)" stroke="rgb(148, 163, 184)" strokeWidth={0.8} />
        )
      })}
    </svg>
  )
}

function NameModal({ open, onConfirm, onCancel }: {
  open: boolean
  onConfirm: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setValue('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) onCancel()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-surface rounded-lg shadow-xl max-w-sm w-full mx-4 p-6 border border-border">
        <h3 className="text-lg font-medium text-text-primary">New bin</h3>
        <p className="mt-2 text-sm text-text-secondary">Give your bin a name.</p>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onConfirm(value.trim() || 'Untitled') }}
          placeholder="e.g. Screwdrivers tray"
          className="mt-3 w-full px-3 py-2 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-blue-500"
        />
        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-text-secondary hover:bg-elevated rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(value.trim() || 'Untitled')}
            className="px-4 py-2 text-sm text-white bg-accent hover:bg-accent-hover rounded-lg transition-colors"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}

export default function HomePage() {
  const router = useRouter()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toolsList, setToolsList] = useState<ToolSummary[]>([])
  const [binsList, setBinsList] = useState<BinSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteModal, setDeleteModal] = useState<{ type: 'tool' | 'bin'; id: string } | null>(null)
  const [creatingBin, setCreatingBin] = useState<string | null>(null)
  const [nameModal, setNameModal] = useState<{ toolIds?: string[] } | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      const [t, b] = await Promise.all([listTools(), listBins()])
      setToolsList(t)
      setBinsList(b)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  async function handleUpload(file: File) {
    setUploading(true)
    setError(null)
    try {
      const result = await uploadImage(file)
      router.push(`/trace/${result.session_id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleDeleteTool(id: string) {
    try {
      await deleteTool(id)
      setToolsList(prev => prev.filter(t => t.id !== id))
    } catch { /* ignore */ }
    setDeleteModal(null)
  }

  async function handleDeleteBin(id: string) {
    try {
      await deleteBin(id)
      setBinsList(prev => prev.filter(b => b.id !== id))
    } catch { /* ignore */ }
    setDeleteModal(null)
  }

  async function handleCreateBin(name: string, toolIds?: string[]) {
    const sourceToolId = toolIds?.[0]
    if (sourceToolId) setCreatingBin(sourceToolId)
    setNameModal(null)
    try {
      const bin = await createBin({ name, tool_ids: toolIds })
      router.push(`/bins/${bin.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create bin')
    } finally {
      setCreatingBin(null)
    }
  }

  function formatDate(iso: string | null) {
    if (!iso) return ''
    const d = new Date(iso)
    return d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h2 className="text-sm font-medium text-[#ebecec] tracking-[0.3px] mb-1">
          Create gridfinity bins from photos
        </h2>
        <p className="text-xs text-text-muted">
          Take a photo of your tools on A4 or Letter paper, and we&apos;ll trace them into your tool library.
        </p>
      </div>

      <div data-tour="upload">
        <ImageUploader onUpload={handleUpload} disabled={uploading} />
      </div>

      {uploading && (
        <div className="flex items-center justify-center gap-2 text-text-muted mt-4 text-xs">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Uploading...</span>
        </div>
      )}

      {error && (
        <div className="max-w-md mx-auto mt-4">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      {/* tools section */}
      {toolsList.length > 0 && (
        <div className="mt-10">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide">Tools</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {toolsList.map(tool => (
              <div
                key={tool.id}
                onClick={() => router.push(`/tools/${tool.id}`)}
                className="bg-surface rounded-[5px] overflow-hidden cursor-pointer transition-all group hover:bg-elevated"
              >
                <div className="aspect-square bg-inset relative overflow-hidden">
                  {tool.thumbnail_url ? (
                    <>
                      <img
                        src={getImageUrl(tool.thumbnail_url)}
                        alt=""
                        className="absolute inset-0 w-full h-full object-contain p-2 transition-opacity group-hover:opacity-30"
                      />
                      <div className="absolute inset-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                        <ToolOutline points={tool.points} interiorRings={tool.interior_rings} />
                      </div>
                    </>
                  ) : (
                    <div className="w-full h-full p-4 flex items-center justify-center">
                      <ToolOutline points={tool.points} interiorRings={tool.interior_rings} />
                    </div>
                  )}
                </div>
                <div className="px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-[#ebecec] tracking-[0.3px] truncate">
                        {tool.name}
                      </p>
                      <p className="text-[11px] text-text-muted flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3" />
                        {formatDate(tool.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-0.5 flex-shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); setNameModal({ toolIds: [tool.id] }) }}
                        disabled={creatingBin === tool.id}
                        className="p-1 text-text-muted hover:text-blue-400 hover:bg-accent-muted rounded"
                        title="Create bin"
                      >
                        {creatingBin === tool.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Package className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteModal({ type: 'tool', id: tool.id }) }}
                        className="p-1 text-text-muted hover:text-red-400 hover:bg-red-900/20 rounded"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* bins section */}
      {(binsList.length > 0 || toolsList.length > 0) && (
        <div className="mt-10">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide">Bins</h3>
            <button
              onClick={() => setNameModal({})}
              className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary rounded border border-border hover:bg-elevated flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              New Bin
            </button>
          </div>
          {binsList.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {binsList.map(bin => (
                <div
                  key={bin.id}
                  onClick={() => router.push(`/bins/${bin.id}`)}
                  className="bg-surface rounded-[5px] overflow-hidden cursor-pointer transition-all group hover:bg-elevated"
                >
                  <div className="aspect-square bg-inset flex items-center justify-center p-3">
                    {bin.preview_tools.length > 0 ? (
                      <BinPreview gridX={bin.grid_x} gridY={bin.grid_y} tools={bin.preview_tools} />
                    ) : (
                      <Package className="w-8 h-8 text-text-muted/30" />
                    )}
                  </div>
                  <div className="px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-[#ebecec] tracking-[0.3px] truncate">
                          {bin.name || `Bin ${bin.id.slice(0, 8)}`}
                        </p>
                        <p className="text-[11px] text-text-muted flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3" />
                          {formatDate(bin.created_at)}
                          {bin.tool_count > 0 && (
                            <span className="ml-1.5">{bin.tool_count} tool{bin.tool_count !== 1 ? 's' : ''}</span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-0.5 flex-shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteModal({ type: 'bin', id: bin.id }) }}
                          className="p-1 text-text-muted hover:text-red-400 hover:bg-red-900/20 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-muted">No bins yet. Create one from a tool or click &quot;New Bin&quot;.</p>
          )}
        </div>
      )}

      {!loading && toolsList.length === 0 && binsList.length === 0 && (
        <div className="mt-10 max-w-2xl mx-auto" data-tour="how-it-works">
          <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">How it works</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { Illustration: PhotoIllustration, label: '1. Photograph', caption: 'Place tools on A4 or Letter paper and photograph from above' },
              { Illustration: CornersIllustration, label: '2. Corners', caption: 'Adjust the paper corners so we know the scale' },
              { Illustration: TraceIllustration, label: '3. Trace', caption: 'AI traces tool outlines into precise silhouettes' },
              { Illustration: OrganiseIllustration, label: '4. Organise', caption: 'Arrange tools in a bin and export the STL for printing' },
            ].map(({ Illustration, label, caption }) => (
              <div key={label} className="bg-surface rounded-lg overflow-hidden border border-border">
                <div className="p-3 pb-2">
                  <Illustration />
                </div>
                <div className="px-3 pb-3">
                  <p className="text-xs font-medium text-text-secondary">{label}</p>
                  <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">{caption}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmModal
        open={deleteModal !== null}
        title={deleteModal?.type === 'tool' ? 'Delete tool?' : 'Delete bin?'}
        message={
          deleteModal?.type === 'tool'
            ? 'This will permanently delete the tool from your library.'
            : 'This will permanently delete the bin and all associated files.'
        }
        confirmText="Delete"
        variant="danger"
        onConfirm={() => {
          if (!deleteModal) return
          if (deleteModal.type === 'tool') handleDeleteTool(deleteModal.id)
          else handleDeleteBin(deleteModal.id)
        }}
        onCancel={() => setDeleteModal(null)}
      />

      <NameModal
        open={nameModal !== null}
        onConfirm={(name) => handleCreateBin(name, nameModal?.toolIds)}
        onCancel={() => setNameModal(null)}
      />
    </div>
  )
}
