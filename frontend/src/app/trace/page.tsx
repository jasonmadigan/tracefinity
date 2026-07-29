'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Camera, Crop, Loader2, SkipForward, Upload } from 'lucide-react'
import { Alert } from '@/components/Alert'
import { CaptureAreaOverlay } from '@/components/CaptureAreaOverlay'
import { StepBar } from '@/components/StepBar'
import { getAvailableKeys, getImageUrl, getPhotoStation, getSession, listPhotoStations, setCorners, traceTools, uploadImage } from '@/lib/api'
import type { CaptureCrop, PhotoStation } from '@/types'

const STEPS = ['Capture', 'Corners', 'Trace', 'Save']
const TRACER_PREFERENCE_KEY = 'tracefinity.trace.preferredTracer'

export default function CapturePage() {
  return (
    <Suspense fallback={<CaptureFallback />}>
      <CapturePageContent />
    </Suspense>
  )
}

function CaptureFallback() {
  return (
    <div className="h-[calc(100vh-44px)] flex flex-col w-full">
      <StepBar steps={STEPS} current={0} />
      <div className="flex-1 flex items-center justify-center text-text-muted">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    </div>
  )
}

function CapturePageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const existingSessionId = searchParams.get('session')
  const stationParam = searchParams.get('station')
  const stationApplied = searchParams.get('stationApplied') === '1'
  const fromSaveAndNewLoop = searchParams.get('loop') === '1'
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const mediaWrapperRef = useRef<HTMLDivElement>(null)
  const mediaContainerRef = useRef<HTMLDivElement>(null)
  const previousStationIdRef = useRef<string | null>(stationParam)
  const [selectedStationId, setSelectedStationId] = useState<string | null>(stationParam)
  const [stations, setStations] = useState<PhotoStation[]>([])
  const [photoStationsEnabled, setPhotoStationsEnabled] = useState(false)
  const [loadingStations, setLoadingStations] = useState(false)
  const [captureArea, setCaptureArea] = useState<CaptureCrop | null>(null)
  const [fullCaptureAreaOverride, setFullCaptureAreaOverride] = useState(false)
  const [editingCaptureArea, setEditingCaptureArea] = useState(false)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [mediaSize, setMediaSize] = useState({ width: 0, height: 0 })
  const [fittedSize, setFittedSize] = useState({ width: 0, height: 0 })
  const [starting, setStarting] = useState(false)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [quickProcessing, setQuickProcessing] = useState(false)
  const [quickStatus, setQuickStatus] = useState<string | null>(null)
  const [preferredTracer, setPreferredTracer] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const autoStartedRef = useRef(false)

  const startCamera = useCallback(async () => {
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera capture requires localhost or HTTPS in Chrome and Edge.')
      return
    }

    setStarting(true)
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      stream?.getTracks().forEach((track) => track.stop())
      setPreviewUrl(null)
      setMediaSize({ width: 0, height: 0 })
      setFittedSize({ width: 0, height: 0 })
      setStream(nextStream)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Camera could not be opened.')
    } finally {
      setStarting(false)
    }
  }, [stream])
  useEffect(() => {
    if (!stream || !videoRef.current) return
    videoRef.current.srcObject = stream
    videoRef.current.play().catch(() => setError('Camera preview could not start.'))
  }, [stream])

  useEffect(() => {
    if (stationParam) {
      setSelectedStationId(stationParam)
      return
    }
    setSelectedStationId(null)
  }, [stationParam])

  useEffect(() => {
    if (previousStationIdRef.current === selectedStationId) return
    previousStationIdRef.current = selectedStationId

    setPreviewUrl(null)
    setMediaSize({ width: 0, height: 0 })
    setFittedSize({ width: 0, height: 0 })
    startCamera()
  }, [selectedStationId, startCamera])

  useEffect(() => {
    let cancelled = false
    setLoadingStations(true)
    getAvailableKeys()
      .then(async (keys) => {
        if (cancelled) return
        setPhotoStationsEnabled(keys.photo_stations)
        if (!keys.photo_stations) {
          setStations([])
          setSelectedStationId(null)
          return
        }
        const items = await listPhotoStations()
        if (!cancelled) setStations(items)
      })
      .catch(() => {
        if (!cancelled) {
          setPhotoStationsEnabled(false)
          setStations([])
          setSelectedStationId(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingStations(false)
      })

    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!photoStationsEnabled || !selectedStationId) {
      setCaptureArea(null)
      setFullCaptureAreaOverride(false)
      setEditingCaptureArea(false)
      return
    }

    let cancelled = false
    getPhotoStation(selectedStationId)
      .then((station) => {
        if (cancelled) return
        setCaptureArea(station.capture_crop)
        setFullCaptureAreaOverride(false)
      })
      .catch(() => {
        if (!cancelled) setCaptureArea(null)
      })

    return () => { cancelled = true }
  }, [photoStationsEnabled, selectedStationId])

  useEffect(() => {
    if (!fromSaveAndNewLoop) {
      setPreferredTracer(null)
      return
    }

    let cancelled = false
    getAvailableKeys()
      .then((keys) => {
        if (cancelled) return
        const saved = window.localStorage.getItem(TRACER_PREFERENCE_KEY)
        const available = keys.tracers || []
        setPreferredTracer(saved && available.some((tracer) => tracer.id === saved) ? saved : null)
      })
      .catch(() => {
        if (!cancelled) setPreferredTracer(null)
      })

    return () => { cancelled = true }
  }, [fromSaveAndNewLoop])

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [stream])

  useEffect(() => {
    if (stream || previewUrl) return
    setMediaSize({ width: 0, height: 0 })
    setFittedSize({ width: 0, height: 0 })
  }, [stream, previewUrl])

  useEffect(() => {
    function updateSize() {
      if (!mediaWrapperRef.current || !mediaSize.width || !mediaSize.height) return
      const availW = mediaWrapperRef.current.clientWidth
      const availH = mediaWrapperRef.current.clientHeight
      const aspect = mediaSize.width / mediaSize.height
      let width = availW
      let height = width / aspect
      if (height > availH) {
        height = availH
        width = height * aspect
      }
      setFittedSize({ width: Math.floor(width), height: Math.floor(height) })
    }

    updateSize()
    const observer = typeof ResizeObserver !== 'undefined' && mediaWrapperRef.current
      ? new ResizeObserver(updateSize)
      : null
    if (observer && mediaWrapperRef.current) observer.observe(mediaWrapperRef.current)
    window.addEventListener('resize', updateSize)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updateSize)
    }
  }, [mediaSize])

  function isFullCaptureArea(area: CaptureCrop | null) {
    if (!area) return true
    return area.x <= 0.001 && area.y <= 0.001 && area.width >= 0.999 && area.height >= 0.999
  }

  function beginCaptureAreaEdit() {
    setCaptureArea(current => current || { x: 0.05, y: 0.05, width: 0.9, height: 0.9 })
    setFullCaptureAreaOverride(false)
    setEditingCaptureArea(true)
  }

  useEffect(() => {
    if (existingSessionId) return
    if (autoStartedRef.current) return
    autoStartedRef.current = true
    startCamera()
  }, [existingSessionId, startCamera])

  useEffect(() => {
    if (!existingSessionId) {
      setPreviewUrl(null)
      return
    }

    let cancelled = false
    setLoadingPreview(true)
    setError(null)

    getSession(existingSessionId)
      .then((session) => {
        if (cancelled) return
        const imagePath = session.original_image_path
          ? `/storage/${session.original_image_path}`
          : session.corrected_image_path
            ? `/storage/${session.corrected_image_path}`
            : null
        setPreviewUrl(imagePath ? getImageUrl(imagePath) : null)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load previous capture.')
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false)
      })

    return () => { cancelled = true }
  }, [existingSessionId])

  const canSkipToSave = photoStationsEnabled && fromSaveAndNewLoop && Boolean(selectedStationId && preferredTracer)

  function traceParams(stationId: string | null, skipToSave = false) {
    const params = new URLSearchParams({ capture: '1' })
    if (stationId) {
      params.set('station', stationId)
      params.set('stationApplied', '1')
    }
    if (fromSaveAndNewLoop) params.set('loop', '1')
    if (skipToSave) params.set('skipToSave', '1')
    return params
  }

  async function processSessionToSave(sessionId: string, stationId: string) {
    if (!preferredTracer) throw new Error('Select a tracer before using Skip to Save.')

    setQuickStatus('Preparing corners...')
    let session = await getSession(sessionId)

    if (!session.corrected_image_path) {
      if (!session.corners || session.corners.length !== 4 || !session.paper_size) {
        throw new Error('Station corners were not applied to this photo.')
      }
      setQuickStatus('Correcting photo...')
      await setCorners(sessionId, session.corners, session.paper_size)
      session = await getSession(sessionId)
    }

    if (!session.polygons || session.polygons.length === 0) {
      setQuickStatus('Tracing tools...')
      await traceTools(sessionId, 'google', undefined, preferredTracer)
    }

    setQuickStatus('Opening Save...')
    stream?.getTracks().forEach((track) => track.stop())
    router.push(`/trace/${sessionId}?${traceParams(stationId, true).toString()}`)
  }

  async function uploadFile(file: File, skipToSave = false) {
    setUploading(true)
    setQuickProcessing(skipToSave)
    setQuickStatus(skipToSave ? 'Uploading photo...' : null)
    setError(null)
    try {
      const uploadStationId = photoStationsEnabled ? selectedStationId : null
      const uploadCaptureArea = photoStationsEnabled && captureArea && !isFullCaptureArea(captureArea)
        ? captureArea
        : photoStationsEnabled && fullCaptureAreaOverride
          ? { x: 0, y: 0, width: 1, height: 1 }
          : null
      const result = await uploadImage(file, uploadStationId, uploadCaptureArea)
      stream?.getTracks().forEach((track) => track.stop())
      const appliedStationId = photoStationsEnabled ? result.station_id || selectedStationId : null
      if (skipToSave) {
        if (!appliedStationId || result.corner_source !== 'station') {
          throw new Error('The selected station could not be reused for this photo.')
        }
        await processSessionToSave(result.session_id, appliedStationId)
        return
      }

      const params = new URLSearchParams({ capture: '1' })
      if (appliedStationId) {
        params.set('station', appliedStationId)
        params.set('stationApplied', result.corner_source === 'station' ? '1' : '0')
      }
      if (fromSaveAndNewLoop) params.set('loop', '1')
      router.push(`/trace/${result.session_id}?${params.toString()}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed')
    } finally {
      setUploading(false)
      setQuickProcessing(false)
      setQuickStatus(null)
    }
  }

  async function skipExistingSessionToSave() {
    if (!existingSessionId || !selectedStationId) return
    setUploading(true)
    setQuickProcessing(true)
    setError(null)
    try {
      await processSessionToSave(existingSessionId, selectedStationId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to skip to save')
    } finally {
      setUploading(false)
      setQuickProcessing(false)
      setQuickStatus(null)
    }
  }

  function captureFrame(skipToSave = false) {
    const video = videoRef.current
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setError('Camera is not ready yet.')
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      setError('Could not capture this camera frame.')
      return
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (!blob) {
        setError('Could not encode this camera frame.')
        return
      }
      uploadFile(new File([blob], `tracefinity-camera-${Date.now()}.jpg`, { type: 'image/jpeg' }), skipToSave)
    }, 'image/jpeg', 0.92)
  }

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col w-full">
      <StepBar steps={STEPS} current={0} />

      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        <div className="md:w-[240px] md:flex-shrink-0 bg-surface border-b md:border-b-0 md:border-r border-border overflow-y-auto flex flex-col max-h-[40vh] md:max-h-none">
          <div className="p-3 space-y-3">
            <div className="glass rounded-[10px] px-3 py-3">
              <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-widest mb-2">
                Capture
              </h3>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={startCamera}
                  disabled={starting || uploading}
                  className="btn-secondary w-full py-1.5 text-sm inline-flex items-center justify-center gap-1.5"
                >
                  {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                  {stream ? 'Restart camera' : previewUrl ? 'Recapture' : 'Start camera'}
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="btn-secondary w-full py-1.5 text-sm inline-flex items-center justify-center gap-1.5"
                >
                  <Upload className="w-4 h-4" />
                  Upload file
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) uploadFile(file)
                    e.target.value = ''
                  }}
                  className="hidden"
                />
              </div>
            </div>

            {photoStationsEnabled && (
              <>
                <div className="glass rounded-[10px] px-3 py-3">
                  <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-widest mb-2">
                    Photo Station
                  </h3>
                  <select
                    value={selectedStationId || ''}
                    onChange={(e) => setSelectedStationId(e.target.value || null)}
                    disabled={uploading || loadingStations}
                    className="w-full h-9 px-2 rounded-[8px] bg-elevated border border-border-subtle text-sm text-text-primary focus:outline-none focus:border-accent"
                  >
                    <option value="">
                      {loadingStations ? 'Loading stations...' : 'No station'}
                    </option>
                    {stations.map((station) => (
                      <option key={station.id} value={station.id}>
                        {station.name}
                      </option>
                    ))}
                  </select>
                  {selectedStationId && (
                    <p className="mt-1.5 text-[11px] text-text-muted">
                      Saved corners and capture area will be reused.
                    </p>
                  )}
                </div>

                <div className="glass rounded-[10px] px-3 py-3">
                  <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-widest mb-2">
                    Capture Area
                  </h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-text-secondary">
                        {isFullCaptureArea(captureArea) ? 'Full frame' : editingCaptureArea ? 'Editing' : 'Cropped'}
                      </span>
                      {captureArea && !isFullCaptureArea(captureArea) && (
                        <span className="text-text-muted">
                          {Math.round(captureArea.width * 100)}% x {Math.round(captureArea.height * 100)}%
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={beginCaptureAreaEdit}
                      disabled={uploading || (!stream && !previewUrl)}
                      className="btn-secondary w-full py-1.5 text-sm inline-flex items-center justify-center gap-1.5"
                    >
                      <Crop className="w-4 h-4" />
                      {captureArea ? 'Edit area' : 'Set area'}
                    </button>
                    {captureArea && (
                      <button
                        type="button"
                        onClick={() => {
                          setCaptureArea(null)
                          setFullCaptureAreaOverride(true)
                          setEditingCaptureArea(false)
                        }}
                        disabled={uploading}
                        className="btn-secondary w-full py-1.5 text-sm inline-flex items-center justify-center"
                      >
                        Full frame
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}

            {error && <Alert variant="error">{error}</Alert>}
          </div>

          <div className="p-3 md:mt-auto space-y-2">
            {canSkipToSave && (
              <button
                type="button"
                onClick={() => existingSessionId && previewUrl && !stream ? skipExistingSessionToSave() : captureFrame(true)}
                disabled={uploading || (existingSessionId && previewUrl && !stream ? false : !stream)}
                className="btn-primary w-full py-2 text-sm inline-flex items-center justify-center gap-1.5"
              >
                {quickProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <SkipForward className="w-4 h-4" />}
                {quickProcessing ? quickStatus || 'Processing...' : 'Skip to Save'}
              </button>
            )}
            {previewUrl && existingSessionId && !stream ? (
              <button
                type="button"
                onClick={() => {
                  const params = new URLSearchParams({ capture: '1' })
                  if (photoStationsEnabled && selectedStationId) {
                    params.set('station', selectedStationId)
                    if (stationApplied) params.set('stationApplied', '1')
                  }
                  if (fromSaveAndNewLoop) params.set('loop', '1')
                  router.push(`/trace/${existingSessionId}?${params.toString()}`)
                }}
                disabled={uploading}
                className={`${canSkipToSave ? 'btn-secondary' : 'btn-primary'} w-full py-2 text-sm inline-flex items-center justify-center gap-1.5`}
              >
                Continue to Corners
              </button>
            ) : (
              <button
                type="button"
                onClick={() => captureFrame()}
                disabled={!stream || uploading}
                className={`${canSkipToSave ? 'btn-secondary' : 'btn-primary'} w-full py-2 text-sm inline-flex items-center justify-center gap-1.5`}
              >
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                {uploading ? 'Uploading...' : 'Capture'}
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 bg-base overflow-hidden p-3">
          <div ref={mediaWrapperRef} className="w-full h-full flex items-center justify-center">
            <div
              ref={mediaContainerRef}
              className="relative bg-inset rounded-lg overflow-hidden flex items-center justify-center"
              style={
                fittedSize.width && fittedSize.height
                  ? { width: fittedSize.width, height: fittedSize.height }
                  : { width: '100%', maxWidth: 640, aspectRatio: '4 / 3' }
              }
            >
              {stream ? (
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  autoPlay
                  onLoadedMetadata={(e) => {
                    setMediaSize({
                      width: e.currentTarget.videoWidth,
                      height: e.currentTarget.videoHeight,
                    })
                  }}
                  className="w-full h-full"
                />
              ) : previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Previous capture"
                  onLoad={(e) => {
                    setMediaSize({
                      width: e.currentTarget.naturalWidth,
                      height: e.currentTarget.naturalHeight,
                    })
                  }}
                  className="w-full h-full"
                />
              ) : loadingPreview ? (
                <div className="text-center px-6">
                  <Loader2 className="w-6 h-6 mx-auto mb-4 animate-spin text-text-secondary" />
                  <p className="text-sm font-semibold text-text-primary">Loading capture...</p>
                </div>
              ) : (
                <div className="text-center px-6">
                  <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-elevated flex items-center justify-center">
                    <Camera className="w-6 h-6 text-text-secondary" />
                  </div>
                  <p className="text-sm font-semibold text-text-primary">No camera preview</p>
                  <p className="mt-1 text-xs text-text-muted">Start the camera or upload a photo to continue.</p>
                </div>
              )}
              {captureArea && (stream || previewUrl) && (
                <CaptureAreaOverlay
                  area={captureArea}
                  editing={editingCaptureArea}
                  containerRef={mediaContainerRef}
                  onChange={setCaptureArea}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
