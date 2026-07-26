'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  addToolsToProject,
  addBinsToProject,
  createProjectBin,
  createProjectSketch,
  deleteProjectSketch,
  getProject,
  getProjectHealth,
  listProjects,
  listBins,
  listTools,
  deleteBin,
  detachBinFromProject,
  removeToolFromProject,
  repairProject,
  updateProject,
} from '@/lib/api'
import type { BinConfig, BinProject, BinProjectSummary, BinSummary, ProjectHealthIssue, ProjectStatus, ToolSummary } from '@/types'
import { Alert } from '@/components/Alert'
import { BinConfigurator } from '@/components/BinConfigurator'
import { ConfirmModal } from '@/components/ConfirmModal'
import { SectionHeader } from '@/components/SectionHeader'
import { ToolSummaryButton, ToolSummaryItem } from '@/components/ToolSummaryItem'
import { useDeleteConfirmation } from '@/hooks/useDeleteConfirmation'
import { binDefaultsFromConfig, buildBinConfig, getDefaultBinConfig, getDefaultBinDefaults } from '@/lib/binDefaults'
import { projectScopedHref } from '@/lib/projectNavigation'
import {
  binLabel,
  getUniqueBinTools,
  getProjectCollections,
  projectStatusLabels,
  projectNameMap,
  toolProjectLabel,
  type ProjectToolFilter,
} from '@/lib/projectSelectors'
import { AlertTriangle, ArrowLeft, CheckSquare, ChevronDown, ChevronRight, LayoutGrid, Loader2, Package, Plus, Search, Square, Trash2, Unlink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTheme } from '@/hooks/useTheme'

const PROJECT_SECTION_COLLAPSE_KEY = 'tracefinity.project.collapsedSections'
type ProjectSectionId = 'binDefaults' | 'projectTools' | 'linkedBins' | 'sketches'
type ProjectSectionCollapseState = Record<ProjectSectionId, boolean>

const defaultProjectSectionCollapse: ProjectSectionCollapseState = {
  binDefaults: true,
  projectTools: false,
  linkedBins: false,
  sketches: false,
}

function loadProjectSectionCollapseState(): ProjectSectionCollapseState {
  if (typeof window === 'undefined') return defaultProjectSectionCollapse
  try {
    const raw = window.localStorage.getItem(PROJECT_SECTION_COLLAPSE_KEY)
    if (!raw) return defaultProjectSectionCollapse
    return { ...defaultProjectSectionCollapse, ...JSON.parse(raw) }
  } catch {
    return defaultProjectSectionCollapse
  }
}

