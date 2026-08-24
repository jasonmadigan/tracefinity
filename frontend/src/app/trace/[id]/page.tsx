'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { useDebouncedSave } from '@/hooks/useDebouncedSave'
import { Loader2, Copy, Upload, Download, Check, ChevronDown, ChevronRight, RotateCcw, Pencil } from 'lucide-react'
import { PaperCornerEditor } from '@/components/PaperCornerEditor'
import { PolygonEditor } from '@/components/PolygonEditor'
import { SessionInfo } from '@/components/SessionInfo'
import { Alert } from '@/components/Alert'
import { getSession, setCorners, traceTools, updatePolygons, updateSession, getImageUrl, getAvailableKeys, traceFromMask, saveToolsFromSession, listPhotoStations, listPhotoStationSuggestions, reusePhotoStationCorners, redetectCorners } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useTheme } from '@/hooks/useTheme'
import { CornersHint, TraceHint, EditHint } from '@/components/OnboardingIllustrations'
import { PhotoWarningsBanner } from '@/components/PhotoWarningsBanner'
import { StepBar } from '@/components/StepBar'
import type { PaperSize, PhotoWarning, Point, Polygon, Session, PhotoStation, PhotoStationSuggestion } from '@/types'

type Step = 'corners' | 'trace' | 'edit'

const PAPER_SIZE_OPTIONS: { value: PaperSize; label: string }[] = [
  { value: 'a4', label: 'A4' },
  { value: 'letter', label: 'Letter' },
  { value: 'a3', label: 'A3' },
  { value: 'tabloid', label: 'Tabloid' },
]

const MASK_PROMPT = `Generate a pure black and white silhouette mask of ONLY the tools/objects in this image.
- Tools should be solid BLACK (#000000)
- Background should be solid WHITE (#FFFFFF)
- No shadows, gradients, or gray tones
- Sharp, clean edges
- Output ONLY the mask image, no text or explanation`

const TRACE_STEPS = [
  'Uploading image...',
  'Generating silhouette mask...',
  'Processing mask...',
  'Tracing contours...',
  'Finalizing outlines...',
]

function normalizedToolLabel(label: string, index: number) {
  return label.trim() || `tool ${index + 1}`
}

function normalizePolygonLabels(polygons: Polygon[]) {
  return polygons.map((poly, index) => ({
    ...poly,
    label: normalizedToolLabel(poly.label, index),
  }))
}

const TRACER_PREFERENCE_KEY = 'tracefinity.trace.preferredTracer'

function getPreferredTracerId(availableTracers: { id: string; label: string }[]): string | null {
  if (typeof window === 'undefined') return null
  const saved = window.localStorage.getItem(TRACER_PREFERENCE_KEY)
  if (!saved) return null
  return availableTracers.some((tracer) => tracer.id === saved) ? saved : null
}

function rememberTracerId(tracerId: string | null | undefined) {
  if (!tracerId || typeof window === 'undefined') return
  window.localStorage.setItem(TRACER_PREFERENCE_KEY, tracerId)
}

function paperSizeLabel(size: PaperSize): string {
  return PAPER_SIZE_OPTIONS.find((option) => option.value === size)?.label ?? size
}

type StateSetter<T> = (value: T | ((current: T) => T)) => void

