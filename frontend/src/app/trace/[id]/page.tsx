'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Loader2, Copy, Upload, Download, Check, ChevronDown, ChevronRight } from 'lucide-react'
import { PaperCornerEditor } from '@/components/PaperCornerEditor'
import { PolygonEditor } from '@/components/PolygonEditor'
import { SessionInfo } from '@/components/SessionInfo'
import { Alert } from '@/components/Alert'
import { getSession, setCorners, traceTools, updatePolygons, updateSession, getImageUrl, getAvailableKeys, traceFromMask, saveToolsFromSession } from '@/lib/api'
import { CornersHint, TraceHint, EditHint } from '@/components/OnboardingIllustrations'
import type { Point, Polygon, Session } from '@/types'

type Step = 'corners' | 'trace' | 'edit'

const MASK_PROMPT = `Generate a pure black and white silhouette mask of ONLY the tools/objects in this image.
- Tools should be solid BLACK (#000000)
- Background should be solid WHITE (#FFFFFF)
- No shadows, gradients, or gray tones
- Sharp, clean edges
- Output ONLY the mask image, no text or explanation`

const LABEL_PROMPT = `Identify each tool in the image and return a JSON object with labels.`

const TRACE_STEPS = [
  'Uploading image to Gemini...',
  'Generating silhouette mask...',
  'Processing mask...',
  'Tracing contours...',
  'Identifying tools...',
]

