'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { generateBinStl, getImageUrl, getProject, listBins, updateProjectSketch } from '@/lib/api'
import type { BinProject, BinSummary, ProjectBinPlacement, ProjectSketch } from '@/types'
import { Alert } from '@/components/Alert'
import { Breadcrumb } from '@/components/Breadcrumb'
import { NumericInput } from '@/components/NumericInput'
import { BIN_DRAG_MIME, DrawerSketchCanvas } from '@/components/DrawerSketchCanvas'
import { DrawerSketch3D } from '@/components/DrawerSketch3D'
import { useDebouncedSave } from '@/hooks/useDebouncedSave'
import { GRID_UNIT } from '@/lib/constants'
import {
  DEFAULT_DRAWER_GRID_X,
  DEFAULT_DRAWER_GRID_Y,
  DRAWER_GRID_MAX,
  DRAWER_GRID_MIN,
  DEFAULT_BIN_COLOR,
  PLACEMENT_COLORS,
  autoArrange,
  binById,
  binFootprint,
  clampToDrawer,
  drawerStats,
  findFreeSpot,
  findLayoutConflicts,
  nextRotation,
  placementRect,
} from '@/lib/drawerLayout'
import { binLabel } from '@/lib/projectSelectors'
import { cn } from '@/lib/utils'
import { AlertTriangle, Box, Check, Copy, Grid2x2, LayoutGrid, Loader2, Palette, Plus, RotateCw, Sparkles, Trash2, X } from 'lucide-react'

type ViewMode = '2d' | '3d'

function ColorSwatches({ value, onChange }: { value: string | null; onChange: (color: string | null) => void }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={cn(
          'w-4 h-4 rounded-full border transition-transform hover:scale-110 cursor-pointer',
          value === null ? 'border-text-primary' : 'border-border-subtle',
        )}
        style={{ backgroundColor: DEFAULT_BIN_COLOR }}
        title="Default colour"
      />
      {PLACEMENT_COLORS.map(color => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          className={cn(
            'w-4 h-4 rounded-full border transition-transform hover:scale-110 cursor-pointer',
            value === color ? 'border-text-primary' : 'border-border-subtle',
          )}
          style={{ backgroundColor: color }}
          title={color}
        />
      ))}
    </div>
  )
}