function usePhotoStations({
  enabled,
  sessionId,
  requestedStationId,
  hasCaptureStep,
  stationWasAppliedOnUpload,
  session,
  paperSize,
  setSession,
  setLocalCorners,
  setPaperSize,
  setError,
}: {
  enabled: boolean
  sessionId: string
  requestedStationId: string | null
  hasCaptureStep: boolean
  stationWasAppliedOnUpload: boolean
  session: Session | null
  paperSize: PaperSize
  setSession: StateSetter<Session | null>
  setLocalCorners: StateSetter<Point[]>
  setPaperSize: StateSetter<PaperSize>
  setError: StateSetter<string | null>
}) {
  const [photoStations, setPhotoStations] = useState<PhotoStation[]>([])
  const [stationSuggestions, setStationSuggestions] = useState<PhotoStationSuggestion[]>([])
  const [photoStationCount, setPhotoStationCount] = useState(0)
  const [stationNotice, setStationNotice] = useState<string | null>(null)
  const [stationNoticeTone, setStationNoticeTone] = useState<'success' | 'warning'>('success')
  const [saveAsStation, setSaveAsStation] = useState(false)
  const [stationName, setStationName] = useState(() => `Station ${new Date().toISOString().slice(0, 10)}`)
  const [reusingStationId, setReusingStationId] = useState<string | null>(null)
  const [redetectingCorners, setRedetectingCorners] = useState(false)
  const [activePhotoStationId, setActivePhotoStationId] = useState<string | null>(null)
  const autoStationAppliedRef = useRef(false)

  const refreshStationSuggestions = useCallback(async () => {
    if (!enabled) return
    try {
      const [result, stations] = await Promise.all([
        listPhotoStationSuggestions(sessionId),
        listPhotoStations().catch(() => photoStations),
      ])
      setPhotoStations(stations)
      setStationSuggestions(result.suggestions)
      setPhotoStationCount(stations.length || result.station_count)
    } catch {
      setStationSuggestions([])
    }
  }, [enabled, sessionId, photoStations])

  useEffect(() => {
    if (!enabled) {
      setPhotoStations([])
      setStationSuggestions([])
      setPhotoStationCount(0)
      setActivePhotoStationId(null)
      setStationNotice(null)
      setSaveAsStation(false)
      return
    }

    let cancelled = false
    Promise.all([
      listPhotoStationSuggestions(sessionId).catch(() => ({ suggestions: [], station_count: 0 })),
      listPhotoStations().catch(() => []),
    ]).then(([stationData, stationList]) => {
      if (cancelled) return
      setPhotoStations(stationList)
      setStationSuggestions(stationData.suggestions)
      setPhotoStationCount(stationList.length || stationData.station_count)
    })
    return () => { cancelled = true }
  }, [enabled, sessionId])

  const handleReuseStation = useCallback(async (stationId: string) => {
    if (!enabled) return
    setReusingStationId(stationId)
    setError(null)
    setStationNotice(null)

    try {
      const result = await reusePhotoStationCorners(sessionId, stationId)
      setLocalCorners(result.corners)
      setPaperSize(result.paper_size)
      setSession((current) => current ? {
        ...current,
        corners: result.corners,
        paper_size: result.paper_size,
      } : current)
      setActivePhotoStationId(result.suggestion.station.id)
      setStationSuggestions((current) => current.map((suggestion) =>
        suggestion.station.id === result.suggestion.station.id ? result.suggestion : suggestion
      ))
      setStationNoticeTone(result.suggestion.warnings.length > 0 ? 'warning' : 'success')
      setStationNotice(result.suggestion.warnings.length > 0 ? result.suggestion.warnings.join(' ') : 'Station reused.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to reuse station')
    } finally {
      setReusingStationId(null)
    }
  }, [enabled, sessionId, setError, setLocalCorners, setPaperSize, setSession])

  const handleStationSelect = useCallback((stationId: string) => {
    if (!enabled) return
    if (!stationId) {
      setActivePhotoStationId(null)
      setStationNotice(null)
      return
    }
    const suggestion = stationSuggestions.find((item) => item.station.id === stationId)
    if (!suggestion) {
      setActivePhotoStationId(null)
      setStationNoticeTone('warning')
      setStationNotice('Selected station does not match this image.')
      return
    }
    void handleReuseStation(stationId)
  }, [enabled, handleReuseStation, stationSuggestions])

  useEffect(() => {
    if (!enabled) return
    if (!requestedStationId || !hasCaptureStep || !stationWasAppliedOnUpload || !session || stationSuggestions.length === 0 || autoStationAppliedRef.current) return
    const suggestion = stationSuggestions.find((item) => item.station.id === requestedStationId)
    if (!suggestion) return

    autoStationAppliedRef.current = true
    setActivePhotoStationId(suggestion.station.id)

    if (stationWasAppliedOnUpload) {
      setStationNoticeTone('success')
      setStationNotice('Station reused.')
    }
  }, [enabled, requestedStationId, hasCaptureStep, stationWasAppliedOnUpload, session, stationSuggestions])

  const handleRedetectCorners = useCallback(async () => {
    if (!enabled) return
    setRedetectingCorners(true)
    setError(null)
    setStationNotice(null)

    try {
      const result = await redetectCorners(sessionId)
      setLocalCorners(result.corners)
      setSession((current) => current ? {
        ...current,
        corners: result.corners,
        paper_size: current.paper_size || paperSize,
      } : current)
      setActivePhotoStationId(null)
      setStationNoticeTone('success')
      setStationNotice('Corners redetected.')
      await refreshStationSuggestions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to redetect corners')
    } finally {
      setRedetectingCorners(false)
    }
  }, [enabled, paperSize, refreshStationSuggestions, sessionId, setError, setLocalCorners, setSession])

  const registerCreatedStation = useCallback((station: PhotoStation) => {
    setActivePhotoStationId(station.id)
    setPhotoStations((current) => [station, ...current.filter((item) => item.id !== station.id)])
    setStationSuggestions((current) => [{
      station,
      match_status: 'exact',
      width_delta_percent: 0,
      height_delta_percent: 0,
      max_corner_drift_px: 0,
      max_corner_drift_percent: 0,
      warnings: [],
    }, ...current.filter((suggestion) => suggestion.station.id !== station.id)])
    setPhotoStationCount((count) => count + 1)
    setStationNoticeTone('success')
    setStationNotice('Station saved.')
  }, [])

  const stationSuggestionById = useMemo(
    () => new Map(stationSuggestions.map((suggestion) => [suggestion.station.id, suggestion])),
    [stationSuggestions],
  )

  return {
    activePhotoStationId,
    handleRedetectCorners,
    handleStationSelect,
    photoStationCount,
    photoStations,
    redetectingCorners,
    registerCreatedStation,
    reusingStationId,
    saveAsStation,
    setSaveAsStation,
    setStationName,
    stationName,
    stationNotice,
    stationNoticeTone,
    stationSuggestionById,
  }
}