export default function ProjectPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.id as string
  const { theme } = useTheme()

  const [project, setProject] = useState<BinProject | null>(null)
  const [projects, setProjects] = useState<BinProjectSummary[]>([])
  const [tools, setTools] = useState<ToolSummary[]>([])
  const [bins, setBins] = useState<BinSummary[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectedBinToolIds, setSelectedBinToolIds] = useState<Set<string>>(new Set())
  const [expandedBinIds, setExpandedBinIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [projectSearch, setProjectSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ProjectToolFilter>('all')
  const [addToolsOpen, setAddToolsOpen] = useState(true)
  const [addBinsOpen, setAddBinsOpen] = useState(false)
  const [selectedExistingBinIds, setSelectedExistingBinIds] = useState<Set<string>>(new Set())
  const [importExistingBinTools, setImportExistingBinTools] = useState(false)
  const [allowReassignBins, setAllowReassignBins] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<ProjectSectionCollapseState>(loadProjectSectionCollapseState)
  const [healthIssues, setHealthIssues] = useState<ProjectHealthIssue[]>([])
  const [projectDefaultConfig, setProjectDefaultConfig] = useState<BinConfig>(() => getDefaultBinConfig())
  const [savingProjectDefaults, setSavingProjectDefaults] = useState(false)
  const [projectDefaultsStatus, setProjectDefaultsStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [creatingBin, setCreatingBin] = useState(false)
  const [creatingSketch, setCreatingSketch] = useState(false)
  const { deleteTarget: deleteSketchId, requestDelete: requestSketchDelete, clearDelete: clearSketchDelete } = useDeleteConfirmation<string>()
  const { deleteTarget: deleteBinId, requestDelete: requestBinDelete, clearDelete: clearBinDelete } = useDeleteConfirmation<string>()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [projectId])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const [p, t, b, allProjects, h] = await Promise.all([
        getProject(projectId),
        listTools(),
        listBins(),
        listProjects(),
        getProjectHealth(projectId).catch(() => null),
      ])
      const savedAddToolsOpen = window.localStorage.getItem('tracefinity.project.addToolsOpen')
      setProject(p)
      setProjectDefaultConfig(buildBinConfig(p.default_bin_config || getDefaultBinDefaults()))
      setProjectDefaultsStatus(null)
      setProjects(allProjects)
      setTools(t)
      setBins(b)
      setHealthIssues(h?.issues || [])
      setAddToolsOpen(p.tool_ids.length === 0 ? true : savedAddToolsOpen !== null ? savedAddToolsOpen === 'true' : true)
      setSelectedBinToolIds(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load project')
    } finally {
      setLoading(false)
    }
  }

  const {
    projectToolIds,
    projectTools,
    unplacedToolIds,
    filteredProjectTools,
    projectBins,
    toolById,
    toolBins,
    existingBinOptions,
    actionableVisibleToolIds,
    availableTools,
  } = useMemo(() => getProjectCollections(project, tools, bins, {
    projectSearch,
    addToolSearch: search,
    statusFilter,
    allowReassignBins,
  }), [project, tools, bins, projectSearch, search, statusFilter, allowReassignBins])
  const projectNameById = useMemo(() => projectNameMap(projects), [projects])

  function toggleSelected(toolId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(toolId)) next.delete(toolId)
      else next.add(toolId)
      return next
    })
  }

  function toggleBinTool(toolId: string) {
    setSelectedBinToolIds(prev => {
      const next = new Set(prev)
      if (next.has(toolId)) next.delete(toolId)
      else next.add(toolId)
      return next
    })
  }

  function toggleExpandedBin(binId: string) {
    setExpandedBinIds(prev => {
      const next = new Set(prev)
      if (next.has(binId)) next.delete(binId)
      else next.add(binId)
      return next
    })
  }

  function setAddToolsOpenPersisted(open: boolean) {
    setAddToolsOpen(open)
    window.localStorage.setItem('tracefinity.project.addToolsOpen', String(open))
  }

  function setSectionCollapsed(section: ProjectSectionId, collapsed: boolean) {
    setCollapsedSections(prev => {
      const next = { ...prev, [section]: collapsed }
      window.localStorage.setItem(PROJECT_SECTION_COLLAPSE_KEY, JSON.stringify(next))
      return next
    })
  }

  async function handleAddSelected() {
    if (!project || selected.size === 0) return
    setSaving(true)
    setError(null)
    try {
      const toolIds = Array.from(selected)
      const updated = await addToolsToProject(project.id, toolIds)
      setProject(updated)
      setTools(prev => prev.map(tool => (
        toolIds.includes(tool.id) && !tool.project_ids.includes(project.id)
          ? { ...tool, project_ids: [...tool.project_ids, project.id] }
          : tool
      )))
      setSelectedBinToolIds(prev => new Set([...Array.from(prev), ...toolIds]))
      setSelected(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to add tools')
    } finally {
      setSaving(false)
    }
  }

  async function handleProjectStatusChange(status: ProjectStatus) {
    if (!project) return
    const previous = project
    setProject({ ...project, status })
    try {
      const updated = await updateProject(project.id, { status })
      setProject(updated)
    } catch (err) {
      setProject(previous)
      setError(err instanceof Error ? err.message : 'failed to update project status')
    }
  }

  async function handleSaveProjectDefaults() {
    if (!project) return
    setSavingProjectDefaults(true)
    setError(null)
    try {
      const updated = await updateProject(project.id, {
        default_bin_config: binDefaultsFromConfig(projectDefaultConfig),
      })
      setProject(updated)
      setProjectDefaultsStatus('Project defaults saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save project defaults')
    } finally {
      setSavingProjectDefaults(false)
    }
  }

  async function handleClearProjectDefaults() {
    if (!project) return
    setSavingProjectDefaults(true)
    setError(null)
    try {
      const updated = await updateProject(project.id, { default_bin_config: null })
      setProject(updated)
      setProjectDefaultConfig(getDefaultBinConfig())
      setProjectDefaultsStatus('Using global defaults')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to clear project defaults')
    } finally {
      setSavingProjectDefaults(false)
    }
  }

  async function handleRepairHealth() {
    if (!project) return
    setSaving(true)
    setError(null)
    try {
      const health = await repairProject(project.id)
      const [updated, refreshedBins, refreshedTools] = await Promise.all([getProject(project.id), listBins(), listTools()])
      setProject(updated)
      setBins(refreshedBins)
      setTools(refreshedTools)
      setHealthIssues(health.issues)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to repair project links')
    } finally {
      setSaving(false)
    }
  }

  async function handleRemoveTool(toolId: string) {
    if (!project) return
    setSaving(true)
    setError(null)
    try {
      const updated = await removeToolFromProject(project.id, toolId)
      setProject(updated)
      setTools(prev => prev.map(tool => (
        tool.id === toolId
          ? { ...tool, project_ids: tool.project_ids.filter(pid => pid !== project.id) }
          : tool
      )))
      setSelectedBinToolIds(prev => {
        const next = new Set(prev)
        next.delete(toolId)
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to remove tool')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateBin() {
    if (!project || selectedBinToolIds.size === 0) return
    setCreatingBin(true)
    setError(null)
    try {
      const bin = await createProjectBin(project.id, {
        name: `${project.name} bin ${projectBins.length + 1}`,
        tool_ids: Array.from(selectedBinToolIds),
        ...(project.default_bin_config ? {} : { bin_config: getDefaultBinDefaults() }),
      })
      router.push(projectScopedHref(project.id, `/bins/${bin.id}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create bin')
    } finally {
      setCreatingBin(false)
    }
  }

  async function handleCreateSketch() {
    if (!project) return
    setCreatingSketch(true)
    setError(null)
    try {
      const sketch = await createProjectSketch(project.id)
      router.push(`/projects/${project.id}/sketch/${sketch.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create drawer plan')
    } finally {
      setCreatingSketch(false)
    }
  }

  async function handleDeleteSketch() {
    if (!project || !deleteSketchId) return
    setSaving(true)
    setError(null)
    try {
      await deleteProjectSketch(project.id, deleteSketchId)
      setProject({ ...project, sketches: project.sketches.filter(sketch => sketch.id !== deleteSketchId) })
      clearSketchDelete()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to delete drawer plan')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteBin() {
    if (!project || !deleteBinId) return
    setSaving(true)
    setError(null)
    try {
      await deleteBin(deleteBinId)
      setBins(prev => prev.filter(bin => bin.id !== deleteBinId))
      setProject({ ...project, bin_ids: project.bin_ids.filter(id => id !== deleteBinId) })
      clearBinDelete()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to delete bin')
    } finally {
      setSaving(false)
    }
  }

  async function handleDetachBin(binId: string) {
    if (!project) return
    setSaving(true)
    setError(null)
    try {
      const updated = await detachBinFromProject(project.id, binId)
      setProject(updated)
      setBins(prev => prev.map(bin => bin.id === binId ? { ...bin, project_id: null } : bin))
      setHealthIssues((await getProjectHealth(project.id)).issues)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to detach bin')
    } finally {
      setSaving(false)
    }
  }

  async function handleAddExistingBins() {
    if (!project || selectedExistingBinIds.size === 0) return
    setSaving(true)
    setError(null)
    try {
      const updated = await addBinsToProject(project.id, {
        bin_ids: Array.from(selectedExistingBinIds),
        import_tools: importExistingBinTools,
        allow_reassign: allowReassignBins,
      })
      const [refreshedBins, refreshedTools, health] = await Promise.all([listBins(), listTools(), getProjectHealth(project.id)])
      setProject(updated)
      setBins(refreshedBins)
      setTools(refreshedTools)
      setHealthIssues(health.issues)
      setSelectedExistingBinIds(new Set())
      setAddBinsOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to add existing bins')
    } finally {
      setSaving(false)
    }
  }

  function handleSelectVisible() {
    setSelectedBinToolIds(new Set(actionableVisibleToolIds))
  }

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto py-4">
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading project...
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="max-w-6xl mx-auto py-4">
        <Alert variant="error">{error || 'project not found'}</Alert>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto py-4 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <button
            onClick={() => router.push('/')}
            className="mb-3 glass-sm rounded-[7px] px-2.5 py-1 text-[11px] text-text-secondary flex items-center gap-1.5 hover:bg-glass-hover transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3 h-3" />
            Dashboard
          </button>
          <h1 className="text-xl font-semibold text-text-primary">{project.name}</h1>
          {project.description && (
            <p className="mt-1 text-xs text-text-secondary">{project.description}</p>
          )}
          <div className="mt-2 flex items-center gap-3 text-[11px] text-text-muted">
            <span>{projectTools.length} tool{projectTools.length !== 1 ? 's' : ''}</span>
            <span>{projectBins.length} bin{projectBins.length !== 1 ? 's' : ''}</span>
            <span>{projectStatusLabels[project.status]}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={project.status}
            onChange={e => handleProjectStatusChange(e.target.value as ProjectStatus)}
            className="h-8 bg-elevated border border-border-subtle rounded-[7px] px-2 text-xs text-text-secondary outline-none focus:border-accent"
          >
            {Object.entries(projectStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <button
            onClick={handleCreateBin}
            disabled={creatingBin || selectedBinToolIds.size === 0}
            className="btn-primary px-3 py-2 text-xs flex items-center gap-1.5"
          >
            {creatingBin ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />}
            Create bin{selectedBinToolIds.size > 0 ? ` (${selectedBinToolIds.size})` : ''}
          </button>
        </div>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      <section>
        <SectionHeader
          title="Bin defaults"
          collapsed={collapsedSections.binDefaults}
          onToggleCollapsed={() => setSectionCollapsed('binDefaults', !collapsedSections.binDefaults)}
        >
          <span className="text-[11px] text-text-muted">
            {project.default_bin_config ? 'Project-specific defaults' : 'Using global defaults'}
          </span>
          {!collapsedSections.binDefaults && (
            <>
              {projectDefaultsStatus && (
                <span className="text-[10px] text-text-muted">{projectDefaultsStatus}</span>
              )}
              <button
                type="button"
                onClick={handleClearProjectDefaults}
                disabled={savingProjectDefaults}
                className="btn-secondary px-2 py-1 text-[11px]"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={handleSaveProjectDefaults}
                disabled={savingProjectDefaults}
                className="btn-primary px-2.5 py-1 text-[11px] inline-flex items-center gap-1"
              >
                {savingProjectDefaults && <Loader2 className="w-3 h-3 animate-spin" />}
                Save defaults
              </button>
            </>
          )}
        </SectionHeader>
        {!collapsedSections.binDefaults && (
          <div className="glass rounded-[8px] px-3 py-3">
            <div className="max-w-sm">
              <BinConfigurator config={projectDefaultConfig} onChange={setProjectDefaultConfig} />
            </div>
          </div>
        )}
      </section>

      {healthIssues.length > 0 && (
        <section className="glass rounded-[8px] px-3 py-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className={cn("flex items-center gap-2 text-xs", theme === 'dark' ? 'text-amber-300' : 'text-amber-600')}>
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{healthIssues.length} project health issue{healthIssues.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="mt-1 space-y-0.5">
                {healthIssues.slice(0, 3).map((issue, index) => (
                  <p key={`${issue.code}-${issue.tool_id || issue.bin_id || index}`} className="text-[11px] text-text-muted truncate">
                    {issue.message}
                  </p>
                ))}
                {healthIssues.length > 3 && (
                  <p className="text-[11px] text-text-muted">{healthIssues.length - 3} more issue{healthIssues.length - 3 !== 1 ? 's' : ''}</p>
                )}
              </div>
            </div>
            {healthIssues.some(issue => issue.repairable) && (
              <button
                onClick={handleRepairHealth}
                disabled={saving}
                className="btn-secondary px-3 py-1.5 text-xs flex-shrink-0"
              >
                Repair links
              </button>
            )}
          </div>
        </section>
      )}

      <section>
        <SectionHeader
          title="Project tools"
          count={projectTools.length}
          collapsed={collapsedSections.projectTools}
          onToggleCollapsed={() => setSectionCollapsed('projectTools', !collapsedSections.projectTools)}
        >
          {!collapsedSections.projectTools && projectTools.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted" />
                <input
                  value={projectSearch}
                  onChange={e => setProjectSearch(e.target.value)}
                  placeholder="Find in project..."
                  className="w-36 pl-6 pr-2 py-1 text-[11px] bg-elevated border border-border-subtle rounded-[7px] text-text-primary outline-none focus:border-accent"
                />
              </div>
              {[
                ['all', `All ${projectTools.length}`],
                ['unplaced', `Unplaced ${project.unplaced_tool_ids.length}`],
                ['placed', `Placed ${project.placed_tool_ids.length}`],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setStatusFilter(key as ProjectToolFilter)}
                  className={`rounded-[7px] px-2 py-1 text-[11px] transition-colors cursor-pointer ${
                    statusFilter === key
                      ? 'bg-accent-muted text-accent'
                      : 'glass-sm text-text-secondary hover:bg-glass-hover'
                  }`}
                >
                  {label}
                </button>
              ))}
              <span className="text-[11px] text-text-muted">{selectedBinToolIds.size} selected for bin</span>
              <button
                onClick={() => setSelectedBinToolIds(new Set(project.tool_ids))}
                className="btn-secondary px-2 py-1 text-[11px]"
              >
                Select all
              </button>
              {(filteredProjectTools.length !== projectTools.length || projectSearch.trim()) && (
                <button
                  onClick={handleSelectVisible}
                  className="btn-secondary px-2 py-1 text-[11px]"
                >
                  Select visible ({actionableVisibleToolIds.length})
                </button>
              )}
              <button
                onClick={() => setSelectedBinToolIds(new Set())}
                className="btn-secondary px-2 py-1 text-[11px]"
              >
                Select none
              </button>
            </div>
          )}
        </SectionHeader>
        {!collapsedSections.projectTools && (
          projectTools.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {filteredProjectTools.map(tool => {
                const isSelectedForBin = selectedBinToolIds.has(tool.id)
                const projectLabel = toolProjectLabel(tool.project_ids, projectNameById)
                const binsForTool = toolBins.get(tool.id) || []
                const metadataItems = [
                  ...(projectLabel ? [{ key: 'project', label: projectLabel, title: projectLabel, className: 'text-text-secondary' }] : []),
                  ...(binsForTool.length > 0
                    ? binsForTool.slice(0, 2).map(bin => ({
                      key: bin.id,
                      label: binLabel(bin),
                      title: binLabel(bin),
                      className: 'text-text-secondary',
                    }))
                    : [{ key: 'needs-bin', label: 'Needs bin', title: 'Needs bin', className: theme === 'dark' ? 'text-amber-300' : 'text-amber-600' }]),
                ]
                return (
                <div key={tool.id} className="glass rounded-[8px] px-3 py-2 min-h-[72px] flex items-start justify-between gap-2">
                  <button
                    onClick={() => toggleBinTool(tool.id)}
                    className="mt-5 text-text-muted hover:text-accent transition-colors cursor-pointer flex-shrink-0"
                    title={isSelectedForBin ? 'Exclude from next bin' : 'Include in next bin'}
                  >
                    {isSelectedForBin ? (
                      <CheckSquare className="w-4 h-4 text-accent" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={() => router.push(projectScopedHref(project.id, `/tools/${tool.id}`))}
                    className="min-w-0 flex-1 flex items-start gap-2 text-left cursor-pointer"
                  >
                    <ToolSummaryItem tool={tool} className="flex-1 items-start">
                      <span className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
                        {metadataItems.map((item, index) => (
                          <span key={item.key} className="min-w-0 contents">
                            {index > 0 && <span className="text-[10px] text-text-muted flex-shrink-0">·</span>}
                            <span className={`min-w-0 text-[10px] truncate ${item.className}`} title={item.title}>
                              {item.label}
                            </span>
                          </span>
                        ))}
                      </span>
                    </ToolSummaryItem>
                  </button>
                  <button
                    onClick={() => handleRemoveTool(tool.id)}
                    disabled={saving}
                    className="btn-danger-icon flex-shrink-0"
                    title="Remove from project"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                )
              })}
              {filteredProjectTools.length === 0 && (
                <div className="glass rounded-[8px] p-6 text-center sm:col-span-2 lg:col-span-3">
                  <p className="text-xs text-text-muted">No tools match this filter.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="glass rounded-[8px] p-6 text-center">
              <p className="text-xs text-text-muted">No tools assigned.</p>
            </div>
          )
        )}
      </section>

      <section>
        <div className="flex h-[32px] items-center justify-between gap-3 mb-3">
          <button
            onClick={() => setAddToolsOpenPersisted(!addToolsOpen)}
            className="flex items-center gap-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-[1.5px] hover:text-text-secondary transition-colors cursor-pointer"
          >
            {addToolsOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            Add tools
            <span className="tracking-normal normal-case font-normal">({availableTools.length})</span>
          </button>
          {addToolsOpen && (
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Filter tools..."
                  className="w-40 pl-6 pr-2 py-1 text-[11px] bg-elevated border border-border-subtle rounded-[7px] text-text-primary outline-none focus:border-accent"
                />
              </div>
              <button
                onClick={() => setSelected(new Set(availableTools.map(tool => tool.id)))}
                disabled={availableTools.length === 0}
                className="btn-secondary px-2 py-1 text-[11px]"
              >
                Select all
              </button>
              <button
                onClick={() => setSelected(new Set())}
                disabled={selected.size === 0}
                className="btn-secondary px-2 py-1 text-[11px]"
              >
                Select none
              </button>
              <button
                onClick={handleAddSelected}
                disabled={saving || selected.size === 0}
                className="btn-secondary px-3 py-1.5 text-xs flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Add {selected.size || ''}
              </button>
            </div>
          )}
        </div>
        {addToolsOpen && (
          <>
            {availableTools.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {availableTools.map(tool => {
                  const isSelected = selected.has(tool.id)
                  const projectLabel = toolProjectLabel(tool.project_ids, projectNameById)
                  return (
                    <button
                      key={tool.id}
                      onClick={() => toggleSelected(tool.id)}
                      className="glass rounded-[8px] px-3 py-2 h-[72px] flex items-center gap-2 text-left hover:bg-glass-hover transition-colors cursor-pointer"
                    >
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-accent flex-shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 text-text-muted flex-shrink-0" />
                      )}
                      <ToolSummaryItem tool={tool} className="flex-1">
                        {projectLabel && (
                          <span
                            className="mt-0.5 block max-w-[160px] text-[10px] text-text-secondary truncate"
                            title={projectLabel}
                          >
                            {projectLabel}
                          </span>
                        )}
                      </ToolSummaryItem>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="glass rounded-[8px] p-6 text-center">
                <p className="text-xs text-text-muted">No available tools.</p>
              </div>
            )}
          </>
        )}
      </section>

      <section>
        <SectionHeader
          title="Linked bins"
          count={projectBins.length}
          collapsed={collapsedSections.linkedBins}
          onToggleCollapsed={() => setSectionCollapsed('linkedBins', !collapsedSections.linkedBins)}
        >
          <button
            onClick={() => setAddBinsOpen(prev => !prev)}
            className="btn-secondary px-2 py-1 text-[11px] inline-flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            Add existing bin
          </button>
        </SectionHeader>
        {!collapsedSections.linkedBins && addBinsOpen && (
          <div className="glass rounded-[8px] px-3 py-2 mb-3 space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                <input
                  type="checkbox"
                  checked={importExistingBinTools}
                  onChange={e => setImportExistingBinTools(e.target.checked)}
                />
                Import bin tools
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                <input
                  type="checkbox"
                  checked={allowReassignBins}
                  onChange={e => setAllowReassignBins(e.target.checked)}
                />
                Show assigned bins
              </label>
              <button
                onClick={handleAddExistingBins}
                disabled={saving || selectedExistingBinIds.size === 0}
                className="btn-primary px-3 py-1.5 text-xs"
              >
                Add {selectedExistingBinIds.size || ''}
              </button>
            </div>
            {existingBinOptions.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {existingBinOptions.map(bin => {
                  const selectedExisting = selectedExistingBinIds.has(bin.id)
                  return (
                    <button
                      key={bin.id}
                      onClick={() => setSelectedExistingBinIds(prev => {
                        const next = new Set(prev)
                        if (next.has(bin.id)) next.delete(bin.id)
                        else next.add(bin.id)
                        return next
                      })}
                      className="glass-sm rounded-[7px] px-2 py-1.5 text-left flex items-center gap-2 hover:bg-glass-hover transition-colors"
                    >
                      {selectedExisting ? <CheckSquare className="w-3.5 h-3.5 text-accent" /> : <Square className="w-3.5 h-3.5 text-text-muted" />}
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px] text-text-primary truncate">{binLabel(bin)}</span>
                        <span className="block text-[10px] text-text-muted">{bin.grid_x}x{bin.grid_y} · {bin.tool_count} tool{bin.tool_count !== 1 ? 's' : ''}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="text-[11px] text-text-muted">No available bins to add.</p>
            )}
          </div>
        )}
        {!collapsedSections.linkedBins && (
          projectBins.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {projectBins.map(bin => {
                const isExpanded = expandedBinIds.has(bin.id)
                const binTools = getUniqueBinTools(bin, toolById)
                const outsideTools = binTools.filter(tool => !projectToolIds.has(tool.id))
                const projectToolsInBin = binTools.filter(tool => projectToolIds.has(tool.id))
                const stillNeedsTools = projectTools.filter(tool => unplacedToolIds.has(tool.id))
                return (
                <div
                  key={bin.id}
                  className="glass rounded-[8px] px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => toggleExpandedBin(bin.id)}
                      className="p-1 text-text-muted hover:text-accent rounded-[7px] transition-colors cursor-pointer flex-shrink-0"
                      title={isExpanded ? 'Hide tools' : 'Show tools'}
                    >
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => router.push(projectScopedHref(project.id, `/bins/${bin.id}`))}
                      className="min-w-0 flex-1 text-left cursor-pointer"
                    >
                      <span className="min-w-0">
                        <span className="block text-xs text-text-primary truncate">{binLabel(bin)}</span>
                        <span className="block text-[10px] text-text-muted">{bin.grid_x}x{bin.grid_y} · {bin.tool_count} tool{bin.tool_count !== 1 ? 's' : ''}</span>
                      </span>
                    </button>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {outsideTools.length > 0 && (
                        <AlertTriangle className={cn("w-4 h-4", theme === 'dark' ? 'text-amber-300' : 'text-amber-600')} />
                      )}
                      <Package className="w-4 h-4 text-text-muted" />
                      <button
                        onClick={() => handleDetachBin(bin.id)}
                        disabled={saving}
                        className="p-1 text-text-muted hover:text-accent hover:bg-accent-muted rounded-[7px] transition-colors cursor-pointer"
                        title="Detach bin"
                      >
                        <Unlink className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => requestBinDelete(bin.id)}
                        disabled={saving}
                        className="btn-danger-icon"
                        title="Delete bin"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="mt-2 space-y-1 border-t border-border-subtle pt-2">
                      {outsideTools.length > 0 && (
                        <div className="glass-sm rounded-[7px] border border-border-subtle px-2 py-1">
                          <p className={cn("text-[10px]", theme === 'dark' ? 'text-amber-300' : 'text-amber-600')}>{outsideTools.length} outside-project tool{outsideTools.length !== 1 ? 's' : ''} in this bin</p>
                        </div>
                      )}
                      <p className="text-[10px] text-text-muted px-1">In this bin</p>
                      {projectToolsInBin.length > 0 ? (
                        projectToolsInBin.map(tool => (
                          <ToolSummaryButton
                            key={tool.id}
                            tool={tool}
                            onClick={() => router.push(projectScopedHref(project.id, `/tools/${tool.id}`))}
                            size="sm"
                          />
                        ))
                      ) : (
                        <p className="text-[10px] text-text-muted px-1">No tools in this bin.</p>
                      )}
                      {outsideTools.length > 0 && (
                        <>
                          <p className="text-[10px] text-text-muted px-1 pt-1">Outside project</p>
                          {outsideTools.map(tool => (
                            <ToolSummaryButton
                              key={tool.id}
                              tool={tool}
                              onClick={() => router.push(projectScopedHref(project.id, `/tools/${tool.id}`))}
                              size="xs"
                            />
                          ))}
                        </>
                      )}
                      {stillNeedsTools.length > 0 && (
                        <p className="text-[10px] text-text-muted px-1 pt-1">
                          {stillNeedsTools.length} project tool{stillNeedsTools.length !== 1 ? 's' : ''} still need bin
                        </p>
                      )}
                    </div>
                  )}
                </div>
                )
              })}
            </div>
          ) : (
            <div className="glass rounded-[8px] p-6 text-center">
              <p className="text-xs text-text-muted">No linked bins yet.</p>
            </div>
          )
        )}
      </section>

      <section>
        <SectionHeader
          title="Drawer plans"
          count={project.sketches.length}
          collapsed={collapsedSections.sketches}
          onToggleCollapsed={() => setSectionCollapsed('sketches', !collapsedSections.sketches)}
        >
          <button
            onClick={handleCreateSketch}
            disabled={creatingSketch}
            className="btn-secondary px-2 py-1 text-[11px] inline-flex items-center gap-1"
          >
            {creatingSketch ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            New plan
          </button>
        </SectionHeader>
        {!collapsedSections.sketches && (
          project.sketches.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {project.sketches.map(sketch => {
                const placedBinIds = new Set(sketch.bin_layout.map(placement => placement.bin_id))
                const sized = sketch.target_grid_x !== null && sketch.target_grid_y !== null
                return (
                  <div key={sketch.id} className="glass rounded-[8px] px-3 py-2 flex items-center gap-2">
                    <button
                      onClick={() => router.push(`/projects/${project.id}/sketch/${sketch.id}`)}
                      className="min-w-0 flex-1 text-left cursor-pointer"
                    >
                      <span className="block text-xs text-text-primary truncate">{sketch.name}</span>
                      <span className="block text-[10px] text-text-muted">
                        {sized ? `${sketch.target_grid_x}x${sketch.target_grid_y} units` : 'No drawer size'}
                        {' · '}
                        {sketch.bin_layout.length} placement{sketch.bin_layout.length !== 1 ? 's' : ''}
                        {placedBinIds.size > 0 ? ` · ${placedBinIds.size} of ${projectBins.length} bins` : ''}
                      </span>
                    </button>
                    <LayoutGrid className="w-4 h-4 text-text-muted flex-shrink-0" />
                    <button
                      onClick={() => requestSketchDelete(sketch.id)}
                      disabled={saving}
                      className="btn-danger-icon flex-shrink-0"
                      title="Delete drawer plan"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="glass rounded-[8px] p-6 text-center">
              <p className="text-xs text-text-muted">
                No drawer plans yet. Create one to arrange this project&apos;s bins in a drawer.
              </p>
            </div>
          )
        )}
      </section>

      <ConfirmModal
        open={deleteBinId !== null}
        title="Delete bin?"
        message="This will permanently delete the bin and all associated files."
        confirmText="Delete"
        variant="danger"
        onConfirm={handleDeleteBin}
        onCancel={clearBinDelete}
      />

      <ConfirmModal
        open={deleteSketchId !== null}
        title="Delete drawer plan?"
        message="This removes the plan and its bin placements. The bins themselves stay in the project."
        confirmText="Delete"
        variant="danger"
        onConfirm={handleDeleteSketch}
        onCancel={clearSketchDelete}
      />
    </div>
  )
}
