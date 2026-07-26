'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Check, Download, Folder } from 'lucide-react'
import { getTool, updateTool, autoRotateTool, getToolSvgUrl, getImageUrl, listProjects } from '@/lib/api'
import { useDebouncedSave } from '@/hooks/useDebouncedSave'
import { useProjectSource } from '@/hooks/useProjectSource'
import { projectNameMap } from '@/lib/projectSelectors'
import { ToolEditor } from '@/components/ToolEditor'
import { Alert } from '@/components/Alert'
import { Breadcrumb } from '@/components/Breadcrumb'
import type { Tool, Point, FingerHole, AffineMatrix, BinProjectSummary } from '@/types'

export default function ToolPage() {
  const params = useParams()
  const toolId = params.id as string
  const projectSource = useProjectSource('Tools')

  const [tool, setTool] = useState<Tool | null>(null)
  const [projects, setProjects] = useState<BinProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [autoRotating, setAutoRotating] = useState(false)
  const [showSourceImage, setShowSourceImage] = useState(false)
  const [sourceImageOpacity, setSourceImageOpacity] = useState(0.45)

  const sourceImageContext = useMemo(
    () => tool?.image_context
      ? { ...tool.image_context, image_url: getImageUrl(tool.image_context.image_url) }
      : null,
    [tool?.image_context]
  )

  const handleImageTransformChange = useCallback((transform: AffineMatrix) => {
    setTool(prev => prev && prev.image_context
      ? { ...prev, image_context: { ...prev.image_context, transform } }
      : prev)
  }, [])

  useEffect(() => {
    setShowSourceImage(Boolean(sourceImageContext))
  }, [sourceImageContext])

  const photoActive = Boolean(sourceImageContext) && showSourceImage
  useEffect(() => {
    async function load() {
      try {
        const [t, p] = await Promise.all([getTool(toolId), listProjects().catch(() => [])])
        setTool(t)
        setProjects(p)
        setName(t.name)
      } catch {
        setError('Tool not found')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [toolId])

  const { saving, saved, saveCount } = useDebouncedSave(
    async () => {
      if (!tool) return
      await updateTool(toolId, {
        name,
        points: tool.points,
        finger_holes: tool.finger_holes,
        interior_rings: tool.interior_rings,
        smoothed: tool.smoothed,
        smooth_level: tool.smooth_level,
        ...(tool.image_context ? { source_image_transform: tool.image_context.transform } : {}),
      })
    },
    [tool, name, toolId],
    150,
    { skipInitial: true }
  )

  const handlePointsChange = useCallback((points: Point[]) => {
    setTool(prev => prev ? { ...prev, points } : null)
  }, [])

  const handleFingerHolesChange = useCallback((finger_holes: FingerHole[]) => {
    setTool(prev => prev ? { ...prev, finger_holes } : null)
  }, [])

  const handleSmoothedChange = useCallback((smoothed: boolean) => {
    setTool(prev => prev ? { ...prev, smoothed } : null)
  }, [])

  const handleSmoothLevelChange = useCallback((smooth_level: number) => {
    setTool(prev => prev ? { ...prev, smooth_level } : null)
  }, [])

  const handleInteriorRingsChange = useCallback((interior_rings: Point[][]) => {
    setTool(prev => prev ? { ...prev, interior_rings } : null)
  }, [])

  // fetches the optimal angle only; ToolEditor applies it so the outline,
  // photo transform and undo history change as one operation
  const handleAutoRotate = useCallback(async (): Promise<number | null> => {
    if (!tool || autoRotating) return null
    setAutoRotating(true)
    try {
      const { angle } = await autoRotateTool(toolId)
      return angle
    } catch (err) {
      console.error('auto-rotate failed:', err)
      setError(err instanceof Error ? err.message : 'Auto-rotate failed')
      return null
    } finally {
      setAutoRotating(false)
    }
  }, [tool, toolId, autoRotating])

  const projectNameById = useMemo(() => projectNameMap(projects), [projects])
  const toolProjects = useMemo(() => {
    if (!tool) return []
    const projectById = new Map(projects.map(project => [project.id, project]))
    return tool.project_ids.map(projectId => {
      const project = projectById.get(projectId)
      return {
        id: projectId,
        name: project?.name || projectNameById.get(projectId) || 'Project',
        toolCount: project?.tool_count,
        binCount: project?.bin_count,
      }
    })
  }, [tool, projects, projectNameById])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-text-muted">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Loading tool...</span>
      </div>
    )
  }

  if (error || !tool) {
    return (
      <div className="max-w-md mx-auto py-12">
        <Alert variant="error">{error || 'Tool not found'}</Alert>
      </div>
    )
  }

  return (
    <div className={`h-[calc(100vh-44px)] relative overflow-hidden${photoActive ? ' editor-photo-active' : ''}`}>
      {/* floating breadcrumb panel */}
      <div className="absolute top-3.5 left-3.5 z-20 glass-toolbar px-3 py-1.5 flex items-center gap-3">
        <Breadcrumb segments={[
          { label: projectSource.rootLabel, href: projectSource.rootHref },
          { label: name || 'Untitled', editable: true, onEdit: (v) => setName(v) },
        ]} />
        <div className="flex items-center gap-1 text-[11px] text-text-muted">
          {saving && <Loader2 className="w-3 h-3 animate-spin" />}
          {saved && <Check className="w-3 h-3 text-green-400" />}
          {saving ? 'Saving...' : saved ? 'Saved' : ''}
        </div>
        <a
          href={`${getToolSvgUrl(toolId)}?v=${saveCount}`}
          download
          className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-accent-muted text-accent hover:bg-accent-muted/80 transition-colors inline-flex items-center gap-1.5"
        >
          <Download className="w-3 h-3" />
          Export SVG
        </a>
      </div>

      <div className="absolute top-14 left-3.5 z-20 glass-toolbar px-3 py-2 min-w-[220px] max-w-[280px]">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-[1.5px]">
          <Folder className="w-3 h-3" />
          Projects
        </div>
        <div className="mt-1.5 space-y-1">
          {toolProjects.length > 0 ? (
            toolProjects.map(project => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="block rounded-[7px] px-2 py-1 text-[11px] text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors truncate"
                title={project.name}
              >
                <span className="block truncate">{project.name}</span>
                {project.toolCount !== undefined && project.binCount !== undefined && (
                  <span className="block text-[10px] text-text-muted">
                    {project.toolCount} tool{project.toolCount !== 1 ? 's' : ''} · {project.binCount} bin{project.binCount !== 1 ? 's' : ''}
                  </span>
                )}
              </Link>
            ))
          ) : (
            <p className="px-2 py-1 text-[11px] text-text-muted">No projects assigned</p>
          )}
        </div>
      </div>

      {/* editor fills the entire area */}
      <ToolEditor
        key={toolId}
        points={tool.points}
        fingerHoles={tool.finger_holes}
        interiorRings={tool.interior_rings}
        smoothed={tool.smoothed}
        smoothLevel={tool.smooth_level}
        sourceImageContext={sourceImageContext}
        showSourceImage={showSourceImage}
        onShowSourceImageChange={setShowSourceImage}
        sourceImageOpacity={sourceImageOpacity}
        onSourceImageOpacityChange={setSourceImageOpacity}
        onImageTransformChange={handleImageTransformChange}
        onPointsChange={handlePointsChange}
        onFingerHolesChange={handleFingerHolesChange}
        onSmoothedChange={handleSmoothedChange}
        onSmoothLevelChange={handleSmoothLevelChange}
        onInteriorRingsChange={handleInteriorRingsChange}
        onAutoRotate={handleAutoRotate}
        autoRotating={autoRotating}
      />
    </div>
  )
}
