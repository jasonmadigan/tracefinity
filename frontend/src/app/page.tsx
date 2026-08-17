'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ImageUploader } from '@/components/ImageUploader'
import { ConfirmModal } from '@/components/ConfirmModal'
import { SectionHeader } from '@/components/SectionHeader'
import { uploadImage, listTools, listBins, listProjects, deleteTool, deleteBin, deleteProject, createBin, createProject, getImageUrl } from '@/lib/api'
import type { ToolSummary, BinSummary, BinPreviewTool, BinProjectSummary, Point, ToolImageContext, AffineMatrix, ProjectStatus } from '@/types'
import { polygonPathData } from '@/lib/svg'
import { Trash2, Package, Plus, Loader2, Grid3X3, Folder } from 'lucide-react'
import { Alert } from '@/components/Alert'
import { PhotoIllustration, CornersIllustration, TraceIllustration, OrganiseIllustration } from '@/components/OnboardingIllustrations'
import { GRID_UNIT } from '@/lib/constants'
import { getDefaultBinDefaults } from '@/lib/binDefaults'
import { useDeleteConfirmation } from '@/hooks/useDeleteConfirmation'
import { projectNameMap, projectStatusLabels, toolProjectLabel, toolProjectTitle } from '@/lib/projectSelectors'
import { filterToolsByStatus, getToolQuickFilterCounts } from '@/lib/toolFilters'
import type { ToolQuickFilter } from '@/lib/toolFilters'
import { cn } from '@/lib/utils'
import { useTheme } from '@/hooks/useTheme'

function thumbnailRotationStyle(transform: AffineMatrix | null): React.CSSProperties | undefined {
  if (!transform) return undefined
  const [a, b, c, d] = transform
  const s = Math.sqrt(a * a + b * b)
  if (s < 1e-9) return undefined
  return {
    transform: `matrix(${a / s}, ${b / s}, ${c / s}, ${d / s}, 0, 0)`,
    transformOrigin: 'center',
  }
}

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
        fill="var(--color-tool-fill)"
        stroke="var(--color-tool-stroke)"
        strokeWidth={Math.max(vw, vh) * 0.015}
      />
    </svg>
  )
}

function toolViewBox(points: Point[]) {
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
  return {
    x: minX - pad,
    y: minY - pad,
    width: w + pad * 2,
    height: h + pad * 2,
  }
}

function SourceImagePreview({ context, points }: { context: ToolImageContext; points: Point[] }) {
  if (points.length === 0) return null
  const vb = toolViewBox(points)
  const [a, b, c, d, e, f] = context.transform

  return (
    <svg
      viewBox={`${vb.x} ${vb.y} ${vb.width} ${vb.height}`}
      className="absolute inset-0 w-full h-full p-4 transition-opacity duration-150 group-hover:opacity-30"
      preserveAspectRatio="xMidYMid meet"
    >
      <image
        href={getImageUrl(context.image_url)}
        x={0}
        y={0}
        width={context.image_width}
        height={context.image_height}
        transform={`matrix(${a} ${b} ${c} ${d} ${e} ${f})`}
        preserveAspectRatio="none"
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
      <rect x={0} y={0} width={binW} height={binH} fill="var(--color-bin-preview-fill)" rx={2} />
      {Array.from({ length: Math.floor(gridX * 2) + 1 }).map((_, i) => {
        const x = i * GRID_UNIT / 2
        return (
          <line
            key={`v${i}`}
            x1={x} y1={0} x2={x} y2={binH}
            stroke="var(--color-bin-preview-grid)" strokeWidth={0.5}
          />
        )
      })}
      {Array.from({ length: Math.floor(gridY * 2) + 1 }).map((_, i) => {
        const y = i * GRID_UNIT / 2
        return (
          <line
            key={`h${i}`}
            x1={0} y1={y} x2={binW} y2={y}
            stroke="var(--color-bin-preview-grid)" strokeWidth={0.5}
          />
        )
      })}
      {tools.map((tool, ti) => {
        const d = polygonPathData(tool.points, tool.interior_rings)
        return (
          <path key={ti} d={d} fillRule="evenodd" fill="var(--color-tool-fill)" stroke="var(--color-tool-stroke)" strokeWidth={0.8} />
        )
      })}
    </svg>
  )
}

