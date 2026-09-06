import type {
  UploadResponse,
  CornersResponse,
  PhotoStation,
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
  ProjectHealthResponse,
  ProjectStatus,
  BinData,
  BinSummary,
  PlacedTool,
  TextLabel,
  PaperSize,
  AuthStatus,
  Account,
  LoginResult,
  TwoFactorEnrolment,
  BackupCodes,
  CreateUserRequest,
} from '@/types'

export class ApiError extends Error {
  status: number
  // stable identifier from the backend where one is offered; branch on this
  // rather than on the message text
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

// empty string means use relative URLs (same origin, for Docker)
// undefined means use default dev URL
const API_URL = process.env.NEXT_PUBLIC_API_URL === ''
  ? ''
  : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000')

// paths where a 401 is part of the flow, not a lost login
const AUTH_PAGES = ['/login', '/setup']

// object seam so tests can observe the redirect; jsdom's window.location
// is unforgeable and cannot be stubbed directly
export const navigation = {
  toLogin() {
    window.location.assign('/login')
  },
  // full navigation on auth changes so every cached query restarts
  toHome() {
    window.location.assign('/')
  },
  // destination has already been checked by the login server page
  afterLogin(destination: string) {
    window.location.assign(destination)
  },
}

function redirectToLogin() {
  if (typeof window === 'undefined') return
  if (AUTH_PAGES.includes(window.location.pathname)) return
  navigation.toLogin()
}

async function throwApiError(res: Response): Promise<never> {
  if (res.status === 401) redirectToLogin()
  const error = await res.json().catch(() => ({ detail: 'request failed' }))
  // detail is a plain string on most endpoints; the auth flow sends
  // { code, message } where the client needs to tell failures apart
  const detail = error?.detail
  if (detail && typeof detail === 'object') {
    throw new ApiError(detail.message || 'request failed', res.status, detail.code)
  }
  throw new ApiError(detail || 'request failed', res.status)
}

async function fetchApi<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!res.ok) {
    return throwApiError(res)
  }

  if (res.status === 204) {
    return undefined as T
  }
  return res.json()
}

async function fetchForm<T>(path: string, body: FormData): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { method: 'POST', body, credentials: 'include' })
  if (!res.ok) {
    return throwApiError(res)
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
  paperSize: PaperSize,
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

export async function getAvailableKeys(): Promise<{
  google: boolean
  provider: string | null
  provider_label: string | null
  tracers: TracerInfo[]
  photo_stations: boolean
}> {
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
    target_grid_x?: number | null
    target_grid_y?: number | null
    default_bin_config?: BinDefaults | null
  }
): Promise<BinProject> {
  return fetchApi(`/api/bin-projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
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

export async function listPhotoStations(): Promise<PhotoStation[]> {
  const res = await fetchApi<{ stations: PhotoStation[] }>('/api/photo-stations')
  return res.stations
}

export async function getPhotoStation(stationId: string): Promise<PhotoStation> {
  return fetchApi(`/api/photo-stations/${stationId}`)
}

export async function updatePhotoStation(
  stationId: string,
  updates: {
    name?: string
    paper_size?: PaperSize
    corners?: Point[]
  }
): Promise<PhotoStation> {
  return fetchApi(`/api/photo-stations/${stationId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
}

export async function deletePhotoStation(stationId: string): Promise<void> {
  await fetchApi(`/api/photo-stations/${stationId}`, { method: 'DELETE' })
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

// --- authentication and accounts ---

export async function getAuthStatus(): Promise<AuthStatus> {
  return fetchApi('/api/auth/status')
}

export async function setupAdmin(email: string, password: string): Promise<Account> {
  return fetchApi('/api/auth/setup', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export async function login(email: string, password: string): Promise<LoginResult> {
  return fetchApi('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export async function loginTwoFactor(pendingToken: string, code: string): Promise<LoginResult> {
  return fetchApi('/api/auth/login/2fa', {
    method: 'POST',
    body: JSON.stringify({ pending_token: pendingToken, code }),
  })
}

export async function logout(): Promise<void> {
  return fetchApi('/api/auth/logout', { method: 'POST' })
}

export async function getMe(): Promise<Account> {
  return fetchApi('/api/auth/me')
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return fetchApi('/api/auth/password', {
    method: 'POST',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  })
}

export async function enrollTwoFactor(): Promise<TwoFactorEnrolment> {
  return fetchApi('/api/auth/2fa/enroll', { method: 'POST' })
}

export async function confirmTwoFactor(code: string): Promise<BackupCodes> {
  return fetchApi('/api/auth/2fa/confirm', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

export async function disableTwoFactor(password: string, code: string): Promise<void> {
  return fetchApi('/api/auth/2fa/disable', {
    method: 'POST',
    body: JSON.stringify({ password, code }),
  })
}

export async function regenerateBackupCodes(password: string, code: string): Promise<BackupCodes> {
  return fetchApi('/api/auth/2fa/backup-codes', {
    method: 'POST',
    body: JSON.stringify({ password, code }),
  })
}

export async function listUsers(): Promise<{ users: Account[] }> {
  return fetchApi('/api/admin/users')
}

export async function createUser(req: CreateUserRequest): Promise<Account> {
  return fetchApi('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export async function disableUser(id: string): Promise<Account> {
  return fetchApi(`/api/admin/users/${id}/disable`, { method: 'POST' })
}

export async function enableUser(id: string): Promise<Account> {
  return fetchApi(`/api/admin/users/${id}/enable`, { method: 'POST' })
}

export async function resetUserPassword(id: string, password: string): Promise<void> {
  return fetchApi(`/api/admin/users/${id}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  })
}

export async function clearUserTwoFactor(id: string): Promise<void> {
  return fetchApi(`/api/admin/users/${id}/clear-2fa`, { method: 'POST' })
}
