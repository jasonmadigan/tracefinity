import type {
  UploadResponse,
  CornersResponse,
  TraceResponse,
  GenerateResponse,
  Point,
  Polygon,
  BinDefaults,
  BinConfig,
  Session,
  SessionSummary,
  Tool,
  ToolSummary,
  BinProject,
  BinProjectSummary,
  ProjectBinPlacement,
  ProjectHealthResponse,
  ProjectSketch,
  ProjectStatus,
  BinData,
  BinSummary,
  PlacedTool,
  TextLabel,
  PaperSize,
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

async function fetchForm<T>(path: string, body: FormData): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { method: 'POST', body })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'request failed' }))
    throw new ApiError(err.detail || 'request failed', res.status)
  }
  return res.json()
}

export async function uploadImage(file: File): Promise<UploadResponse> {
  const formData = new FormData()
  formData.append('image', file)
  return fetchForm('/api/upload', formData)
}

export async function setCorners(
  sessionId: string,
  corners: Point[],
  paperSize: PaperSize
): Promise<CornersResponse> {
  return fetchApi(`/api/sessions/${sessionId}/corners`, {
    method: 'POST',
    body: JSON.stringify({ corners, paper_size: paperSize }),
  })
}

export interface TracerInfo {
  id: string
  label: string
}

export async function getAvailableKeys(): Promise<{ google: boolean; provider: string | null; provider_label: string | null; tracers: TracerInfo[] }> {
  return fetchApi('/api/api-keys')
}

export async function getAppVersion(): Promise<string> {
  const res = await fetchApi<{ version: string }>('/api/version')
  return res.version
}

