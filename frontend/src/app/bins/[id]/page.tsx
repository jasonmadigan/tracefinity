'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { BinEditor } from '@/components/BinEditor'
import { BinConfigurator } from '@/components/BinConfigurator'
import { BinPreview3D } from '@/components/BinPreview3D'
import { ToolBrowser } from '@/components/ToolBrowser'
import { getBin, updateBin, generateBinStl, getBinStlUrl, getBinZipUrl, getBinThreemfUrl, getImageUrl, listTools, updateTool } from '@/lib/api'
import { getSettings } from '@/lib/settings'
import type { BinConfig, BinData, PlacedTool, TextLabel } from '@/types'
import { Download, Loader2, Package, ArrowLeft } from 'lucide-react'
import { Alert } from '@/components/Alert'

const GRID_UNIT = 42

function defaultConfig(): BinConfig {
  return {
    grid_x: 2,
    grid_y: 2,
    height_units: 4,
    magnets: true,
    stacking_lip: true,
    wall_thickness: 1.6,
    cutout_depth: 20,
    cutout_clearance: 1.0,
    text_labels: [],
    bed_size: getSettings().bedSize,
  }
}

export default function BinPage() {
  const router = useRouter()
  const params = useParams()
  const binId = params.id as string

  const [binData, setBinData] = useState<BinData | null>(null)
  const [placedTools, setPlacedTools] = useState<PlacedTool[]>([])
  const [textLabels, setTextLabels] = useState<TextLabel[]>([])
  const [config, setConfig] = useState<BinConfig>(defaultConfig)
  const [name, setName] = useState('')
  const [stlUrl, setStlUrl] = useState<string | null>(null)
  const [stlUrls, setStlUrls] = useState<string[]>([])
  const [threemfUrl, setThreemfUrl] = useState<string | null>(null)
  const [zipUrl, setZipUrl] = useState<string | null>(null)
  const [splitCount, setSplitCount] = useState(1)
  const [stlVersion, setStlVersion] = useState(0)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generateTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastGenerateRef = useRef<string>('')
  const generatingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const doGenerateRef = useRef<() => void>(() => {})
  const initialLoadRef = useRef(true)
  const [smoothedToolIds, setSmoothedToolIds] = useState<Set<string>>(new Set())
  const [smoothLevels, setSmoothLevels] = useState<Map<string, number>>(new Map())
  const smoothLevelTimerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const [data, tools] = await Promise.all([getBin(binId), listTools()])
        setBinData(data)
        setPlacedTools(data.placed_tools)
        setTextLabels(data.text_labels)
        setName(data.name || '')
        setConfig(data.bin_config)
        setSmoothedToolIds(new Set(tools.filter(t => t.smoothed).map(t => t.id)))
        setSmoothLevels(new Map(tools.map(t => [t.id, t.smooth_level])))
      } catch {
        setError('Bin not found')
      } finally {
        setLoading(false)
        setTimeout(() => {
          initialLoadRef.current = false
          doGenerateRef.current()
        }, 100)
      }
    }
    load()
  }, [binId])

  const doGenerate = useCallback(async () => {
    if (placedTools.length === 0) return

    const key = JSON.stringify({ placedTools, config, textLabels, smoothed: [...smoothedToolIds], levels: [...smoothLevels] })
    if (key === lastGenerateRef.current) return

    // abort any in-flight request
    if (abortRef.current) {
      abortRef.current.abort()
    }

    lastGenerateRef.current = key
    generatingRef.current = true
    setGenerating(true)
    setError(null)
    setStlUrl(null)
    setStlUrls([])
    setThreemfUrl(null)
    setZipUrl(null)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const result = await generateBinStl(binId, controller.signal)
      setStlUrl(getImageUrl(result.stl_url))
      setStlUrls((result.stl_urls || []).map(u => getImageUrl(u)))
      setThreemfUrl(result.threemf_url ? getImageUrl(result.threemf_url) : null)
      setZipUrl(result.zip_url ? getImageUrl(result.zip_url) : null)
      setSplitCount(result.split_count || 1)
      setStlVersion(v => v + 1)
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

  // save on any change (short debounce to batch drag events, flush on unload)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingSaveRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!binData || initialLoadRef.current) return
    const doSave = () => {
      updateBin(binId, {
        name: name || undefined,
        bin_config: config,
        placed_tools: placedTools,
        text_labels: textLabels,
      }).catch(() => {})
    }
    pendingSaveRef.current = doSave
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      pendingSaveRef.current = null
      doSave()
    }, 150)
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    }
  }, [binData, binId, name, config, placedTools, textLabels])

  // flush pending save on page unload
  useEffect(() => {
    const flush = () => { pendingSaveRef.current?.() }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  // abort in-flight STL generation on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [])

  // debounce only the STL generation
  useEffect(() => {
    if (!binData || initialLoadRef.current) return
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

    // account for walls, clearance, and gridfinity grid inset
    const margin = 2 * config.wall_thickness + 2 * config.cutout_clearance + 0.5
    const needX = Math.max(config.grid_x, Math.ceil((toolW + margin) / GRID_UNIT))
    const needY = Math.max(config.grid_y, Math.ceil((toolH + margin) / GRID_UNIT))

    let placed = tool
    if (needX !== config.grid_x || needY !== config.grid_y) {
      const newBinW = needX * GRID_UNIT
      const newBinH = needY * GRID_UNIT
      const toolCx = (minX + maxX) / 2
      const toolCy = (minY + maxY) / 2
      const dx = newBinW / 2 - toolCx
      const dy = newBinH / 2 - toolCy
      placed = {
        ...tool,
        points: tool.points.map(p => ({ x: p.x + dx, y: p.y + dy })),
        finger_holes: tool.finger_holes.map(fh => ({ ...fh, x: fh.x + dx, y: fh.y + dy })),
        interior_rings: (tool.interior_rings ?? []).map(ring =>
          ring.map(p => ({ x: p.x + dx, y: p.y + dy }))
        ),
      }
      setConfig(prev => ({ ...prev, grid_x: needX, grid_y: needY }))
    }

    setPlacedTools(prev => [...prev, placed])
  }, [config.grid_x, config.grid_y])

  function handleDownload() {
    window.open(getBinStlUrl(binId), '_blank')
  }

  function handleDownloadZip() {
    window.open(getBinZipUrl(binId), '_blank')
  }

  function handleDownloadThreemf() {
    window.open(getBinThreemfUrl(binId), '_blank')
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

  return (
    <div className="h-[calc(100vh-53px)] flex flex-col md:flex-row w-full">
      {/* left sidebar */}
      <div className="md:w-[260px] md:flex-shrink-0 bg-surface border-b md:border-b-0 md:border-r border-border flex flex-col max-h-[45vh] md:max-h-none">
        <div className="px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => router.push('/')}
              className="p-1 rounded hover:bg-elevated text-text-muted"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onBlur={() => {
                if (name !== binData?.name) {
                  updateBin(binId, { name }).catch(() => {})
                }
              }}
              className="text-sm font-medium text-text-primary bg-elevated border border-border-subtle rounded px-2 py-1 outline-none focus:border-blue-500 flex-1 min-w-0"
              placeholder="Untitled bin"
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Bin Config</h3>
            <BinConfigurator config={config} onChange={setConfig} />
          </div>

          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Tool Library</h3>
            <ToolBrowser
              onAddTool={handleAddTool}
              binWidthMm={config.grid_x * GRID_UNIT}
              binHeightMm={config.grid_y * GRID_UNIT}
            />
          </div>

          <div className="px-4 py-3">
            <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Actual Size</h3>
            <div className="text-xs text-text-secondary space-y-0.5">
              <div className="flex justify-between">
                <span>Width</span>
                <span>{config.grid_x * GRID_UNIT} mm</span>
              </div>
              <div className="flex justify-between">
                <span>Depth</span>
                <span>{config.grid_y * GRID_UNIT} mm</span>
              </div>
              <div className="flex justify-between">
                <span>Height</span>
                <span>{(config.height_units * 7 + 5 + (config.stacking_lip ? 4.4 : 0)).toFixed(1)} mm</span>
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-border flex-shrink-0 space-y-2">
          {error && <Alert variant="error">{error}</Alert>}

          {splitCount > 1 && (
            <div className="text-xs text-amber-400 bg-amber-900/20 border border-amber-800/50 rounded px-2 py-1.5">
              Split into {splitCount} pieces to fit {config.bed_size}mm bed
            </div>
          )}

          {zipUrl ? (
            <button
              onClick={handleDownloadZip}
              disabled={generating}
              className="btn-primary w-full py-2 inline-flex items-center justify-center gap-1.5 text-sm"
            >
              <Package className="w-3.5 h-3.5" />
              Export ZIP ({splitCount} parts)
            </button>
          ) : stlUrl ? (
            <button
              onClick={handleDownload}
              disabled={generating}
              className="btn-primary w-full py-2 inline-flex items-center justify-center gap-1.5 text-sm"
            >
              <Download className="w-3.5 h-3.5" />
              Export STL
            </button>
          ) : null}

          {stlUrl && zipUrl && (
            <button
              onClick={handleDownload}
              disabled={generating}
              className="btn-secondary w-full py-1.5 inline-flex items-center justify-center gap-1.5 text-sm"
            >
              <Download className="w-3.5 h-3.5" />
              Export Full STL
            </button>
          )}

          {threemfUrl && (
            <button
              onClick={handleDownloadThreemf}
              disabled={generating}
              className="btn-secondary w-full py-1.5 inline-flex items-center justify-center gap-1.5 text-sm"
            >
              <Download className="w-3.5 h-3.5" />
              Export 3MF
            </button>
          )}
        </div>
      </div>

      {/* bin editor */}
      <div className="flex-1 min-h-0 bg-inset overflow-hidden p-4">
        <BinEditor
          placedTools={placedTools}
          onPlacedToolsChange={handlePlacedToolsChange}
          textLabels={textLabels}
          onTextLabelsChange={setTextLabels}
          gridX={config.grid_x}
          gridY={config.grid_y}
          wallThickness={config.wall_thickness}
          onEditTool={(toolId) => router.push(`/tools/${toolId}`)}
          smoothedToolIds={smoothedToolIds}
          onToggleSmoothed={handleToggleSmoothed}
          smoothLevels={smoothLevels}
          onSmoothLevelChange={handleSmoothLevelChange}
        />
      </div>

      {/* 3D preview - hidden on mobile */}
      <div className="hidden md:flex flex-1 bg-inset border-l border-border overflow-hidden flex-col relative">
        {generating && (
          <div className="absolute inset-x-0 bottom-0 z-10">
            <div className="h-1 w-full overflow-hidden bg-blue-950">
              <div className="h-full w-1/3 bg-blue-500 rounded-full animate-[slide_1.2s_ease-in-out_infinite]" />
            </div>
            <div className="flex items-center justify-center gap-2 py-2 bg-surface/90 backdrop-blur-sm border-t border-border">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
              <span className="text-xs text-text-secondary">Generating STL...</span>
            </div>
          </div>
        )}
        <div className="flex-1 min-h-[300px]">
          {stlUrlWithVersion ? (
            <BinPreview3D key={stlVersion} stlUrl={stlUrlWithVersion} splitUrls={splitUrlsWithVersion || undefined} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-text-muted text-sm gap-2">
              {generating ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
                  <span>Generating STL...</span>
                </>
              ) : placedTools.length === 0 ? (
                <span>Add tools from the library to get started</span>
              ) : (
                <span>Preview will appear here</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
