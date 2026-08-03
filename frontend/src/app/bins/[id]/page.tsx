'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { BinEditor } from '@/components/BinEditor'
import { BinConfigurator, calcMaxCutoutDepth } from '@/components/BinConfigurator'
import { BinPreview3D } from '@/components/BinPreview3D'
import { ToolBrowser } from '@/components/ToolBrowser'
import { getBin, updateBin, generateBinStl, getBinStlUrl, getBinZipUrl, getBinThreemfUrl, getBinInsertUrl, getImageUrl, listTools, updateTool } from '@/lib/api'
import { buildBinConfig, createPartialBinsValues, getDefaultBinConfig, resetDefaultBinConfig, saveDefaultBinConfig } from '@/lib/binDefaults'
import type { BinConfig, BinData, PlacedTool, TextLabel } from '@/types'
import { Download, Loader2, Package, ChevronDown, Check } from 'lucide-react'
import { Breadcrumb } from '@/components/Breadcrumb'
import { Alert } from '@/components/Alert'
import { useDebouncedSave } from '@/hooks/useDebouncedSave'
import { useProjectSource } from '@/hooks/useProjectSource'
import { GRID_UNIT } from '@/lib/constants'
import { useTheme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'

function InfoBanner({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme()
  return (
    <div className={cn("text-[10px] rounded px-2 py-1", theme === 'dark' ? 'bg-amber-900/20 border border-amber-800/50 text-amber-400' : 'bg-amber-500/20 border border-amber-400/50 text-amber-600')}>
      {children}
    </div>
  )
}

export default function BinPage() {
  const router = useRouter()
  const params = useParams()
  const binId = params.id as string
  const projectSource = useProjectSource('Bins')

  const [binData, setBinData] = useState<BinData | null>(null)
  const [placedTools, setPlacedTools] = useState<PlacedTool[]>([])
  const [textLabels, setTextLabels] = useState<TextLabel[]>([])
  const [config, setConfig] = useState<BinConfig>(() => getDefaultBinConfig())
  const [name, setName] = useState('')
  const [stlUrl, setStlUrl] = useState<string | null>(null)
  const [stlUrls, setStlUrls] = useState<string[]>([])
  const [threemfUrl, setThreemfUrl] = useState<string | null>(null)
  const [zipUrl, setZipUrl] = useState<string | null>(null)
  const [insertStlUrl, setInsertStlUrl] = useState<string | null>(null)
  const [splitCount, setSplitCount] = useState(1)
  const [stlVersion, setStlVersion] = useState(0)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const generateTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastGenerateRef = useRef<string>('')
  const generatingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const doGenerateRef = useRef<() => void>(() => {})
  const [smoothedToolIds, setSmoothedToolIds] = useState<Set<string>>(new Set())
  const [smoothLevels, setSmoothLevels] = useState<Map<string, number>>(new Map())
  const smoothLevelTimerRef = useRef<NodeJS.Timeout | null>(null)

  const [autoSize, setAutoSize] = useState(true)
  const [isDragging, setIsDragging] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [defaultsStatus, setDefaultsStatus] = useState<string | null>(null)
  const defaultsStatusTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const exportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!exportOpen) return
    function handleClick(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [exportOpen])

  useEffect(() => {
    async function load() {
      try {
        const [data, tools] = await Promise.all([getBin(binId), listTools()])
        setBinData(data)

        const toolMap = new Map(tools.map(t => [t.id, t]))
        const synced = data.placed_tools.map(pt => {
          const lib = toolMap.get(pt.tool_id)
          if (!lib) return pt
          const rad = (pt.rotation || 0) * Math.PI / 180
          const cos = Math.cos(rad)
          const sin = Math.sin(rad)
          const n = pt.points.length || 1
          const cx = pt.points.reduce((s, p) => s + p.x, 0) / n
          const cy = pt.points.reduce((s, p) => s + p.y, 0) / n
          const newRings = (lib.interior_rings ?? []).map(ring =>
            ring.map(p => ({
              x: p.x * cos - p.y * sin + cx,
              y: p.x * sin + p.y * cos + cy,
            }))
          )
          return { ...pt, interior_rings: newRings }
        })
        setPlacedTools(synced)
        setTextLabels(data.text_labels)
        setName(data.name || '')
        setConfig(buildBinConfig(data.bin_config));
        setSmoothedToolIds(new Set(tools.filter(t => t.smoothed).map(t => t.id)))
        setSmoothLevels(new Map(tools.map(t => [t.id, t.smooth_level])))
      } catch {
        setError('Bin not found')
      } finally {
        setLoading(false)
        setTimeout(() => doGenerateRef.current(), 100)
      }
    }
    load()
  }, [binId])

  const doGenerate = useCallback(async () => {
    const key = JSON.stringify({ placedTools, config, textLabels, smoothed: [...smoothedToolIds], levels: [...smoothLevels] })
    if (key === lastGenerateRef.current) return

    if (abortRef.current) {
      abortRef.current.abort()
    }

    lastGenerateRef.current = key
    generatingRef.current = true
    setGenerating(true)
    setError(null)
    setWarning(null)
    setStlUrl(null)
    setStlUrls([])
    setThreemfUrl(null)
    setZipUrl(null)
    setInsertStlUrl(null)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const result = await generateBinStl(binId, controller.signal)
      setStlUrl(getImageUrl(result.stl_url))
      setStlUrls((result.stl_urls || []).map(u => getImageUrl(u)))
      setThreemfUrl(result.threemf_url ? getImageUrl(result.threemf_url) : null)
      setZipUrl(result.zip_url ? getImageUrl(result.zip_url) : null)
      setInsertStlUrl(result.insert_stl_url ? getImageUrl(result.insert_stl_url) : null)
      setSplitCount(result.split_count || 1)
      setStlVersion(v => v + 1)
      setWarning(result.warning || null)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'generation failed')
    } finally {
      if (abortRef.current === controller) {
        generatingRef.current = false
        setGenerating(false)
        abortRef.current = null
      }
    }
  }, [binId, placedTools, config, textLabels, smoothedToolIds, smoothLevels])

  useEffect(() => {
    doGenerateRef.current = doGenerate
  }, [doGenerate])

  const { saving, saved } = useDebouncedSave(
    () => {
      if (!binData) return
      updateBin(binId, {
        name: name || undefined,
        bin_config: config,
        placed_tools: placedTools,
        text_labels: textLabels,
      }).catch(() => {})
    },
    [binData, binId, name, config, placedTools, textLabels],
    150,
    { skipInitial: true }
  )

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (defaultsStatusTimeoutRef.current) clearTimeout(defaultsStatusTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (!binData) return
    if (generateTimeoutRef.current) clearTimeout(generateTimeoutRef.current)
    generateTimeoutRef.current = setTimeout(() => {
      doGenerate()
    }, 1000)
    return () => {
      if (generateTimeoutRef.current) clearTimeout(generateTimeoutRef.current)
    }
  }, [binData, placedTools, config, textLabels, smoothedToolIds, smoothLevels, doGenerate])

  const handlePlacedToolsChange = useCallback((updated: PlacedTool[]) => {
    setPlacedTools(updated)
  }, [])

  // auto-size: fit grid to bounding box of all placed tools, recentre if grid changes
  useEffect(() => {
    if (!autoSize || isDragging || placedTools.length === 0) return
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const tool of placedTools) {
      for (const p of tool.points) {
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }
    }
    const halfMargin = config.wall_thickness + config.cutout_clearance + 0.25
    const toolW = maxX - minX
    const toolH = maxY - minY
    const snap = config.half_grid_base ? 0.5 : 1.0;
    const snapUnit = GRID_UNIT * snap;
    const needX = Math.max(1, Math.ceil((toolW + 2 * halfMargin) / snapUnit) * snap);
    const needY = Math.max(1, Math.ceil((toolH + 2 * halfMargin) / snapUnit) * snap);

    const gridChanged = config.grid_x !== needX || config.grid_y !== needY
    if (gridChanged) {
        setConfig((prev) => ({
            ...prev,
            grid_x: needX,
            grid_y: needY,
            partial_bins_values: createPartialBinsValues(needX, needY),
        }));
    }

    // recentre tools if grid changed or tools are off-centre
    const binW = (gridChanged ? needX : config.grid_x) * GRID_UNIT
    const binH = (gridChanged ? needY : config.grid_y) * GRID_UNIT
    const toolCx = (minX + maxX) / 2
    const toolCy = (minY + maxY) / 2
    const dx = binW / 2 - toolCx
    const dy = binH / 2 - toolCy
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      setPlacedTools(prev => prev.map(tool => ({
        ...tool,
        points: tool.points.map(p => ({ x: p.x + dx, y: p.y + dy })),
        finger_holes: tool.finger_holes.map(fh => ({ ...fh, x: fh.x + dx, y: fh.y + dy })),
        interior_rings: (tool.interior_rings ?? []).map(ring =>
          ring.map(p => ({ x: p.x + dx, y: p.y + dy }))
        ),
      })))
    }
  }, [autoSize, isDragging, placedTools, config.grid_x, config.grid_y, config.wall_thickness, config.cutout_clearance, config.half_grid_base])

  const handleToggleSmoothed = useCallback(async (toolId: string, smoothed: boolean) => {
    try {
      await updateTool(toolId, { smoothed })
      setSmoothedToolIds(prev => {
        const next = new Set(prev)
        if (smoothed) next.add(toolId)
        else next.delete(toolId)
        return next
      })
    } catch { /* ignore */ }
  }, [])

  const handleSmoothLevelChange = useCallback((toolId: string, level: number) => {
    setSmoothLevels(prev => new Map(prev).set(toolId, level))
    if (smoothLevelTimerRef.current) clearTimeout(smoothLevelTimerRef.current)
    smoothLevelTimerRef.current = setTimeout(() => {
      updateTool(toolId, { smooth_level: level }).catch(() => {})
    }, 300)
  }, [])

  const handleAddTool = useCallback((tool: PlacedTool) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of tool.points) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
    const toolW = maxX - minX
    const toolH = maxY - minY

    const margin = 2 * config.wall_thickness + 2 * config.cutout_clearance + 0.5;
    const snap = config.half_grid_base ? 0.5 : 1.0;
    const snapUnit = GRID_UNIT * snap;
    const needX = Math.max(config.grid_x, Math.ceil((toolW + margin) / snapUnit) * snap);
    const needY = Math.max(config.grid_y, Math.ceil((toolH + margin) / snapUnit) * snap);

    if (needX !== config.grid_x || needY !== config.grid_y) {
        setConfig((prev) => ({
            ...prev,
            grid_x: needX,
            grid_y: needY,
            partial_bins_values: createPartialBinsValues(needX, needY),
        }));
    }

    // always centre the tool in the bin
    const binW = needX * GRID_UNIT
    const binH = needY * GRID_UNIT
    const toolCx = (minX + maxX) / 2
    const toolCy = (minY + maxY) / 2
    const dx = binW / 2 - toolCx
    const dy = binH / 2 - toolCy
    const placed = {
      ...tool,
      points: tool.points.map(p => ({ x: p.x + dx, y: p.y + dy })),
      finger_holes: tool.finger_holes.map(fh => ({ ...fh, x: fh.x + dx, y: fh.y + dy })),
      interior_rings: (tool.interior_rings ?? []).map(ring =>
        ring.map(p => ({ x: p.x + dx, y: p.y + dy }))
      ),
    }

    setPlacedTools(prev => [...prev, placed])
  }, [config.grid_x, config.grid_y, config.wall_thickness, config.cutout_clearance, config.half_grid_base])

  function handleDownload() {
    window.open(getBinStlUrl(binId), '_blank')
  }

  function handleDownloadZip() {
    window.open(getBinZipUrl(binId), '_blank')
  }

  function handleDownloadThreemf() {
    window.open(getBinThreemfUrl(binId), '_blank')
  }

  function handleDownloadInsert() {
    window.open(getBinInsertUrl(binId), '_blank')
  }

  function showDefaultsStatus(message: string) {
    if (defaultsStatusTimeoutRef.current) clearTimeout(defaultsStatusTimeoutRef.current)
    setDefaultsStatus(message)
    defaultsStatusTimeoutRef.current = setTimeout(() => {
      setDefaultsStatus(null)
      defaultsStatusTimeoutRef.current = null
    }, 2500)
  }

  function handleSaveDefaults() {
    saveDefaultBinConfig(config)
    showDefaultsStatus('Defaults saved')
  }

  function handleResetDefaults() {
    setConfig(resetDefaultBinConfig())
    showDefaultsStatus('Defaults reset')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-text-muted">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Loading bin...</span>
      </div>
    )
  }

  if (error && !binData) {
    return (
      <div className="max-w-md mx-auto py-12">
        <Alert variant="error">{error}</Alert>
      </div>
    )
  }

  const stlUrlWithVersion = stlUrl ? `${stlUrl}?v=${stlVersion}` : null
  const splitUrlsWithVersion = stlUrls.length > 0 ? stlUrls.map(u => `${u}?v=${stlVersion}`) : null
  const insertUrlWithVersion = insertStlUrl ? `${insertStlUrl}?v=${stlVersion}` : null
  const binW = config.grid_x * GRID_UNIT
  const binH = config.grid_y * GRID_UNIT
  const effectiveRimUnits = config.stacking_lip ? config.rim_units : 0
  const hasExports = stlUrl || zipUrl || threemfUrl || insertStlUrl

  return (
    <div className="h-[calc(100vh-44px)] flex">
      {/* config sidebar - always open */}
      <div className="w-[200px] flex-shrink-0 bg-surface border-r border-border flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-3 space-y-3">
          <div className="glass rounded-[10px] px-3 py-3">
            <div className="flex items-center gap-2 mb-3">
              <Breadcrumb segments={[
                { label: projectSource.rootLabel, href: projectSource.rootHref },
                { label: name || 'Untitled', editable: true, onEdit: (v) => setName(v) },
              ]} />
              {saving && <Loader2 className="w-3 h-3 animate-spin text-text-muted flex-shrink-0" />}
              {saved && <Check className="w-3 h-3 text-green-400 flex-shrink-0" />}
            </div>
            <BinConfigurator config={config} onChange={setConfig} autoSize={autoSize} onAutoSizeChange={setAutoSize} />
            <div className="mt-3 border-t border-border pt-3 space-y-1.5">
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={handleSaveDefaults}
                  className="btn-secondary flex-1 px-2 py-1.5 text-[11px]"
                >
                  Save as default
                </button>
                <button
                  type="button"
                  onClick={handleResetDefaults}
                  className="btn-secondary px-2 py-1.5 text-[11px]"
                  title="Reset this bin and saved defaults"
                >
                  Reset
                </button>
              </div>
              {defaultsStatus && (
                <p className="text-[10px] text-text-muted">{defaultsStatus}</p>
              )}
            </div>
          </div>

          <div className="glass rounded-[10px] px-3 py-3">
            <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-[1.5px] mb-2">Dimensions</h3>
            <div className="text-[11px] text-text-secondary space-y-0.5">
              <div className="flex justify-between"><span>Width</span><span>{binW} mm</span></div>
              <div className="flex justify-between"><span>Depth</span><span>{binH} mm</span></div>
              <div className="flex justify-between"><span>Height</span><span>{(config.height_units * 7 + 5 + effectiveRimUnits * 7 + (config.stacking_lip ? 4.4 : 0)).toFixed(1)} mm</span></div>
            </div>
          </div>
        </div>

        {/* export buttons */}
        <div className="p-3 flex-shrink-0 space-y-1.5">
          {error && <Alert variant="error">{error}</Alert>}
          {warning && (
            <InfoBanner>{warning}</InfoBanner>
          )}
          {splitCount > 1 && (
            <InfoBanner>Split into {splitCount} pieces</InfoBanner>
          )}
          {hasExports && (
            <div className="relative" ref={exportRef}>
              <button
                onClick={() => setExportOpen(p => !p)}
                className="btn-primary w-full py-2 text-[11px] font-medium inline-flex items-center justify-center gap-1 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Export
                <ChevronDown className="w-3 h-3" />
              </button>
              {exportOpen && (
                <div className="absolute bottom-full left-0 right-0 mb-1.5 bg-surface border border-border rounded-lg py-1 z-30 shadow-xl">
                  {stlUrl && (
                    <button
                      onClick={() => { handleDownload(); setExportOpen(false) }}
                      className="w-full text-left px-3 py-1.5 text-[11px] text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer flex items-center gap-2"
                    >
                      <Package className="w-3 h-3" />
                      {zipUrl ? 'Full STL' : 'STL'}
                    </button>
                  )}
                  {zipUrl && (
                    <button
                      onClick={() => { handleDownloadZip(); setExportOpen(false) }}
                      className="w-full text-left px-3 py-1.5 text-[11px] text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer flex items-center gap-2"
                    >
                      <Package className="w-3 h-3" />
                      ZIP ({splitCount} parts)
                    </button>
                  )}
                  {threemfUrl && (
                    <button
                      onClick={() => { handleDownloadThreemf(); setExportOpen(false) }}
                      className="w-full text-left px-3 py-1.5 text-[11px] text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer flex items-center gap-2"
                    >
                      <Package className="w-3 h-3" />
                      3MF
                    </button>
                  )}
                  {insertStlUrl && (
                    <button
                      onClick={() => { handleDownloadInsert(); setExportOpen(false) }}
                      className="w-full text-left px-3 py-1.5 text-[11px] text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer flex items-center gap-2"
                    >
                      <Package className="w-3 h-3" />
                      Insert STL
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* right of sidebar: library on top, then canvas + 3D preview below */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* library strip - full width */}
        <div className="flex-shrink-0 bg-surface border-b border-border px-3 py-2">
          <ToolBrowser
            onAddTool={handleAddTool}
            binWidthMm={binW}
            binHeightMm={binH}
            layout="horizontal"
            projectId={projectSource.projectId}
            currentToolIds={placedTools.map(tool => tool.tool_id)}
          />
        </div>

        {/* canvas + 3D preview side by side, equal width */}
        <div className="flex-1 min-h-0 flex">
          {/* canvas */}
          <div className="flex-1 min-w-0 relative bg-inset overflow-hidden" data-testid="bin-editor">
            <div className="absolute inset-0">
              <BinEditor
                placedTools={placedTools}
                onPlacedToolsChange={handlePlacedToolsChange}
                textLabels={textLabels}
                onTextLabelsChange={setTextLabels}
                gridX={config.grid_x}
                gridY={config.grid_y}
                partialBins={config.partial_bins}
                partialBinsValues={config.partial_bins_values}
                wallThickness={config.wall_thickness}
                defaultCutoutDepth={config.cutout_depth}
                maxCutoutDepth={calcMaxCutoutDepth(config.height_units, config.stacking_lip)}
                halfGridBase={config.half_grid_base}
                onEditTool={(toolId) => router.push(projectSource.scopedHref(`/tools/${toolId}`))}
                smoothedToolIds={smoothedToolIds}
                onToggleSmoothed={handleToggleSmoothed}
                smoothLevels={smoothLevels}
                onSmoothLevelChange={handleSmoothLevelChange}
                onDraggingChange={setIsDragging}
              />
            </div>

            {/* floating bottom bar */}
            <div className="absolute bottom-3.5 left-3.5 right-3.5 z-20 glass-toolbar px-3 py-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[11px] text-text-muted">
                {generating && <Loader2 className="w-3 h-3 animate-spin text-accent" />}
                <span>{config.grid_x}x{config.grid_y} Grid ({binW} x {binH} mm)</span>
                {placedTools.length > 0 ? (
                  <span>· {placedTools.length} tool{placedTools.length !== 1 ? 's' : ''} placed</span>
                ) : (
                  <span>· blank bin</span>
                )}
              </div>
            </div>

            {error && (
              <div className="absolute top-14 left-3.5 z-20 max-w-sm">
                <Alert variant="error">{error}</Alert>
              </div>
            )}
          </div>

          {/* 3D preview - same width as canvas */}
          <div className="flex-1 min-w-0 bg-surface border-l border-border flex flex-col">
            <div className="px-3 py-2 border-b border-border flex-shrink-0">
              <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-[1.5px]">3D Preview</h3>
            </div>
            <div className="flex-1 min-h-0 relative bg-inset">
              {generating && (
                <div className="absolute inset-x-0 bottom-0 z-10">
                  <div className="h-1 w-full overflow-hidden bg-blue-950">
                    <div className="h-full w-1/3 bg-blue-500 rounded-full animate-[slide_1.2s_ease-in-out_infinite]" />
                  </div>
                </div>
              )}
              {stlUrlWithVersion ? (
                <BinPreview3D stlUrl={stlUrlWithVersion} splitUrls={splitUrlsWithVersion || undefined} insertUrl={insertUrlWithVersion || undefined} />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-text-muted text-xs gap-2">
                  {generating ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                      <span>Generating...</span>
                    </>
                  ) : (
                    <span>Preview will appear here</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