export default function TracePage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const { theme } = useTheme()
  const sessionId = params.id as string
  const hasCaptureStep = searchParams.get('capture') === '1'
  const requestedStationId = searchParams.get('station')
  const stationWasAppliedOnUpload = searchParams.get('stationApplied') === '1'
  const fromSaveAndNewLoop = searchParams.get('loop') === '1'
  const skipToSaveRequested = searchParams.get('skipToSave') === '1'

  const [session, setSession] = useState<Session | null>(null)
  const [step, setStep] = useState<Step>('corners')
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [corners, setLocalCorners] = useState<Point[]>([])
  const [paperSize, setPaperSize] = useState<PaperSize>('a4')
  const [imageUrl, setImageUrl] = useState<string>('')
  const [correctedImageUrl, setCorrectedImageUrl] = useState<string>('')
  const [polygons, setPolygons] = useState<Polygon[]>([])
  const [photoWarnings, setPhotoWarnings] = useState<PhotoWarning[]>([])
  const [warningsDismissed, setWarningsDismissed] = useState(false)

  const [provider, setProvider] = useState<'google' | 'manual'>('google')
  const [apiKey, setApiKey] = useState('')
  const [hasEnvKey, setHasEnvKey] = useState(false)
  const [providerLabel, setProviderLabel] = useState<string | null>(null)
  const [providerType, setProviderType] = useState<string | null>(null)
  const [tracers, setTracers] = useState<{ id: string; label: string }[]>([])
  const [selectedTracer, setSelectedTracer] = useState<string | null>(null)
  const [methodOpen, setMethodOpen] = useState(false)
  const methodRef = useRef<HTMLDivElement>(null)
  const [maskUrl, setMaskUrl] = useState<string | null>(null)
  const [maskVersion, setMaskVersion] = useState(0)
  const [imageVersion, setImageVersion] = useState(Date.now())
  const [copied, setCopied] = useState(false)
  const [showPrompt, setShowPrompt] = useState(false)
  const [traceStatus, setTraceStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [includedPolygons, setIncludedPolygons] = useState<Set<string>>(new Set())
  const [editingPolygonLabelId, setEditingPolygonLabelId] = useState<string | null>(null)
  const [hoveredPolygon, setHoveredPolygon] = useState<string | null>(null)
  const maskInputRef = useRef<HTMLInputElement>(null)
  const statusInterval = useRef<NodeJS.Timeout | null>(null)
  const polygonsDirtyRef = useRef(false)
  const [photoStationsEnabled, setPhotoStationsEnabled] = useState(false)
  const autoSelectedSkipToolsRef = useRef(false)

  const {
    activePhotoStationId,
    handleRedetectCorners,
    handleStationSelect,
    photoStationCount,
    photoStations,
    redetectingCorners,
    registerCreatedStation,
    reusingStationId,
    saveAsStation,
    setSaveAsStation,
    setStationName,
    stationName,
    stationNotice,
    stationNoticeTone,
    stationSuggestionById,
  } = usePhotoStations({
    enabled: photoStationsEnabled,
    sessionId,
    requestedStationId,
    hasCaptureStep,
    stationWasAppliedOnUpload,
    session,
    paperSize,
    setSession,
    setLocalCorners,
    setPaperSize,
    setError,
  })

  useEffect(() => {
    if (!methodOpen) return
    function handleClick(e: MouseEvent) {
      if (methodRef.current && !methodRef.current.contains(e.target as Node)) setMethodOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [methodOpen])

  useEffect(() => {
    async function load() {
      try {
        const [s, keys] = await Promise.all([
          getSession(sessionId),
          getAvailableKeys(),
        ])
        setSession(s)
        setHasEnvKey(keys.google)
        setProviderLabel(keys.provider_label)
        setProviderType(keys.provider)
        setPhotoStationsEnabled(keys.photo_stations)
        const availableTracers = keys.tracers || []
        setTracers(availableTracers)
        if (availableTracers.length) {
          setSelectedTracer(getPreferredTracerId(availableTracers) || availableTracers[0].id)
        }
        if (!keys.google) {
          setProvider('manual')
        }

        if (s.corners) {
          setLocalCorners(s.corners)
        }
        if (s.paper_size) {
          setPaperSize(s.paper_size)
        }
        if (s.corrected_image_path) {
          setCorrectedImageUrl(`/storage/${s.corrected_image_path}`)
        }
        if (s.photo_warnings?.length) {
          setPhotoWarnings(s.photo_warnings)
        }
        if (s.mask_image_path) {
          const maskRel = s.mask_image_path.replace(/^storage\//, '')
          setMaskUrl(`/storage/${maskRel}`)
        }
        if (s.polygons && s.polygons.length > 0) {
          setPolygons(s.polygons)
          setStep('edit')
        } else if (s.corrected_image_path) {
          setStep('trace')
        }
      } catch {
        setError('session not found')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [sessionId])

  useEffect(() => {
    if (session) {
      const path = step === 'corners' || !correctedImageUrl
        ? `/storage/${session.original_image_path}`
        : correctedImageUrl
      setImageUrl(getImageUrl(path))
    }
  }, [session, step, correctedImageUrl, sessionId])

  useEffect(() => {
    if (!skipToSaveRequested || autoSelectedSkipToolsRef.current || step !== 'edit' || polygons.length === 0) return
    autoSelectedSkipToolsRef.current = true
    setIncludedPolygons(new Set(polygons.map((poly) => poly.id)))
  }, [skipToSaveRequested, step, polygons])

  const singleTracer = tracers.length <= 1

  const markPolygonsDirty = useCallback(() => {
    polygonsDirtyRef.current = true
  }, [])

  async function handleCornersSubmit() {
    if (corners.length !== 4) return

    setProcessing(true)
    setError(null)

    try {
      const result = await setCorners(
        sessionId,
        corners,
        paperSize,
        photoStationsEnabled && saveAsStation ? stationName : null,
      )
      setCorrectedImageUrl(result.corrected_image_url)
      setImageVersion(Date.now())
      setPhotoWarnings(result.warnings ?? [])
      setWarningsDismissed(false)
      if (photoStationsEnabled && result.station) {
        registerCreatedStation(result.station)
      }

      if (singleTracer && tracers.length === 1) {
        // single tracer: trace immediately without changing step
        setTraceStatus(TRACE_STEPS[0])
        let si = 0
        statusInterval.current = setInterval(() => {
          si = Math.min(si + 1, TRACE_STEPS.length - 1)
          setTraceStatus(TRACE_STEPS[si])
        }, 3000)

        try {
          const tid = tracers[0].id
          rememberTracerId(tid)
          const traceResult = await traceTools(
            sessionId, 'google',
            hasEnvKey ? undefined : apiKey,
            tid,
          )
          setPolygons(traceResult.polygons)
          if (traceResult.mask_url) {
            setMaskUrl(traceResult.mask_url)
            setMaskVersion(v => v + 1)
          }
          setStep('edit')
        } finally {
          if (statusInterval.current) {
            clearInterval(statusInterval.current)
            statusInterval.current = null
          }
          setTraceStatus(null)
        }
        return
      }

      setStep('trace')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to process')
    } finally {
      setProcessing(false)
    }
  }

  async function handleTrace(tracerId?: string) {
    const tid = tracerId || selectedTracer
    if (tid === 'gemini' && !hasEnvKey && !apiKey.trim()) {
      setError('please enter your API key')
      return
    }
    rememberTracerId(tid)

    setProcessing(true)
    setError(null)
    setTraceStatus(TRACE_STEPS[0])

    // cycle through status messages while waiting
    let stepIndex = 0
    statusInterval.current = setInterval(() => {
      stepIndex = Math.min(stepIndex + 1, TRACE_STEPS.length - 1)
      setTraceStatus(TRACE_STEPS[stepIndex])
    }, 3000)

    try {
      const result = await traceTools(
        sessionId,
        'google',
        hasEnvKey ? undefined : apiKey,
        tid || undefined,
      )
      setPolygons(result.polygons)
      if (result.mask_url) {
        setMaskUrl(result.mask_url)
        setMaskVersion((v) => v + 1)
      }
      setStep('edit')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'tracing failed')
    } finally {
      if (statusInterval.current) {
        clearInterval(statusInterval.current)
        statusInterval.current = null
      }
      setTraceStatus(null)
      setProcessing(false)
    }
  }

  async function handleMaskUpload(file: File) {
    setProcessing(true)
    setError(null)

    try {
      const result = await traceFromMask(sessionId, file)
      setPolygons(result.polygons)
      if (result.mask_url) {
        setMaskUrl(result.mask_url)
        setMaskVersion((v) => v + 1)
      }
      setStep('edit')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to process mask')
    } finally {
      setProcessing(false)
    }
  }

  function handleCopyPrompt() {
    navigator.clipboard.writeText(MASK_PROMPT)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleDownloadImage() {
    if (!correctedImageUrl) return
    try {
      const response = await fetch(getImageUrl(correctedImageUrl))
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `tracefinity-${sessionId.slice(0, 8)}.jpg`
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      // fallback: open in new tab
      window.open(getImageUrl(correctedImageUrl), '_blank')
    }
  }

  const handlePolygonsChange = useCallback((updated: Polygon[]) => {
    markPolygonsDirty()
    setPolygons(updated)
  }, [markPolygonsDirty])

  const handlePolygonLabelChange = useCallback((polygonId: string, label: string) => {
    markPolygonsDirty()
    setPolygons(current => current.map(poly => (
      poly.id === polygonId ? { ...poly, label } : poly
    )))
  }, [markPolygonsDirty])

  useDebouncedSave(
    async () => {
      if (!polygonsDirtyRef.current) return
      await updatePolygons(sessionId, normalizePolygonLabels(polygons))
      polygonsDirtyRef.current = false
    },
    [polygons, sessionId],
    300,
    { skipInitial: true }
  )

  // clear status interval on unmount (if user navigates away mid-trace)
  useEffect(() => {
    return () => {
      if (statusInterval.current) {
        clearInterval(statusInterval.current)
        statusInterval.current = null
      }
    }
  }, [])

  async function handleSaveToLibrary(nextPath: string = '/') {
    if (includedPolygons.size === 0) return
    setSaving(true)
    setError(null)
    try {
      const normalized = normalizePolygonLabels(polygons)
      setPolygons(normalized)
      await updatePolygons(sessionId, normalized)
      polygonsDirtyRef.current = false
      await saveToolsFromSession(sessionId, Array.from(includedPolygons))
      router.push(nextPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save tools')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-text-muted">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Loading session...</span>
      </div>
    )
  }

  if (error && !session) {
    return (
      <div className="max-w-md mx-auto py-12">
        <Alert variant="error">{error}</Alert>
      </div>
    )
  }

  const traceSteps = singleTracer ? ['Corners', 'Save'] : ['Corners', 'Trace', 'Save']
  const steps = hasCaptureStep ? ['Capture', ...traceSteps] : traceSteps
  const traceStepIndex = singleTracer
    ? (step === 'corners' ? 0 : 1)
    : (step === 'corners' ? 0 : step === 'trace' ? 1 : 2)
  const stepIndex = hasCaptureStep ? traceStepIndex + 1 : traceStepIndex
  const saveAndNewPath = activePhotoStationId
    ? `/trace?station=${encodeURIComponent(activePhotoStationId)}&loop=1`
    : '/trace'

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col w-full">
      <StepBar
        steps={steps}
        current={stepIndex}
        onStepClick={(i) => {
          if (hasCaptureStep && i === 0) {
            const params = new URLSearchParams()
            if (activePhotoStationId) {
              params.set('station', activePhotoStationId)
            }
            if (fromSaveAndNewLoop) params.set('loop', '1')
            router.push(`/trace?${params.toString()}`)
            return
          }
          const traceIndex = hasCaptureStep ? i - 1 : i
          if (traceIndex === 0) setStep('corners')
          else if (!singleTracer && traceIndex === 1 && correctedImageUrl) setStep('trace')
        }}
      />
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
      {/* left sidebar - controls */}
      <div className="md:w-[240px] md:flex-shrink-0 bg-surface border-b md:border-b-0 md:border-r border-border overflow-y-auto flex flex-col max-h-[40vh] md:max-h-none">
        <div className="p-3 space-y-3">
          <div className="glass rounded-[10px] px-3 py-3">
            <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-widest mb-2">
              {step === 'corners' && (traceStatus ? 'Tracing...' : 'Adjust Corners')}
              {step === 'trace' && 'Trace Tools'}
              {step === 'edit' && 'Select Tools'}
            </h3>

          {step === 'corners' && (
            <div className="space-y-3">
              <CornersHint />
              <p className="text-xs text-text-muted">
                Drag the corner handles to match the paper edges.
              </p>

              <div>
                <span className="text-xs text-text-primary tracking-[0.3px]">Paper Size</span>
                <div className="grid grid-cols-2 gap-0.5 rounded-[10px] glass p-0.5 mt-1.5 w-full">
                  {PAPER_SIZE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setPaperSize(option.value)}
                      className={`h-7 px-2 rounded text-xs font-medium whitespace-nowrap ${
                        paperSize === option.value
                          ? 'bg-surface text-text-primary shadow-sm'
                          : 'text-text-muted hover:text-text-primary'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {photoStationsEnabled && (
                <>
                  <div className="border-t border-border-subtle pt-3">
                    <button
                      type="button"
                      onClick={handleRedetectCorners}
                      disabled={processing || redetectingCorners || !session?.original_image_path}
                      className="btn-secondary w-full py-1.5 text-sm inline-flex items-center justify-center gap-1.5"
                    >
                      {redetectingCorners ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                      {redetectingCorners ? 'Detecting...' : 'Redetect Corners'}
                    </button>
                  </div>

                  <div className="border-t border-border-subtle pt-3 space-y-2">
                    <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-widest">
                      Photo Station
                    </h3>
                    <select
                      value={activePhotoStationId || ''}
                      onChange={(e) => handleStationSelect(e.target.value)}
                      disabled={processing || reusingStationId !== null || photoStationCount === 0}
                      className="w-full h-9 px-2 rounded-[8px] bg-elevated border border-border-subtle text-sm text-text-primary focus:outline-none focus:border-accent"
                    >
                      <option value="">
                        {photoStationCount > 0 ? 'No station' : 'No stations saved'}
                      </option>
                      {photoStations.map((station) => {
                        const suggestion = stationSuggestionById.get(station.id)
                        const matched = Boolean(suggestion)
                        return (
                          <option key={station.id} value={station.id} disabled={!matched}>
                            {station.name} - {paperSizeLabel(station.paper_size)} - {matched ? 'Matched' : 'Not matched'}
                          </option>
                        )
                      })}
                    </select>

                    {reusingStationId && (
                      <div className="flex items-center gap-2 text-xs text-text-muted">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                        <span>Reusing station...</span>
                      </div>
                    )}

                    {photoStationCount === 0 && (
                      <p className="text-xs text-text-muted">
                        Confirm the first setup, then save it for repeated phone photos.
                      </p>
                    )}

                    {stationNotice && (
                      <p className={cn(
                        "text-xs leading-snug",
                        stationNoticeTone === 'success'
                          ? 'text-green-400'
                          : theme === 'dark' ? 'text-amber-300' : 'text-amber-600',
                      )}>
                        {stationNotice}
                      </p>
                    )}

                    <label className="min-h-11 flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                      <input
                        type="checkbox"
                        checked={saveAsStation}
                        onChange={(e) => setSaveAsStation(e.target.checked)}
                        className="w-4 h-4 rounded border-border-subtle bg-elevated accent-sky-500"
                      />
                      Save Station
                    </label>
                    {saveAsStation && (
                      <div>
                        <label className="text-xs text-text-primary tracking-[0.3px]" htmlFor="photo-station-name">
                          Station name
                        </label>
                        <input
                          id="photo-station-name"
                          type="text"
                          value={stationName}
                          onChange={(e) => setStationName(e.target.value)}
                          className="w-full min-h-11 px-3 mt-1.5 text-sm border border-border-subtle rounded bg-elevated text-text-primary focus:outline-none focus:border-accent"
                        />
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {step === 'trace' && (
            <div className="space-y-3">
              <TraceHint />
              {tracers.length > 1 && (
                <div className="relative" ref={methodRef}>
                  <span className="text-xs text-text-primary tracking-[0.3px]">Tracer</span>
                  <button
                    onClick={() => setMethodOpen(p => !p)}
                    className="w-full mt-1.5 px-3 py-1.5 rounded-[10px] glass text-xs font-medium text-text-primary flex items-center justify-between cursor-pointer"
                  >
                    <span>
                      {provider === 'manual'
                        ? 'Manual mask upload'
                        : tracers.find(t => t.id === selectedTracer)?.label || selectedTracer}
                    </span>
                    <ChevronDown className={`w-3 h-3 text-text-muted transition-transform ${methodOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {methodOpen && (
                    <div className="absolute left-0 right-0 mt-1 bg-surface border border-border rounded-lg py-1 z-30 shadow-xl">
                      {tracers.map(t => {
                        const active = provider !== 'manual' && selectedTracer === t.id
                        return (
                          <button
                            key={t.id}
                            onClick={() => {
                              setSelectedTracer(t.id)
                              rememberTracerId(t.id)
                              setProvider('google')
                              setMethodOpen(false)
                            }}
                            className={`w-full text-left px-3 py-1.5 text-xs transition-colors cursor-pointer flex items-center gap-2 ${
                              active ? 'text-accent' : 'text-text-secondary hover:bg-glass-hover hover:text-text-primary'
                            }`}
                          >
                            {active ? <Check className="w-3 h-3" /> : <span className="w-3" />}
                            {t.label}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {provider === 'google' && (
                <>
                  {selectedTracer === 'gemini' && !hasEnvKey && (
                    <div>
                      <span className="text-xs text-text-primary tracking-[0.3px]">API Key</span>
                      <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="AIza..."
                        className="w-full h-7 px-2 mt-1.5 text-xs border border-border-subtle rounded bg-elevated text-text-primary focus:outline-none focus:border-accent"
                      />
                      <p className="text-xs text-text-muted mt-1">
                        Sent directly to the API, not stored.
                      </p>
                    </div>
                  )}

                  {selectedTracer === 'gemini' && tracers.length > 1 && (
                    <div className="glass rounded-[10px] overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setShowPrompt(!showPrompt)}
                        className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-text-secondary hover:bg-glass-hover transition-colors"
                      >
                        <span>What we send to the model</span>
                        {showPrompt ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </button>
                      {showPrompt && (
                        <div className="px-3 py-2 bg-elevated border-t border-border-subtle">
                          <pre className="text-xs text-text-secondary whitespace-pre-wrap">{MASK_PROMPT}</pre>
                        </div>
                      )}
                    </div>
                  )}

                  {traceStatus && (
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                      <span>{traceStatus}</span>
                    </div>
                  )}

                  {selectedTracer === 'gemini' && tracers.length > 1 && !processing && (
                    <button
                      onClick={() => setProvider('manual')}
                      className="text-xs text-accent/70 hover:text-accent underline underline-offset-2 decoration-accent/30 hover:decoration-accent transition-colors cursor-pointer"
                    >
                      Upload a mask manually
                    </button>
                  )}
                </>
              )}

              {provider === 'manual' && (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-text-secondary mb-1.5">
                      1. Download the corrected image:
                    </p>
                    <button
                      onClick={handleDownloadImage}
                      className="btn-secondary w-full py-1.5 text-sm inline-flex items-center justify-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download Image
                    </button>
                  </div>

                  <div>
                    <p className="text-xs text-text-secondary mb-1.5">
                      2. Copy this prompt:
                    </p>
                    <div className="relative">
                      <pre className="text-xs bg-elevated p-2 rounded border border-border-subtle whitespace-pre-wrap">
                        {MASK_PROMPT}
                      </pre>
                      <button
                        onClick={handleCopyPrompt}
                        className="absolute top-1.5 right-1.5 p-1 bg-elevated rounded border border-border-subtle hover:bg-border-subtle transition-colors"
                      >
                        {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-text-secondary mb-1.5">
                      3. Upload to <a href="https://gemini.google.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">gemini.google.com</a>, then upload the mask:
                    </p>
                    <input
                      ref={maskInputRef}
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handleMaskUpload(file)
                      }}
                      className="hidden"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 'edit' && (
            <div className="space-y-3">
              <EditHint />
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 text-xs text-text-muted">
                  {polygons.length === 0
                    ? 'No tools were detected.'
                    : `${includedPolygons.size} of ${polygons.length} selected.`}
                </p>
                {polygons.length > 0 && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setIncludedPolygons(new Set(polygons.map((p) => p.id)))}
                      className="rounded border border-border-subtle px-2 py-0.5 text-[11px] font-medium text-text-secondary hover:bg-elevated hover:text-text-primary transition-colors"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setIncludedPolygons(new Set())}
                      className="rounded border border-border-subtle px-2 py-0.5 text-[11px] font-medium text-text-secondary hover:bg-elevated hover:text-text-primary transition-colors"
                    >
                      None
                    </button>
                  </div>
                )}
              </div>

              {polygons.length > 0 && (
                <div className="text-xs space-y-0.5">
                  {polygons.map((p) => {
                    const isIncluded = includedPolygons.has(p.id)
                    return (
                      <div
                        key={p.id}
                        onClick={() => {
                          const next = new Set(includedPolygons)
                          if (next.has(p.id)) next.delete(p.id)
                          else next.add(p.id)
                          setIncludedPolygons(next)
                        }}
                        className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer transition-colors ${
                          isIncluded
                            ? 'bg-accent-muted text-accent'
                            : hoveredPolygon === p.id
                              ? 'bg-elevated text-text-primary'
                              : 'text-text-muted hover:bg-elevated hover:text-text-secondary'
                          }`}
                        >
                        <div className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center flex-shrink-0 transition-colors ${
                          isIncluded ? 'bg-accent border-accent' : 'border-border-subtle'
                        }`}>
                          {isIncluded && <Check className="w-2.5 h-2.5 text-white" />}
                        </div>
                        {editingPolygonLabelId === p.id ? (
                          <input
                            type="text"
                            value={p.label}
                            aria-label={`Tool name ${p.label || ''}`.trim()}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                            onFocus={(e) => e.currentTarget.select()}
                            onBlur={() => setEditingPolygonLabelId(null)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === 'Escape') {
                                e.currentTarget.blur()
                              }
                            }}
                            onChange={(e) => handlePolygonLabelChange(p.id, e.target.value)}
                            className="min-w-0 flex-1 bg-transparent border-none outline-none text-xs font-semibold text-text-primary"
                          />
                        ) : (
                          <span className="min-w-0 flex-1 truncate">{p.label}</span>
                        )}
                        <button
                          type="button"
                          aria-label={`Edit ${p.label || 'tool name'}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingPolygonLabelId(p.id)
                          }}
                          className="w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-elevated transition-colors"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          </div>

          {step === 'edit' && maskUrl && (
            <div className="glass rounded-[10px] px-3 py-3">
              <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-widest mb-2">Mask</h3>
              <img
                src={`${getImageUrl(maskUrl)}?v=${maskVersion}`}
                alt="Generated mask"
                className="w-full rounded-lg border border-border-subtle"
              />
            </div>
          )}

          {!warningsDismissed && (
            <PhotoWarningsBanner
              warnings={photoWarnings}
              onDismiss={() => setWarningsDismissed(true)}
            />
          )}

          {error && <Alert variant="error">{error}</Alert>}
        </div>

        <div className="p-3 md:mt-auto space-y-2">
          {step === 'corners' && (
            <button
              onClick={handleCornersSubmit}
              disabled={corners.length !== 4 || processing}
              className="btn-primary w-full py-2 text-sm inline-flex items-center justify-center gap-1.5"
            >
              {processing && <Loader2 className="w-4 h-4 animate-spin" />}
              {traceStatus || (processing ? 'Processing...' : 'Continue')}
            </button>
          )}

          {step === 'trace' && provider === 'google' && (tracers.length > 1 || processing) && (
            <button
              onClick={() => handleTrace()}
              disabled={(selectedTracer === 'gemini' && !hasEnvKey && !apiKey.trim()) || processing}
              className="btn-primary w-full py-2 text-sm inline-flex items-center justify-center gap-1.5"
            >
              {processing && <Loader2 className="w-4 h-4 animate-spin" />}
              {processing ? 'Tracing...' : 'Trace Tools'}
            </button>
          )}

          {step === 'trace' && provider === 'manual' && (
            <button
              onClick={() => maskInputRef.current?.click()}
              disabled={processing}
              className="btn-primary w-full py-2 text-sm inline-flex items-center justify-center gap-1.5"
            >
              {processing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Upload Mask
                </>
              )}
            </button>
          )}

          {step === 'edit' && (
            <>
              <button
                onClick={() => handleSaveToLibrary()}
                disabled={includedPolygons.size === 0 || saving}
                className="btn-primary w-full py-2 text-sm inline-flex items-center justify-center gap-1.5"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {saving ? 'Saving...' : includedPolygons.size === 0 ? 'Select tools to save' : `Save ${includedPolygons.size} tool${includedPolygons.size === 1 ? '' : 's'}`}
              </button>
              <button
                onClick={() => handleSaveToLibrary(saveAndNewPath)}
                disabled={includedPolygons.size === 0 || saving}
                className="btn-secondary w-full py-2 text-sm inline-flex items-center justify-center gap-1.5"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {saving ? 'Saving...' : 'Save and New'}
              </button>
              <button
                onClick={() => setStep('trace')}
                className="btn-secondary w-full py-1.5 text-sm inline-flex items-center justify-center"
              >
                Re-trace
              </button>
            </>
          )}
        </div>
      </div>

      {/* image area */}
      <div className="flex-1 min-h-0 bg-base overflow-hidden p-3">
        {step === 'corners' && (
          <PaperCornerEditor
            imageUrl={imageUrl}
            corners={corners}
            onCornersChange={setLocalCorners}
          />
        )}

        {(step === 'trace' || step === 'edit') && correctedImageUrl && (
          <PolygonEditor
            key={`${correctedImageUrl}-${imageVersion}`}
            imageUrl={`${getImageUrl(correctedImageUrl)}?v=${imageVersion}`}
            polygons={polygons}
            onPolygonsChange={handlePolygonsChange}
            editable={step === 'edit'}
            included={step === 'edit' ? includedPolygons : undefined}
            onIncludedChange={step === 'edit' ? setIncludedPolygons : undefined}
            hovered={step === 'edit' ? hoveredPolygon : undefined}
            onHoveredChange={step === 'edit' ? setHoveredPolygon : undefined}
          />
        )}
      </div>
      </div>
    </div>
  )
}