export async function traceTools(
  sessionId: string,
  provider: 'google',
  apiKey?: string,
  tracer?: string,
): Promise<TraceResponse> {
  return fetchApi(`/api/sessions/${sessionId}/trace`, {
    method: 'POST',
    body: JSON.stringify({
      provider,
      api_key: apiKey || null,
      tracer: tracer || null,
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
  return fetchForm(`/api/sessions/${sessionId}/trace-mask`, formData)
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
  updates: {
    name?: string
    points?: Point[]
    finger_holes?: import('@/types').FingerHole[]
    interior_rings?: Point[][]
    smoothed?: boolean
    smooth_level?: number
    source_image_transform?: import('@/types').AffineMatrix
    category?: string | null
    drawer?: string | null
    tags?: string[]
    project_ids?: string[]
    review_status?: string | null
    needs_cleanup?: boolean
  }
): Promise<void> {
  await fetchApi(`/api/tools/${toolId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  })
}

export async function autoRotateTool(toolId: string): Promise<{ angle: number }> {
  return fetchApi(`/api/tools/${toolId}/auto-rotate`, { method: 'POST' })
}

export async function deleteTool(toolId: string): Promise<void> {
  await fetchApi(`/api/tools/${toolId}`, { method: 'DELETE' })
}

export function getToolSvgUrl(toolId: string): string {
  return `${API_URL}/api/files/tools/${toolId}/tool.svg`
}

export async function saveToolsFromSession(sessionId: string, polygonIds?: string[]): Promise<string[]> {
  const res = await fetchApi<{ tool_ids: string[] }>(`/api/sessions/${sessionId}/save-tools`, {
    method: 'POST',
    body: polygonIds ? JSON.stringify({ polygon_ids: polygonIds }) : undefined,
  })
  return res.tool_ids
}

// --- projects ---

export async function listProjects(): Promise<BinProjectSummary[]> {
  const res = await fetchApi<{ projects: BinProjectSummary[] }>('/api/bin-projects')
  return res.projects
}

export async function createProject(opts: {
  name: string
  description?: string | null
  status?: ProjectStatus
  default_bin_config?: BinDefaults | null
  tool_ids?: string[]
}): Promise<BinProject> {
  return fetchApi('/api/bin-projects', {
    method: 'POST',
    body: JSON.stringify(opts),
  })
}

export async function getProject(projectId: string): Promise<BinProject> {
  return fetchApi(`/api/bin-projects/${projectId}`)
}

export async function updateProject(
  projectId: string,
  updates: {
    name?: string
    description?: string | null
    status?: ProjectStatus
    notes?: string | null
    default_bin_config?: BinDefaults | null
  }
): Promise<BinProject> {
  return fetchApi(`/api/bin-projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
}

export async function createProjectSketch(
  projectId: string,
  sketch: { name?: string; target_grid_x?: number | null; target_grid_y?: number | null } = {},
): Promise<ProjectSketch> {
  return fetchApi(`/api/bin-projects/${projectId}/sketches`, {
    method: 'POST',
    body: JSON.stringify(sketch),
  })
}

export async function updateProjectSketch(
  projectId: string,
  sketchId: string,
  updates: {
    name?: string
    target_grid_x?: number | null
    target_grid_y?: number | null
    bin_layout?: ProjectBinPlacement[]
  },
): Promise<ProjectSketch> {
  return fetchApi(`/api/bin-projects/${projectId}/sketches/${sketchId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
}

export async function deleteProjectSketch(projectId: string, sketchId: string): Promise<void> {
  await fetchApi(`/api/bin-projects/${projectId}/sketches/${sketchId}`, { method: 'DELETE' })
}

export async function deleteProject(projectId: string): Promise<void> {
  await fetchApi(`/api/bin-projects/${projectId}`, { method: 'DELETE' })
}

export async function addToolsToProject(projectId: string, toolIds: string[]): Promise<BinProject> {
  return fetchApi(`/api/bin-projects/${projectId}/tools`, {
    method: 'POST',
    body: JSON.stringify({ tool_ids: toolIds }),
  })
}

export async function removeToolFromProject(projectId: string, toolId: string): Promise<BinProject> {
  return fetchApi(`/api/bin-projects/${projectId}/tools/${toolId}`, { method: 'DELETE' })
}

export async function getProjectHealth(projectId: string): Promise<ProjectHealthResponse> {
  return fetchApi(`/api/bin-projects/${projectId}/health`)
}

export async function repairProject(projectId: string): Promise<ProjectHealthResponse> {
  return fetchApi(`/api/bin-projects/${projectId}/repair`, { method: 'POST' })
}

export async function addBinsToProject(
  projectId: string,
  opts: { bin_ids: string[]; import_tools?: boolean; allow_reassign?: boolean }
): Promise<BinProject> {
  return fetchApi(`/api/bin-projects/${projectId}/bins`, {
    method: 'POST',
    body: JSON.stringify(opts),
  })
}

export async function detachBinFromProject(projectId: string, binId: string): Promise<BinProject> {
  return fetchApi(`/api/bin-projects/${projectId}/bins/${binId}`, { method: 'DELETE' })
}

export async function createProjectBin(
  projectId: string,
  opts: { name?: string | null; tool_ids?: string[] | null; bin_config?: BinDefaults | null } = {}
): Promise<BinData> {
  return fetchApi(`/api/bin-projects/${projectId}/create-bin`, {
    method: 'POST',
    body: JSON.stringify(opts),
  })
}

// --- bins ---

export async function listBins(): Promise<BinSummary[]> {
  const res = await fetchApi<{ bins: BinSummary[] }>('/api/bins')
  return res.bins
}

export async function getBin(binId: string): Promise<BinData> {
  return fetchApi(`/api/bins/${binId}`)
}

export async function createBin(opts: { name?: string; project_id?: string | null; tool_ids?: string[]; bin_config?: BinDefaults | null } = {}): Promise<BinData> {
  return fetchApi('/api/bins', {
    method: 'POST',
    body: JSON.stringify(opts),
  })
}

export async function updateBin(
  binId: string,
  updates: {
    name?: string
    project_id?: string | null
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

export function getBinInsertUrl(binId: string): string {
  return `${API_URL}/api/files/bins/${binId}/bin_insert.stl`
}