function newPlacementId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `placement-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function ProjectSketchPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.id as string
  const sketchId = params.sketchId as string

  const [project, setProject] = useState<BinProject | null>(null)
  const [sketch, setSketch] = useState<ProjectSketch | null>(null)
  const [bins, setBins] = useState<BinSummary[]>([])
  const [placements, setPlacements] = useState<ProjectBinPlacement[]>([])
  const [drawerX, setDrawerX] = useState<number | null>(null)
  const [drawerY, setDrawerY] = useState<number | null>(null)
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null)
  const [colorPickerBinId, setColorPickerBinId] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>('2d')
  const [stlUrls, setStlUrls] = useState<Map<string, string>>(new Map())
  const [pendingStlCount, setPendingStlCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const [projectData, allBins] = await Promise.all([getProject(projectId), listBins()])
        const sketchData = projectData.sketches.find(entry => entry.id === sketchId)
        setProject(projectData)
        setBins(allBins.filter(bin => bin.project_id === projectData.id || projectData.bin_ids.includes(bin.id)))
        if (!sketchData) {
          setError('drawer plan not found')
          return
        }
        setSketch(sketchData)
        setPlacements(sketchData.bin_layout)
        setDrawerX(sketchData.target_grid_x)
        setDrawerY(sketchData.target_grid_y)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to load project')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [projectId, sketchId])

  const hasDrawer = drawerX !== null && drawerY !== null
  const gridX = drawerX ?? DEFAULT_DRAWER_GRID_X
  const gridY = drawerY ?? DEFAULT_DRAWER_GRID_Y

  const binMap = useMemo(() => binById(bins), [bins])
  const placementCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const placement of placements) {
      counts.set(placement.bin_id, (counts.get(placement.bin_id) || 0) + 1)
    }
    return counts
  }, [placements])
  const { overlapping, outOfBounds } = useMemo(
    () => findLayoutConflicts(placements, binMap, gridX, gridY),
    [placements, binMap, gridX, gridY],
  )
  const stats = useMemo(() => drawerStats(placements, bins, gridX, gridY), [placements, bins, gridX, gridY])
  const selectedPlacement = placements.find(placement => placement.id === selectedPlacementId) || null

  const { saving, saved } = useDebouncedSave(
    async () => {
      if (!project || !sketch) return
      try {
        await updateProjectSketch(project.id, sketch.id, {
          target_grid_x: drawerX,
          target_grid_y: drawerY,
          bin_layout: placements,
        })
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to save drawer plan')
      }
    },
    [project, sketch, drawerX, drawerY, placements],
    400,
    { skipInitial: true },
  )

  async function handleRename(name: string) {
    if (!project || !sketch) return
    setSketch({ ...sketch, name })
    try {
      const updated = await updateProjectSketch(project.id, sketch.id, { name })
      setSketch(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to rename drawer plan')
    }
  }

  // real bin models for the 3D view; generation is hash-cached server side, so
  // this is a no-op once a bin has been generated with its current config
  const placedBinIds = useMemo(
    () => Array.from(new Set(placements.map(placement => placement.bin_id))).sort(),
    [placements],
  )
  const requestedStlBinIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (view !== '3d') return
    const missing = placedBinIds.filter(binId => !requestedStlBinIds.current.has(binId))
    if (missing.length === 0) return

    let cancelled = false
    missing.forEach(binId => requestedStlBinIds.current.add(binId))
    setPendingStlCount(count => count + missing.length)

    async function generateAll() {
      for (const binId of missing) {
        try {
          const result = await generateBinStl(binId)
          if (cancelled) return
          setStlUrls(prev => new Map(prev).set(binId, `${getImageUrl(result.stl_url)}?v=${Date.now()}`))
        } catch {
          // keep the placeholder block for this bin
          requestedStlBinIds.current.delete(binId)
        } finally {
          if (!cancelled) setPendingStlCount(count => Math.max(0, count - 1))
        }
      }
    }
    generateAll()

    return () => { cancelled = true }
  }, [view, placedBinIds])

  const occupiedRects = useCallback((current: ProjectBinPlacement[], exceptPlacementId?: string) => (
    current
      .filter(placement => placement.id !== exceptPlacementId)
      .flatMap(placement => {
        const bin = binMap.get(placement.bin_id)
        return bin ? [placementRect(placement, bin)] : []
      })
  ), [binMap])

  // a new copy of a bin inherits the highlight its siblings already use
  const colorForBin = useCallback((binId: string) => (
    placements.find(placement => placement.bin_id === binId)?.color ?? null
  ), [placements])

  const handleMove = useCallback((placementId: string, x: number, y: number) => {
    setPlacements(prev => prev.map(placement => (
      placement.id === placementId ? { ...placement, x, y } : placement
    )))
  }, [])

  const handleDropBin = useCallback((binId: string, x: number, y: number) => {
    const placementId = newPlacementId()
    setSelectedPlacementId(placementId)
    setPlacements(prev => [...prev, { id: placementId, bin_id: binId, x, y, rotation: 0, color: null }])
  }, [])

  const handlePlaceInFreeSpot = useCallback((binId: string) => {
    const bin = binMap.get(binId)
    if (!bin) return
    const placementId = newPlacementId()
    setSelectedPlacementId(placementId)
    // the free spot is derived inside the updater so rapid clicks never stack bins
    setPlacements(prev => {
      const spot = findFreeSpot(bin, occupiedRects(prev), gridX, gridY)
      return [...prev, {
        id: placementId,
        bin_id: binId,
        x: spot?.x ?? 0,
        y: spot?.y ?? 0,
        rotation: spot?.rotation ?? 0,
        color: colorForBin(binId),
      }]
    })
  }, [binMap, gridX, gridY, occupiedRects, colorForBin])

  const handleDuplicate = useCallback((placementId: string) => {
    const source = placements.find(placement => placement.id === placementId)
    if (!source) return
    const bin = binMap.get(source.bin_id)
    if (!bin) return
    const copyId = newPlacementId()
    setSelectedPlacementId(copyId)
    setPlacements(prev => {
      const spot = findFreeSpot(bin, occupiedRects(prev), gridX, gridY, { rotation: source.rotation })
      return [...prev, {
        ...source,
        id: copyId,
        x: spot?.x ?? source.x,
        y: spot?.y ?? source.y,
        rotation: spot?.rotation ?? source.rotation,
      }]
    })
  }, [placements, binMap, gridX, gridY, occupiedRects])

  const handleSetColor = useCallback((placementId: string, color: string | null) => {
    setPlacements(prev => prev.map(placement => (
      placement.id === placementId ? { ...placement, color } : placement
    )))
  }, [])

  const handleSetBinColor = useCallback((binId: string, color: string | null) => {
    setPlacements(prev => prev.map(placement => (
      placement.bin_id === binId ? { ...placement, color } : placement
    )))
  }, [])

  const handleRemove = useCallback((placementId: string) => {
    setPlacements(prev => prev.filter(placement => placement.id !== placementId))
    setSelectedPlacementId(prev => (prev === placementId ? null : prev))
  }, [])

  const handleRemoveBin = useCallback((binId: string) => {
    setPlacements(prev => prev.filter(placement => placement.bin_id !== binId))
    setSelectedPlacementId(null)
  }, [])

  const handleRotate = useCallback((placementId: string) => {
    setPlacements(prev => prev.map(placement => {
      if (placement.id !== placementId) return placement
      const bin = binMap.get(placement.bin_id)
      const rotation = nextRotation(placement.rotation)
      if (!bin) return { ...placement, rotation }
      const { w, h } = binFootprint(bin, rotation)
      const clamped = clampToDrawer({ x: placement.x, y: placement.y, w, h }, gridX, gridY)
      return { ...placement, rotation, ...clamped }
    }))
  }, [binMap, gridX, gridY])

  const handleAutoArrange = useCallback(() => {
    setPlacements(prev => {
      const seeded = prev.length > 0
        ? prev
        : bins.map(bin => ({ id: newPlacementId(), bin_id: bin.id, x: 0, y: 0, rotation: 0, color: null }))
      return autoArrange(seeded, binMap, gridX, gridY).placements
    })
    setSelectedPlacementId(null)
  }, [bins, binMap, gridX, gridY])

  const handleEnableDrawer = useCallback(() => {
    setDrawerX(DEFAULT_DRAWER_GRID_X)
    setDrawerY(DEFAULT_DRAWER_GRID_Y)
  }, [])

  const handleDisableDrawer = useCallback(() => {
    setDrawerX(null)
    setDrawerY(null)
    setPlacements([])
    setSelectedPlacementId(null)
  }, [])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!selectedPlacementId) return
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        handleRemove(selectedPlacementId)
      }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        handleRotate(selectedPlacementId)
      }
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        handleDuplicate(selectedPlacementId)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedPlacementId, handleRemove, handleRotate, handleDuplicate])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-text-muted">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Loading drawer plan...</span>
      </div>
    )
  }

  if (!project || !sketch) {
    return (
      <div className="max-w-md mx-auto py-12 space-y-3">
        <Alert variant="error">{error || 'drawer plan not found'}</Alert>
        <button
          type="button"
          onClick={() => router.push(`/projects/${projectId}`)}
          className="btn-secondary w-full px-2 py-1.5 text-[11px]"
        >
          Back to project
        </button>
      </div>
    )
  }

  const conflictCount = overlapping.size + outOfBounds.size
  const selectedBin = selectedPlacement ? binMap.get(selectedPlacement.bin_id) : null

  return (
    <div className="h-[calc(100vh-44px)] flex">
      {/* sidebar: drawer size, space usage, project bins */}
      <div className="w-[240px] flex-shrink-0 bg-surface border-r border-border flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-3 space-y-3">
          <div className="glass rounded-[10px] px-3 py-3">
            <div className="flex items-center gap-2 mb-3">
              <Breadcrumb segments={[
                { label: project.name, href: `/projects/${project.id}` },
                { label: sketch.name, editable: true, onEdit: handleRename },
              ]} />
              {saving && <Loader2 className="w-3 h-3 animate-spin text-text-muted flex-shrink-0" />}
              {saved && <Check className="w-3 h-3 text-green-400 flex-shrink-0" />}
            </div>

            <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-[1.5px] mb-2">Drawer size</h3>
            {hasDrawer ? (
              <div className="space-y-2">
                <label className="text-[11px] text-text-secondary flex items-center justify-between gap-2">
                  Width
                  <NumericInput
                    value={gridX}
                    min={DRAWER_GRID_MIN}
                    max={DRAWER_GRID_MAX}
                    step={0.5}
                    onChange={setDrawerX}
                    className="w-16 px-1.5 py-1 text-[11px] bg-elevated border border-border-subtle rounded-[7px] text-text-primary outline-none focus:border-accent"
                  />
                </label>
                <label className="text-[11px] text-text-secondary flex items-center justify-between gap-2">
                  Depth
                  <NumericInput
                    value={gridY}
                    min={DRAWER_GRID_MIN}
                    max={DRAWER_GRID_MAX}
                    step={0.5}
                    onChange={setDrawerY}
                    className="w-16 px-1.5 py-1 text-[11px] bg-elevated border border-border-subtle rounded-[7px] text-text-primary outline-none focus:border-accent"
                  />
                </label>
                <p className="text-[10px] text-text-muted">
                  {gridX} x {gridY} units · {(gridX * GRID_UNIT).toFixed(0)} x {(gridY * GRID_UNIT).toFixed(0)} mm
                </p>
                <button
                  type="button"
                  onClick={handleDisableDrawer}
                  className="btn-secondary w-full px-2 py-1 text-[11px]"
                >
                  Clear drawer size
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] text-text-secondary">
                  Optional. Set a drawer size to plan where the project bins go.
                </p>
                <button
                  type="button"
                  onClick={handleEnableDrawer}
                  className="btn-primary w-full px-2 py-1.5 text-[11px]"
                >
                  Set drawer size
                </button>
              </div>
            )}
          </div>

          {hasDrawer && (
            <div className="glass rounded-[10px] px-3 py-3">
              <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-[1.5px] mb-2">Space usage</h3>
              <div className="text-[11px] text-text-secondary space-y-0.5">
                <div className="flex justify-between"><span>Used</span><span>{stats.usedUnits} / {stats.drawerUnits} units</span></div>
                <div className="flex justify-between"><span>Free</span><span>{stats.freeUnits} units</span></div>
                <div className="flex justify-between"><span>Placements</span><span>{stats.placementCount}</span></div>
              </div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-elevated overflow-hidden">
                <div className="h-full bg-accent" style={{ width: `${Math.min(100, stats.coverage * 100)}%` }} />
              </div>
              {conflictCount > 0 && (
                <p className="mt-2 text-[10px] text-amber-500 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                  {[
                    overlapping.size > 0 ? `${overlapping.size} overlapping` : null,
                    outOfBounds.size > 0 ? `${outOfBounds.size} outside drawer` : null,
                  ].filter(Boolean).join(' · ')}
                </p>
              )}
              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  onClick={handleAutoArrange}
                  disabled={bins.length === 0}
                  className="btn-secondary flex-1 px-2 py-1 text-[11px] inline-flex items-center justify-center gap-1"
                  title="Repack the current placements, largest bin first"
                >
                  <Sparkles className="w-3 h-3" />
                  Auto arrange
                </button>
                <button
                  type="button"
                  onClick={() => { setPlacements([]); setSelectedPlacementId(null) }}
                  disabled={placements.length === 0}
                  className="btn-secondary px-2 py-1 text-[11px]"
                  title="Remove all bins from the drawer"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}

          <div className="glass rounded-[10px] px-3 py-3">
            <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-[1.5px] mb-2">
              Project bins ({bins.length})
            </h3>
            {bins.length === 0 ? (
              <p className="text-[11px] text-text-muted">
                No bins in this project yet. Create bins on the project page first.
              </p>
            ) : (
              <div className="space-y-1.5">
                {bins.map(bin => {
                  const count = placementCounts.get(bin.id) || 0
                  const binColor = colorForBin(bin.id)
                  const colorsOpen = colorPickerBinId === bin.id
                  return (
                    <div
                      key={bin.id}
                      draggable={hasDrawer}
                      onDragStart={e => {
                        e.dataTransfer.setData(BIN_DRAG_MIME, bin.id)
                        e.dataTransfer.effectAllowed = 'copy'
                      }}
                      className={cn(
                        'glass-sm rounded-[7px] px-2 py-1.5 border border-transparent',
                        hasDrawer ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1">
                          <span className="block text-[11px] text-text-primary truncate">{binLabel(bin)}</span>
                          <span className="block text-[10px] text-text-muted truncate">
                            {bin.grid_x}x{bin.grid_y} · {bin.height_units}u · {bin.tool_count} tool{bin.tool_count !== 1 ? 's' : ''}
                            {bin.half_grid_base ? ' · ½ grid' : ''}
                          </span>
                        </span>
                        {count > 0 && (
                          <span
                            className="text-[10px] text-accent bg-accent-muted rounded-full px-1.5 py-px flex-shrink-0"
                            title={`${count} placed in the drawer`}
                          >
                            {count}x
                          </span>
                        )}
                        {hasDrawer && (
                          <span className="flex items-center gap-0.5 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => setColorPickerBinId(prev => (prev === bin.id ? null : bin.id))}
                              className={cn(
                                'p-0.5 rounded-[7px] transition-colors cursor-pointer',
                                colorsOpen ? 'text-accent' : 'text-text-muted hover:text-accent',
                              )}
                              title="Highlight colour"
                            >
                              <Palette className="w-3 h-3" style={binColor ? { color: binColor } : undefined} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePlaceInFreeSpot(bin.id)}
                              className="p-0.5 text-text-muted hover:text-accent rounded-[7px] transition-colors cursor-pointer"
                              title="Place another copy in the first free spot"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                            {count > 0 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveBin(bin.id)}
                                className="p-0.5 text-text-muted hover:text-accent rounded-[7px] transition-colors cursor-pointer"
                                title="Remove all copies from the drawer"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </span>
                        )}
                      </div>
                      {colorsOpen && (
                        <div className="mt-1.5 pt-1.5 border-t border-border-subtle">
                          <ColorSwatches
                            value={binColor}
                            onChange={color => handleSetBinColor(bin.id, color)}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div className="p-3 flex-shrink-0 space-y-1.5">
          {error && <Alert variant="error">{error}</Alert>}
          <button
            type="button"
            onClick={() => router.push(`/projects/${project.id}`)}
            className="btn-secondary w-full px-2 py-1.5 text-[11px]"
          >
            Back to project
          </button>
        </div>
      </div>

      {/* main: 2D / 3D drawer view */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex-shrink-0 bg-surface border-b border-border px-3 py-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            {([['2d', '2D top down', LayoutGrid], ['3d', '3D', Box]] as const).map(([mode, label, Icon]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                className={cn(
                  'rounded-[7px] px-2.5 py-1 text-[11px] flex items-center gap-1.5 transition-colors cursor-pointer',
                  view === mode ? 'bg-accent-muted text-accent' : 'glass-sm text-text-secondary hover:bg-glass-hover',
                )}
              >
                <Icon className="w-3 h-3" />
                {label}
              </button>
            ))}
            {view === '3d' && pendingStlCount > 0 && (
              <span className="ml-1 text-[10px] text-text-muted inline-flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                Generating {pendingStlCount} model{pendingStlCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <p className="text-[11px] text-text-muted truncate">
            {hasDrawer
              ? 'Drag bins in · drag to move · R rotates · D duplicates · Delete removes'
              : 'Set a drawer size to start planning'}
          </p>
        </div>

        <div className="flex-1 min-h-0 relative bg-inset">
          {!hasDrawer ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-text-muted">
              <Grid2x2 className="w-8 h-8" />
              <p className="text-xs">No drawer size set for this project.</p>
              <button type="button" onClick={handleEnableDrawer} className="btn-primary px-3 py-1.5 text-xs">
                Set drawer size
              </button>
            </div>
          ) : view === '2d' ? (
            <DrawerSketchCanvas
              bins={binMap}
              placements={placements}
              drawerX={gridX}
              drawerY={gridY}
              selectedPlacementId={selectedPlacementId}
              overlapping={overlapping}
              outOfBounds={outOfBounds}
              onSelect={setSelectedPlacementId}
              onMove={handleMove}
              onDropBin={handleDropBin}
            />
          ) : (
            <DrawerSketch3D
              bins={binMap}
              placements={placements}
              drawerX={gridX}
              drawerY={gridY}
              selectedPlacementId={selectedPlacementId}
              overlapping={overlapping}
              outOfBounds={outOfBounds}
              stlUrls={stlUrls}
              onSelect={setSelectedPlacementId}
            />
          )}

          {/* floating controls for the selected placement */}
          {hasDrawer && selectedPlacement && selectedBin && (
            <div className="absolute bottom-3.5 left-3.5 z-20 glass-toolbar px-3 py-2 flex items-center gap-2">
              <span className="text-[11px] text-text-secondary truncate max-w-[200px]">
                {binLabel(selectedBin)}
              </span>
              <span className="text-[10px] text-text-muted">
                {selectedPlacement.x} / {selectedPlacement.y} · {selectedPlacement.rotation}°
              </span>
              <button
                type="button"
                onClick={() => handleRotate(selectedPlacement.id)}
                className="p-1 text-text-muted hover:text-accent rounded-[7px] transition-colors cursor-pointer"
                title="Rotate 90 degrees (R)"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleDuplicate(selectedPlacement.id)}
                className="p-1 text-text-muted hover:text-accent rounded-[7px] transition-colors cursor-pointer"
                title="Duplicate (D)"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleRemove(selectedPlacement.id)}
                className="btn-danger-icon"
                title="Remove from drawer (Delete)"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <span className="w-px h-4 bg-border-subtle" />
              <ColorSwatches
                value={selectedPlacement.color}
                onChange={color => handleSetColor(selectedPlacement.id, color)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
