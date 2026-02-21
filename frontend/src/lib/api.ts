import type {
  UploadResponse,
  CornersResponse,
  TraceResponse,
  GenerateResponse,
  Point,
  Polygon,
  BinConfig,
  Session,
  SessionSummary,
  Tool,
  ToolSummary,
  BinData,
  BinSummary,
  PlacedTool,
  TextLabel,
} from '@/types'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// empty string means use relative URLs (same origin, for Docker)
// undefined means use default dev URL
const API_URL = process.env.NEXT_PUBLIC_API_URL === ''
  ? ''
  : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000')

async function fetchApi<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: 'request failed' }))
    throw new ApiError(error.detail || 'request failed', res.status)
  }

  return res.json()
}

export async function uploadImage(file: File): Promise<UploadResponse> {
  const formData = new FormData()
  formData.append('image', file)

  const res = await fetch(`${API_URL}/api/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    throw new Error('upload failed')
  }

  return res.json()
}

export async function setCorners(
  sessionId: string,
  corners: Point[],
  paperSize: 'a4' | 'letter'
): Promise<CornersResponse> {
  return fetchApi(`/api/sessions/${sessionId}/corners`, {
    method: 'POST',
    body: JSON.stringify({ corners, paper_size: paperSize }),
  })
}

export async function getAvailableKeys(): Promise<{ google: boolean }> {
  return fetchApi('/api/api-keys')
}

export async function traceTools(
  sessionId: string,
  provider: 'google',
  apiKey?: string
): Promise<TraceResponse> {
  return fetchApi(`/api/sessions/${sessionId}/trace`, {
    method: 'POST',
    body: JSON.stringify({
      provider,
      api_key: apiKey || null,
    }),
  })
}

export async function updatePolygons(
  sessionId: string,
  polygons: Polygon[]
): Promise<void> {
  await fetchApi(`/api/sessions/${sessionId}/polygons`, {
    method: 'PUT',
    body: JSON.stringify({ polygons }),
  })
}

export async function generateStl(
  sessionId: string,
  config: BinConfig,
  polygons?: Polygon[]
): Promise<GenerateResponse> {
  return fetchApi(`/api/sessions/${sessionId}/generate`, {
    method: 'POST',
    body: JSON.stringify({ ...config, polygons }),
  })
}

export async function getSession(sessionId: string): Promise<Session> {
  return fetchApi(`/api/sessions/${sessionId}`)
}

export function getImageUrl(path: string): string {
  return `${API_URL}${path}`
}

export function getStlUrl(sessionId: string): string {
  return `${API_URL}/api/files/${sessionId}/bin.stl`
}

export function getThreemfUrl(sessionId: string): string {
  return `${API_URL}/api/files/${sessionId}/bin.3mf`
}

export function getZipUrl(sessionId: string): string {
  return `${API_URL}/api/files/${sessionId}/bin_parts.zip`
}

export async function listSessions(): Promise<SessionSummary[]> {
  const res = await fetchApi<{ sessions: SessionSummary[] }>('/api/sessions')
  return res.sessions
}

export async function deleteSession(sessionId: string): Promise<void> {
  await fetchApi(`/api/sessions/${sessionId}`, { method: 'DELETE' })
}

export async function updateSession(
  sessionId: string,
  updates: { name?: string; description?: string; tags?: string[] }
): Promise<void> {
  await fetchApi(`/api/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
}

export async function traceFromMask(
  sessionId: string,
  maskFile: File
): Promise<TraceResponse> {
  const formData = new FormData()
  formData.append('mask', maskFile)

  const res = await fetch(`${API_URL}/api/sessions/${sessionId}/trace-mask`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: 'upload failed' }))
    throw new Error(error.detail || 'upload failed')
  }

  return res.json()
}

// backwards compat
export async function renameSession(sessionId: string, name: string): Promise<void> {
  await updateSession(sessionId, { name })
}

// --- tool library ---

export async function listTools(): Promise<ToolSummary[]> {
  const res = await fetchApi<{ tools: ToolSummary[] }>('/api/tools')
  return res.tools
}

export async function getTool(toolId: string): Promise<Tool> {
  return fetchApi(`/api/tools/${toolId}`)
}

export async function updateTool(
  toolId: string,
  updates: { name?: string; points?: Point[]; finger_holes?: import('@/types').FingerHole[]; smoothed?: boolean; smooth_level?: number }
): Promise<void> {
  await fetchApi(`/api/tools/${toolId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  })
}

export async function deleteTool(toolId: string): Promise<void> {
  await fetchApi(`/api/tools/${toolId}`, { method: 'DELETE' })
}

export function getToolSvgUrl(toolId: string): string {
  return `${API_URL}/api/files/tools/${toolId}/tool.svg`
}

export async function saveToolsFromSession(sessionId: string): Promise<string[]> {
  const res = await fetchApi<{ tool_ids: string[] }>(`/api/sessions/${sessionId}/save-tools`, {
    method: 'POST',
  })
  return res.tool_ids
}

// --- bins ---

export async function listBins(): Promise<BinSummary[]> {
  const res = await fetchApi<{ bins: BinSummary[] }>('/api/bins')
  return res.bins
}

export async function getBin(binId: string): Promise<BinData> {
  return fetchApi(`/api/bins/${binId}`)
}

export async function createBin(opts: { name?: string; tool_ids?: string[] } = {}): Promise<BinData> {
  return fetchApi('/api/bins', {
    method: 'POST',
    body: JSON.stringify(opts),
  })
}

export async function updateBin(
  binId: string,
  updates: {
    name?: string
    bin_config?: BinConfig
    placed_tools?: PlacedTool[]
    text_labels?: TextLabel[]
  }
): Promise<void> {
  await fetchApi(`/api/bins/${binId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  })
}

export async function deleteBin(binId: string): Promise<void> {
  await fetchApi(`/api/bins/${binId}`, { method: 'DELETE' })
}

export async function generateBinStl(binId: string, signal?: AbortSignal): Promise<GenerateResponse> {
  return fetchApi(`/api/bins/${binId}/generate`, {
    method: 'POST',
    signal,
  })
}

export function getBinStlUrl(binId: string): string {
  return `${API_URL}/api/files/bins/${binId}/bin.stl`
}

export function getBinZipUrl(binId: string): string {
  return `${API_URL}/api/files/bins/${binId}/bin_parts.zip`
}

export function getBinThreemfUrl(binId: string): string {
  return `${API_URL}/api/files/bins/${binId}/bin.3mf`
}