export default function TracePage() {
  const router = useRouter()
  const params = useParams()
  const sessionId = params.id as string

  const [session, setSession] = useState<Session | null>(null)
  const [step, setStep] = useState<Step>('corners')
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [corners, setLocalCorners] = useState<Point[]>([])
  const [paperSize, setPaperSize] = useState<'a4' | 'letter'>('a4')
  const [imageUrl, setImageUrl] = useState<string>('')
  const [correctedImageUrl, setCorrectedImageUrl] = useState<string>('')
  const [polygons, setPolygons] = useState<Polygon[]>([])

  const [provider, setProvider] = useState<'google' | 'manual'>('google')
  const [apiKey, setApiKey] = useState('')
  const [hasEnvKey, setHasEnvKey] = useState(false)
  const [maskUrl, setMaskUrl] = useState<string | null>(null)
  const [maskVersion, setMaskVersion] = useState(0)
  const [imageVersion, setImageVersion] = useState(Date.now())
  const [copied, setCopied] = useState(false)
  const [showPrompt, setShowPrompt] = useState(false)
  const [traceStatus, setTraceStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const maskInputRef = useRef<HTMLInputElement>(null)
  const statusInterval = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const [s, keys] = await Promise.all([
          getSession(sessionId),
          getAvailableKeys(),
        ])
        setSession(s)
        setHasEnvKey(keys.google)

        if (!keys.google) {
          setProvider('manual')
        }

        if (s.corners) {
          setLocalCorners(s.corners)
        }
        if (s.corrected_image_path) {
          setCorrectedImageUrl(`/storage/${s.corrected_image_path}`)
        }
        if (s.mask_image_path) {
          setMaskUrl(`/storage/${s.mask_image_path}`)
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

  async function handleCornersSubmit() {
    if (corners.length !== 4) return

    setProcessing(true)
    setError(null)

    try {
      const result = await setCorners(sessionId, corners, paperSize)
      setCorrectedImageUrl(result.corrected_image_url)
      setImageVersion(Date.now())
      setStep('trace')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to process corners')
    } finally {
      setProcessing(false)
    }
  }

  async function handleTrace() {
    if (!hasEnvKey && !apiKey.trim()) {
      setError('please enter your API key')
      return
    }

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
        hasEnvKey ? undefined : apiKey
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

  const savePendingRef = useRef<(() => void) | null>(null)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const handlePolygonsChange = useCallback((updated: Polygon[]) => {
    setPolygons(updated)
    const doSave = () => {
      updatePolygons(sessionId, updated).catch(() => {})
    }
    savePendingRef.current = doSave
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      savePendingRef.current = null
      doSave()
    }, 300)
  }, [sessionId])

  // flush pending save on unload
  useEffect(() => {
    const flush = () => { savePendingRef.current?.() }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  // clear status interval on unmount (if user navigates away mid-trace)
  useEffect(() => {
    return () => {
      if (statusInterval.current) {
        clearInterval(statusInterval.current)
        statusInterval.current = null
      }
    }
  }, [])

  async function handleSaveToLibrary() {
    setSaving(true)
    setError(null)
    try {
      await saveToolsFromSession(sessionId)
      router.push('/')
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

  return (
    <div className="h-[calc(100vh-53px)] flex w-full">
      {/* left sidebar - controls */}
      <div className="w-[260px] flex-shrink-0 bg-surface border-r border-border overflow-y-auto flex flex-col">
        {session && (
          <SessionInfo
            session={session}
            onUpdate={(updates) => {
              updateSession(sessionId, updates)
              setSession({ ...session, ...updates })
            }}
          />
        )}

        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">
            {step === 'corners' && 'Adjust Corners'}
            {step === 'trace' && 'Trace Tools'}
            {step === 'edit' && 'Edit Outlines'}
          </h3>

          {step === 'corners' && (
            <div className="space-y-3">
              <CornersHint />
              <p className="text-xs text-text-muted">
                Drag the corner handles to match the paper edges.
              </p>

              <div>
                <span className="text-xs text-[#ebecec] tracking-[0.3px]">Paper Size</span>
                <div className="inline-flex rounded bg-elevated p-0.5 mt-1.5">
                  <button
                    onClick={() => setPaperSize('a4')}
                    className={`px-3 py-1 rounded text-xs font-medium ${
                      paperSize === 'a4'
                        ? 'bg-surface text-text-primary shadow-sm'
                        : 'text-text-muted hover:text-text-primary'
                    }`}
                  >
                    A4
                  </button>
                  <button
                    onClick={() => setPaperSize('letter')}
                    className={`px-3 py-1 rounded text-xs font-medium ${
                      paperSize === 'letter'
                        ? 'bg-surface text-text-primary shadow-sm'
                        : 'text-text-muted hover:text-text-primary'
                    }`}
                  >
                    Letter
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === 'trace' && (
            <div className="space-y-3">
              <TraceHint />
              <div>
                <span className="text-xs text-[#ebecec] tracking-[0.3px]">Method</span>
                <div className="inline-flex rounded bg-elevated p-0.5 mt-1.5">
                  <button
                    onClick={() => setProvider('google')}
                    className={`px-3 py-1 rounded text-xs font-medium ${
                      provider === 'google'
                        ? 'bg-surface text-text-primary shadow-sm'
                        : 'text-text-muted hover:text-text-primary'
                    }`}
                  >
                    Gemini API{hasEnvKey && ' (configured)'}
                  </button>
                  <button
                    onClick={() => setProvider('manual')}
                    className={`px-3 py-1 rounded text-xs font-medium ${
                      provider === 'manual'
                        ? 'bg-surface text-text-primary shadow-sm'
                        : 'text-text-muted hover:text-text-primary'
                    }`}
                  >
                    Manual
                  </button>
                </div>
              </div>

              {provider === 'google' && (
                <>
                  {!hasEnvKey && (
                    <div>
                      <span className="text-xs text-[#ebecec] tracking-[0.3px]">API Key</span>
                      <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="AIza..."
                        className="w-full h-7 px-2 mt-1.5 text-xs border border-border-subtle rounded-[5px] bg-[#222a35] text-text-primary focus:outline-none focus:border-accent"
                      />
                      <p className="text-xs text-text-muted mt-1">
                        Sent directly to the API, not stored.
                      </p>
                    </div>
                  )}

                  <div className="border border-border-subtle rounded overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowPrompt(!showPrompt)}
                      className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-text-secondary hover:bg-elevated transition-colors"
                    >
                      <span>What we send to Gemini</span>
                      {showPrompt ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                    {showPrompt && (
                      <div className="px-3 py-2 bg-elevated border-t border-border-subtle space-y-2">
                        <div>
                          <p className="text-xs font-medium text-text-muted mb-1">Mask prompt:</p>
                          <pre className="text-xs text-text-secondary whitespace-pre-wrap">{MASK_PROMPT}</pre>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-text-muted mb-1">Label prompt:</p>
                          <pre className="text-xs text-text-secondary whitespace-pre-wrap">{LABEL_PROMPT}</pre>
                        </div>
                      </div>
                    )}
                  </div>

                  {traceStatus && (
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                      <span>{traceStatus}</span>
                    </div>
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
              <p className="text-xs text-text-muted">
                Click a polygon to select it. Drag vertices to adjust.
                {polygons.length === 0 && ' No tools were detected.'}
              </p>

              {polygons.length > 0 && (
                <div className="text-xs text-text-secondary space-y-0.5">
                  {polygons.map((p) => (
                    <div key={p.id} className="flex justify-between">
                      <span>{p.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {step === 'edit' && maskUrl && (
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Mask</h3>
            <img
              src={`${getImageUrl(maskUrl)}?v=${maskVersion}`}
              alt="Generated mask"
              className="w-full rounded border border-border"
            />
          </div>
        )}

        {error && (
          <div className="px-4 py-3 border-b border-border">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        <div className="px-4 py-3 mt-auto space-y-2">
          {step === 'corners' && (
            <button
              onClick={handleCornersSubmit}
              disabled={corners.length !== 4 || processing}
              className="btn-primary w-full py-2 text-sm inline-flex items-center justify-center gap-1.5"
            >
              {processing && <Loader2 className="w-4 h-4 animate-spin" />}
              {processing ? 'Processing...' : 'Continue'}
            </button>
          )}

          {step === 'trace' && provider === 'google' && (
            <button
              onClick={handleTrace}
              disabled={(provider === 'google' && !hasEnvKey && !apiKey.trim()) || processing}
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
                onClick={handleSaveToLibrary}
                disabled={polygons.length === 0 || saving}
                className="btn-primary w-full py-2 text-sm inline-flex items-center justify-center gap-1.5"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {saving ? 'Saving...' : 'Save to Library'}
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
      <div className="flex-1 bg-inset overflow-hidden p-4">
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
          />
        )}
      </div>
    </div>
  )
}
