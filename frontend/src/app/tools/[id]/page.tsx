'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Loader2, ArrowLeft, Check, Download } from 'lucide-react'
import { getTool, updateTool, getToolSvgUrl } from '@/lib/api'
import { ToolEditor } from '@/components/ToolEditor'
import { Alert } from '@/components/Alert'
import type { Tool, Point, FingerHole } from '@/types'

export default function ToolPage() {
  const router = useRouter()
  const params = useParams()
  const toolId = params.id as string

  const [tool, setTool] = useState<Tool | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const savedTimerRef = useRef<NodeJS.Timeout | null>(null)
  const initialLoadRef = useRef(true)

  useEffect(() => {
    async function load() {
      try {
        const t = await getTool(toolId)
        setTool(t)
        setName(t.name)
      } catch {
        setError('Tool not found')
      } finally {
        setLoading(false)
        setTimeout(() => { initialLoadRef.current = false }, 100)
      }
    }
    load()
  }, [toolId])

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingSaveRef = useRef<(() => void) | null>(null)

  // save whenever tool state changes (short debounce to batch drag events)
  useEffect(() => {
    if (!tool || initialLoadRef.current) return
    const doSave = async () => {
      setSaving(true)
      setSaved(false)
      try {
        await updateTool(toolId, { name, points: tool.points, finger_holes: tool.finger_holes, smoothed: tool.smoothed, smooth_level: tool.smooth_level })
        setSaved(true)
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
        savedTimerRef.current = setTimeout(() => setSaved(false), 2000)
      } catch {
        // ignore
      } finally {
        setSaving(false)
      }
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
  }, [tool, name, toolId])

  // flush pending save on page unload
  useEffect(() => {
    const flush = () => { pendingSaveRef.current?.() }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

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

  const handleNameChange = (newName: string) => {
    setName(newName)
  }

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
    <div className="h-[calc(100vh-53px)] flex flex-col w-full">
      {/* header bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-surface flex-shrink-0">
        <button
          onClick={() => router.push('/')}
          className="p-1.5 rounded hover:bg-elevated text-text-muted"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <input
          type="text"
          value={name}
          onChange={e => handleNameChange(e.target.value)}
          className="text-sm font-medium text-text-primary bg-transparent border-none outline-none flex-1 min-w-0"
          placeholder="Tool name"
        />
        <a
          href={getToolSvgUrl(toolId)}
          download
          className="btn-primary py-1.5 px-3 inline-flex items-center gap-1.5 text-sm"
        >
          <Download className="w-3.5 h-3.5" />
          Export SVG
        </a>
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {saved && <Check className="w-3.5 h-3.5 text-green-400" />}
          {saving ? 'Saving...' : saved ? 'Saved' : ''}
        </div>
      </div>

      {/* editor */}
      <div className="flex-1 min-h-0 p-4">
        <ToolEditor
          points={tool.points}
          fingerHoles={tool.finger_holes}
          interiorRings={tool.interior_rings}
          smoothed={tool.smoothed}
          smoothLevel={tool.smooth_level}
          onPointsChange={handlePointsChange}
          onFingerHolesChange={handleFingerHolesChange}
          onSmoothedChange={handleSmoothedChange}
          onSmoothLevelChange={handleSmoothLevelChange}
        />
      </div>
    </div>
  )
}