function NameModal({ open, title = 'New bin', description = 'Give your bin a name.', placeholder = 'e.g. Screwdrivers tray', onConfirm, onCancel }: {
  open: boolean
  title?: string
  description?: string
  placeholder?: string
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
      <div className="relative glass rounded-[8px] shadow-xl max-w-sm w-full mx-4 p-6">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        <p className="mt-1.5 text-xs text-text-secondary">{description}</p>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onConfirm(value.trim() || 'Untitled') }}
          placeholder={placeholder}
          className="mt-3 w-full px-3 py-2 text-xs bg-elevated border border-border-subtle rounded-[7px] text-text-primary outline-none focus:border-accent"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="btn-secondary px-3 py-1.5 text-xs"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(value.trim() || 'Untitled')}
            className="btn-primary px-3 py-1.5 text-xs"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}

const SECTION_COLLAPSE_KEY = 'tracefinity.home.collapsedSections'
type MainSectionId = 'projects' | 'tools' | 'bins' | 'howItWorks'
type MainSectionCollapseState = Record<MainSectionId, boolean>

const defaultSectionCollapse: MainSectionCollapseState = {
  projects: false,
  tools: false,
  bins: false,
  howItWorks: false,
}

function loadSectionCollapseState(): MainSectionCollapseState {
  if (typeof window === 'undefined') return defaultSectionCollapse
  try {
    const raw = window.localStorage.getItem(SECTION_COLLAPSE_KEY)
    if (!raw) return defaultSectionCollapse
    return { ...defaultSectionCollapse, ...JSON.parse(raw) }
  } catch {
    return defaultSectionCollapse
  }
}

function HintBanner({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme()
  return (
    <div className={cn("text-[10px] flex-shrink-0", theme === 'dark' ? 'text-amber-300' : 'text-amber-600')}>
      {children}
    </div>
  )
}

export default function HomePage() {
  const router = useRouter()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toolsList, setToolsList] = useState<ToolSummary[]>([])
  const [binsList, setBinsList] = useState<BinSummary[]>([])
  const [projectsList, setProjectsList] = useState<BinProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const { deleteTarget: deleteModal, requestDelete, clearDelete } = useDeleteConfirmation<{ type: 'tool' | 'bin' | 'project'; id: string }>()
  const [creatingBin, setCreatingBin] = useState<string | null>(null)
  const [nameModal, setNameModal] = useState<{ toolIds?: string[] } | null>(null)
  const [projectModalOpen, setProjectModalOpen] = useState(false)
  const [projectSearch, setProjectSearch] = useState('')
  const [projectStatusFilter, setProjectStatusFilter] = useState<ProjectStatus | 'all'>('all')
  const [toolSearch, setToolSearch] = useState('')
  const [toolSort, setToolSort] = useState('date')
  const [toolQuickFilter, setToolQuickFilter] = useState<ToolQuickFilter>('all')
  const [collapsedSections, setCollapsedSections] = useState<MainSectionCollapseState>(loadSectionCollapseState)

  const hasData = toolsList.length > 0 || binsList.length > 0 || projectsList.length > 0

  const projectNameById = useMemo(() => projectNameMap(projectsList), [projectsList])

  const projectStatusFilterOptions = useMemo(() => {
    const counts = new Map<ProjectStatus, number>()
    for (const project of projectsList) {
      counts.set(project.status, (counts.get(project.status) || 0) + 1)
    }
    const statuses: ProjectStatus[] = ['active', 'ready_to_print', 'printed', 'archived']
    return [
      { value: 'all' as const, label: 'All', count: projectsList.length },
      ...statuses.map(status => ({
        value: status,
        label: projectStatusLabels[status],
        count: counts.get(status) || 0,
      })),
    ]
  }, [projectsList])

  const filteredProjects = useMemo(() => {
    let list = projectsList
    if (projectStatusFilter !== 'all') {
      list = list.filter(project => project.status === projectStatusFilter)
    }
    if (projectSearch.trim()) {
      const q = projectSearch.toLowerCase()
      list = list.filter(project => project.name.toLowerCase().includes(q))
    }
    return list
  }, [projectsList, projectSearch, projectStatusFilter])

  const projectBinToolIds = useMemo(() => {
    const placed = new Set<string>()
    for (const bin of binsList) {
      if (!bin.project_id) continue
      for (const toolId of bin.tool_ids || []) placed.add(toolId)
    }
    return placed
  }, [binsList])

  const filteredTools = useMemo(() => {
    let list = filterToolsByStatus(toolsList, toolQuickFilter, projectBinToolIds)
    if (toolSearch.trim()) {
      const q = toolSearch.toLowerCase()
      list = list.filter(t => t.name.toLowerCase().includes(q))
    }
    if (toolSort === 'name') {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name))
    }
    return list
  }, [toolsList, projectBinToolIds, toolQuickFilter, toolSearch, toolSort])

  const toolQuickFilterOptions = useMemo(() => {
    const counts = getToolQuickFilterCounts(toolsList, projectBinToolIds)
    return [
      { value: 'all' as const, label: 'All', count: counts.all },
      { value: 'placed' as const, label: 'Placed', count: counts.placed },
      { value: 'unassigned' as const, label: 'Unassigned', count: counts.unassigned },
    ]
  }, [toolsList, projectBinToolIds])

  function setSectionCollapsed(section: MainSectionId, collapsed: boolean) {
    setCollapsedSections(prev => {
      const next = { ...prev, [section]: collapsed }
      window.localStorage.setItem(SECTION_COLLAPSE_KEY, JSON.stringify(next))
      return next
    })
  }

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      const [t, b, p] = await Promise.all([listTools(), listBins(), listProjects()])
      setToolsList(t)
      setBinsList(b)
      setProjectsList(p)
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
    clearDelete()
  }

  async function handleDeleteBin(id: string) {
    try {
      await deleteBin(id)
      setBinsList(prev => prev.filter(b => b.id !== id))
    } catch { /* ignore */ }
    clearDelete()
  }

  async function handleDeleteProject(id: string) {
    try {
      await deleteProject(id)
      setProjectsList(prev => prev.filter(p => p.id !== id))
      setToolsList(prev => prev.map(t => ({
        ...t,
        project_ids: t.project_ids.filter(pid => pid !== id),
      })))
      setBinsList(prev => prev.map(b => b.project_id === id ? { ...b, project_id: null } : b))
    } catch { /* ignore */ }
    clearDelete()
  }

  async function handleCreateBin(name: string, toolIds?: string[]) {
    const sourceToolId = toolIds?.[0]
    if (sourceToolId) setCreatingBin(sourceToolId)
    setNameModal(null)
    try {
      const bin = await createBin({ name, tool_ids: toolIds, bin_config: getDefaultBinDefaults() })
      router.push(`/bins/${bin.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create bin')
    } finally {
      setCreatingBin(null)
    }
  }

  async function handleCreateProject(name: string) {
    setProjectModalOpen(false)
    try {
      const project = await createProject({ name })
      router.push(`/projects/${project.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create project')
    }
  }

  function formatDate(iso: string | null) {
    if (!iso) return ''
    const d = new Date(iso)
    return d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
    })
  }

  return (
    <div className="max-w-6xl mx-auto py-4 space-y-6">
      {/* upload */}
      <div data-tour="upload">
        <ImageUploader onUpload={handleUpload} disabled={uploading} />
      </div>

      {uploading && (
        <div className="flex items-center justify-center gap-2 text-text-muted text-xs">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>Uploading...</span>
        </div>
      )}

      {error && (
        <div className="max-w-md mx-auto">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      {/* projects */}
      {(projectsList.length > 0 || toolsList.length > 0) && (
        <div>
          <SectionHeader
            title="Projects"
            count={filteredProjects.length}
            search={projectSearch}
            onSearchChange={setProjectSearch}
            collapsed={collapsedSections.projects}
            onToggleCollapsed={() => setSectionCollapsed('projects', !collapsedSections.projects)}
          >
            <button
              onClick={() => setProjectModalOpen(true)}
              className="glass-sm rounded-[7px] px-2.5 py-1 text-[11px] text-text-secondary flex items-center gap-1.5 hover:bg-glass-hover transition-colors cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              New project
            </button>
          </SectionHeader>
          {!collapsedSections.projects && (
            <>
              {projectsList.length > 0 && (
                <div className="mb-3 flex min-w-0 items-center gap-1.5 overflow-x-auto pb-0.5">
                  {projectStatusFilterOptions.map(option => {
                    const isActive = projectStatusFilter === option.value
                    return (
                      <button
                        key={option.value}
                        onClick={() => setProjectStatusFilter(option.value)}
                        className={`glass-sm flex-shrink-0 rounded-[7px] px-2.5 py-1 text-[11px] transition-colors cursor-pointer ${
                          isActive
                            ? 'bg-accent-muted text-accent'
                            : 'text-text-secondary hover:bg-glass-hover'
                        }`}
                      >
                        {option.label}
                        <span className="ml-1 text-[10px] text-text-muted">{option.count}</span>
                      </button>
                    )
                  })}
                </div>
              )}
              {projectsList.length > 0 ? (
                filteredProjects.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                    {filteredProjects.map(project => (
                    <div
                      key={project.id}
                      onClick={() => router.push(`/projects/${project.id}`)}
                      className="glass-card p-3 cursor-pointer group relative flex flex-col"
                    >
                      <div className="absolute right-2 top-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); requestDelete({ type: 'project', id: project.id }) }}
                          className="btn-danger-icon"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="min-w-0 pr-8">
                        <p className="text-[12px] font-medium text-text-primary truncate leading-tight" title={project.name}>{project.name}</p>
                        <p className="text-[10px] text-text-muted mt-1">
                          {project.tool_count} tool{project.tool_count !== 1 ? 's' : ''} assigned
                        </p>
                      </div>

                      <div className="space-y-1">
                        {(project.status !== 'active' || project.unplaced_count > 0) && (
                          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
                            {project.status !== 'active' && (
                              <span className="min-w-0 text-[10px] text-text-secondary truncate">{projectStatusLabels[project.status]}</span>
                            )}
                            {project.status !== 'active' && project.unplaced_count > 0 && (
                              <span className="text-[10px] text-text-muted flex-shrink-0">·</span>
                            )}
                            {project.unplaced_count > 0 && (
                              <HintBanner>{project.unplaced_count} need bin</HintBanner>
                            )}
                          </div>
                        )}
                        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
                          <span className="text-[10px] text-text-muted flex-shrink-0">{project.placed_count} placed</span>
                          <span className="text-[10px] text-text-muted flex-shrink-0">·</span>
                          <span className="text-[10px] text-text-muted flex-shrink-0">{project.bin_count} bin{project.bin_count !== 1 ? 's' : ''}</span>
                        </div>
                      </div>
                    </div>
                    ))}
                  </div>
                ) : (
                  <div className="glass rounded-[8px] p-6 text-center">
                    <p className="text-xs text-text-muted">No projects match this filter.</p>
                  </div>
                )
              ) : (
                <div className="glass rounded-[8px] p-6 text-center">
                  <Folder className="w-6 h-6 text-text-muted/20 mx-auto mb-2" />
                  <p className="text-xs text-text-muted mb-3">No projects yet</p>
                  <button
                    onClick={() => setProjectModalOpen(true)}
                    className="btn-primary px-4 py-1.5 text-xs"
                  >
                    Create project
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* tools */}
      {toolsList.length > 0 && (
        <div>
          <SectionHeader
            title="Tools" count={filteredTools.length}
            search={toolSearch} onSearchChange={setToolSearch}
            sortKey={toolSort} onSortChange={setToolSort}
            collapsed={collapsedSections.tools}
            onToggleCollapsed={() => setSectionCollapsed('tools', !collapsedSections.tools)}
          />
          {!collapsedSections.tools && (
          <>
            <div
              role="group"
              aria-label="Filter tools by status"
              className="mb-3 flex min-w-0 items-center gap-1.5 overflow-x-auto pb-0.5"
            >
              {toolQuickFilterOptions.map(option => {
                const isActive = toolQuickFilter === option.value
                return (
                  <button
                    key={option.value}
                    onClick={() => setToolQuickFilter(option.value)}
                    aria-pressed={isActive}
                    className={`glass-sm flex-shrink-0 rounded-[7px] px-2.5 py-1 text-[11px] transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-accent-muted text-accent'
                        : 'text-text-secondary hover:bg-glass-hover'
                    }`}
                  >
                    {option.label}
                    <span className="ml-1 text-[10px] text-text-muted">{option.count}</span>
                  </button>
                )
              })}
            </div>
            {filteredTools.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {filteredTools.map(tool => {
                const projectLabel = toolProjectLabel(tool.project_ids, projectNameById)
                const projectTitle = toolProjectTitle(tool.project_ids, projectNameById)
                const primaryProjectId = tool.project_ids[0]
                return (
                  <div
                    key={tool.id}
                    onClick={() => router.push(`/tools/${tool.id}`)}
                    className="glass-card overflow-hidden cursor-pointer group"
                  >
                    <div className="aspect-square bg-inset relative overflow-hidden">
                      {tool.image_context ? (
                        <>
                          <SourceImagePreview context={tool.image_context} points={tool.points} />
                          <div className="absolute inset-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                            <ToolOutline points={tool.points} interiorRings={tool.interior_rings} />
                          </div>
                        </>
                      ) : tool.thumbnail_url ? (
                        <>
                          <img
                            src={getImageUrl(tool.thumbnail_url)}
                            alt=""
                            className="absolute inset-0 w-full h-full object-contain p-3 transition-opacity duration-150 group-hover:opacity-30"
                            style={thumbnailRotationStyle(tool.image_transform)}
                          />
                          <div className="absolute inset-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                            <ToolOutline points={tool.points} interiorRings={tool.interior_rings} />
                          </div>
                        </>
                      ) : (
                        <div className="w-full h-full p-4 flex items-center justify-center">
                          <ToolOutline points={tool.points} interiorRings={tool.interior_rings} />
                        </div>
                      )}
                    </div>
                    <div className="px-3 py-[10px]">
                      <div className="relative">
                        <div className="min-w-0 pr-12 md:pr-0">
                          <p className="text-[12px] font-medium text-text-primary truncate leading-tight">{tool.name}</p>
                          <div className="flex min-w-0 items-center gap-1.5 mt-0.5 overflow-hidden whitespace-nowrap">
                            <span className="text-[10px] text-text-muted flex-shrink-0">{formatDate(tool.created_at)}</span>
                            <span className="text-[10px] text-text-muted flex-shrink-0">·</span>
                            {projectLabel ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (primaryProjectId) router.push(`/projects/${primaryProjectId}`)
                                }}
                                className="min-w-0 text-[10px] text-text-secondary hover:text-accent transition-colors truncate cursor-pointer"
                                title={projectTitle}
                              >
                                {projectLabel}
                              </button>
                            ) : (
                              <span className="min-w-0 text-[10px] text-text-muted truncate">Unassigned</span>
                            )}
                            {projectLabel && (
                              <>
                                <span className="text-[10px] text-text-muted flex-shrink-0">·</span>
                                {projectBinToolIds.has(tool.id) ? (
                                  <span className="text-[10px] text-text-muted flex-shrink-0">Placed</span>
                                ) : (
                                  <HintBanner>Needs bin</HintBanner>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        <div className="absolute right-0 top-0 flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => { e.stopPropagation(); setNameModal({ toolIds: [tool.id] }) }}
                            disabled={creatingBin === tool.id}
                            className="p-1 text-text-muted hover:text-accent hover:bg-accent-muted rounded-[7px] transition-colors cursor-pointer"
                            title="Create bin"
                          >
                            {creatingBin === tool.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Package className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); requestDelete({ type: 'tool', id: tool.id }) }}
                            className="btn-danger-icon"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
              </div>
            ) : (
              <div className="glass rounded-[8px] p-6 text-center">
                <p className="text-xs text-text-muted">No tools match this filter.</p>
              </div>
            )}
          </>
          )}
        </div>
      )}

      {/* bins */}
      {(binsList.length > 0 || toolsList.length > 0) && (
        <div>
          <SectionHeader
            title="Bins"
            count={binsList.length}
            collapsed={collapsedSections.bins}
            onToggleCollapsed={() => setSectionCollapsed('bins', !collapsedSections.bins)}
          >
            <button
              onClick={() => setNameModal({})}
              className="glass-sm rounded-[7px] px-2.5 py-1 text-[11px] text-text-secondary flex items-center gap-1.5 hover:bg-glass-hover transition-colors cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              New bin
            </button>
          </SectionHeader>
          {!collapsedSections.bins && (
            binsList.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {binsList.map(bin => (
                  <div
                    key={bin.id}
                    onClick={() => router.push(`/bins/${bin.id}`)}
                    className="glass-card overflow-hidden cursor-pointer group"
                  >
                    <div className="aspect-[4/3] bg-inset flex items-center justify-center p-4 relative">
                      {bin.preview_tools.length > 0 ? (
                        <BinPreview gridX={bin.grid_x} gridY={bin.grid_y} tools={bin.preview_tools} />
                      ) : (
                        <Package className="w-6 h-6 text-text-muted/20" />
                      )}
                      <div className="absolute top-2 right-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); requestDelete({ type: 'bin', id: bin.id }) }}
                          className="btn-danger-icon"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="px-3 py-[10px]">
                      <p className="text-[12px] font-medium text-text-primary truncate leading-tight">
                        {bin.name || `Bin ${bin.id.slice(0, 8)}`}
                      </p>
                      <div className="flex min-w-0 items-center gap-1.5 mt-0.5 overflow-hidden whitespace-nowrap">
                        <span className="text-[10px] text-text-muted flex-shrink-0">{formatDate(bin.created_at)}</span>
                        {bin.project_id && projectNameById.get(bin.project_id) && (
                          <>
                            <span className="text-[10px] text-text-muted flex-shrink-0">·</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                if (bin.project_id) router.push(`/projects/${bin.project_id}`)
                              }}
                              className="min-w-0 text-[10px] text-text-secondary hover:text-accent transition-colors truncate cursor-pointer"
                              title={projectNameById.get(bin.project_id)}
                            >
                              {projectNameById.get(bin.project_id)}
                            </button>
                          </>
                        )}
                        <span className="text-[10px] text-text-muted flex items-center gap-0.5 flex-shrink-0">
                          <Grid3X3 className="w-2.5 h-2.5" />
                          {bin.grid_x}x{bin.grid_y}
                        </span>
                        {bin.tool_count > 0 && (
                          <span className="text-[10px] text-text-muted flex-shrink-0">
                            {bin.tool_count} tool{bin.tool_count !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="glass rounded-[8px] p-8 text-center">
                <Package className="w-6 h-6 text-text-muted/20 mx-auto mb-2" />
                <p className="text-xs text-text-muted mb-3">No bins yet</p>
                <button
                  onClick={() => setNameModal({})}
                  className="btn-primary px-4 py-1.5 text-xs"
                >
                  Create your first bin
                </button>
              </div>
            )
          )}
        </div>
      )}

      {/* empty state onboarding */}
      {!loading && !hasData && (
        <div data-tour="how-it-works">
          <SectionHeader
            title="How it works"
            collapsed={collapsedSections.howItWorks}
            onToggleCollapsed={() => setSectionCollapsed('howItWorks', !collapsedSections.howItWorks)}
          />
          {!collapsedSections.howItWorks && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { Illustration: PhotoIllustration, label: '1. Photograph', caption: 'Place tools on A4, Letter, A3, or Tabloid paper and photograph from above' },
              { Illustration: CornersIllustration, label: '2. Corners', caption: 'Adjust the paper corners so we know the scale' },
              { Illustration: TraceIllustration, label: '3. Trace', caption: 'AI traces tool outlines into precise silhouettes' },
              { Illustration: OrganiseIllustration, label: '4. Organise', caption: 'Arrange tools in a bin and export the STL for printing' },
            ].map(({ Illustration, label, caption }) => (
              <div key={label} className="glass rounded-[8px] overflow-hidden">
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
          )}
        </div>
      )}

      <ConfirmModal
        open={deleteModal !== null}
        title={
          deleteModal?.type === 'tool'
            ? 'Delete tool?'
            : deleteModal?.type === 'project'
              ? 'Delete project?'
              : 'Delete bin?'
        }
        message={
          deleteModal?.type === 'tool'
            ? 'This will permanently delete the tool from your library.'
            : deleteModal?.type === 'project'
              ? 'This will remove the project. Tools and bins will stay in your library.'
              : 'This will permanently delete the bin and all associated files.'
        }
        confirmText="Delete"
        variant="danger"
        onConfirm={() => {
          if (!deleteModal) return
          if (deleteModal.type === 'tool') handleDeleteTool(deleteModal.id)
          else if (deleteModal.type === 'project') handleDeleteProject(deleteModal.id)
          else handleDeleteBin(deleteModal.id)
        }}
        onCancel={() => clearDelete()}
      />

      <NameModal
        open={nameModal !== null}
        onConfirm={(name) => handleCreateBin(name, nameModal?.toolIds)}
        onCancel={() => setNameModal(null)}
      />
      <NameModal
        open={projectModalOpen}
        title="New project"
        description="Name this drawer or multi-bin plan."
        placeholder="e.g. Top drawer sockets"
        onConfirm={handleCreateProject}
        onCancel={() => setProjectModalOpen(false)}
      />
    </div>
  )
}
