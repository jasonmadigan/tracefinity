export interface Point {
  x: number
  y: number
}

export type PaperSize = 'a4' | 'letter' | 'a3' | 'tabloid'

export interface FingerHole {
  id: string
  x: number
  y: number
  radius: number
  rotation?: number
  shape?: CutoutShape
  width?: number
  height?: number
  depth_override?: number | null
}

export type CutoutShape = 'circle' | 'cylinder' | 'square' | 'rectangle' | 'filleted_rectangle'

export interface Polygon {
  id: string
  points: Point[]
  label: string
  finger_holes: FingerHole[]
  interior_rings: Point[][]
}

export interface TextLabel {
  id: string
  text: string
  x: number
  y: number
  font_size: number
  rotation: number
  emboss: boolean
  depth: number
}

export interface Layout {
  bin_config: BinConfig
  polygons: Polygon[]
  text_labels: TextLabel[]
}

export interface PhotoWarning {
  code: string
  message: string
}

export interface Session {
  id: string
  name: string | null
  description: string | null
  tags: string[]
  created_at: string | null
  original_image_path: string | null
  corrected_image_path: string | null
  mask_image_path: string | null
  corners: Point[] | null
  paper_size: PaperSize | null
  scale_factor: number | null
  focal_length_35mm: number | null
  photo_warnings: PhotoWarning[] | null
  polygons: Polygon[] | null
  stl_path: string | null
  layout: Layout | null
}

export interface SessionSummary {
  id: string
  name: string | null
  description: string | null
  tags: string[]
  created_at: string | null
  thumbnail_url: string | null
  tool_count: number
  has_stl: boolean
}

export interface UploadResponse {
  session_id: string
  image_url: string
  detected_corners: Point[] | null
}

export interface CornersResponse {
  corrected_image_url: string
  scale_factor: number
  warnings: PhotoWarning[]
}

export interface TraceResponse {
  polygons: Polygon[]
  mask_url: string | null
}

export interface GenerateResponse {
  stl_url: string
  stl_urls?: string[]
  threemf_url?: string
  split_count?: number
  zip_url?: string | null
  insert_stl_url?: string | null
  warning?: string | null
}

export interface BinDefaults {
  grid_x: number
  grid_y: number
  height_units: number
  magnets: boolean
  magnet_diameter: number
  magnet_depth: number
  magnet_corners_only: boolean
  stacking_lip: boolean
  rim_units: number
  wall_thickness: number
  cutout_depth: number
  cutout_clearance: number
  cutout_chamfer: number
  insert_enabled: boolean
  insert_height: number
  insert_clearance: number
  half_grid_base: boolean
  partial_bins: boolean
  partial_bins_values: boolean[]
  partial_bins_connect: boolean
  partial_bins_retain_wall: boolean
  bed_size: number
}

export interface BinConfig extends BinDefaults {
  text_labels: TextLabel[]
}

// --- tool library ---

export interface Tool {
  id: string
  name: string
  points: Point[]
  finger_holes: FingerHole[]
  interior_rings: Point[][]
  smoothed: boolean
  smooth_level: number
  source_session_id: string | null
  image_context: ToolImageContext | null
  category: string | null
  drawer: string | null
  tags: string[]
  project_ids: string[]
  review_status: string | null
  needs_cleanup: boolean
  created_at: string | null
}

export type AffineMatrix = [number, number, number, number, number, number]

export interface ToolImageContext {
  image_url: string
  image_width: number
  image_height: number
  origin_x_mm: number
  origin_y_mm: number
  scale_factor: number
  transform: AffineMatrix
}

export interface ToolSummary {
  id: string
  name: string
  created_at: string | null
  point_count: number
  points: Point[]
  interior_rings: Point[][]
  smoothed: boolean
  smooth_level: number
  thumbnail_url: string | null
  image_transform: AffineMatrix | null
  image_context: ToolImageContext | null
  category: string | null
  drawer: string | null
  tags: string[]
  project_ids: string[]
  review_status: string | null
  needs_cleanup: boolean
}

// --- projects ---

export type ProjectStatus = 'active' | 'ready_to_print' | 'printed' | 'archived'
export type ProjectHealthSeverity = 'warning' | 'error'
export type ProjectHealthCode =
  | 'missing_tool'
  | 'missing_bin'
  | 'bin_missing_project_id'
  | 'bin_project_mismatch'
  | 'outside_tool'
  | 'tool_missing_project_id'
  | 'tool_extra_project_id'

/** Position of one bin on the project drawer grid, in gridfinity units from the top-left. */
export interface ProjectBinPlacement {
  id: string
  bin_id: string
  x: number
  y: number
  rotation: number
  /** #rrggbb highlight colour, or null for the default bin colour. */
  color: string | null
}

/** One drawer plan inside a project: a grid plus the bins placed on it. */
export interface ProjectSketch {
  id: string
  name: string
  target_grid_x: number | null
  target_grid_y: number | null
  bin_layout: ProjectBinPlacement[]
  created_at: string | null
  updated_at: string | null
}

export interface BinProject {
  id: string
  name: string
  description: string | null
  status: ProjectStatus
  tool_ids: string[]
  bin_ids: string[]
  placed_tool_ids: string[]
  unplaced_tool_ids: string[]
  sketches: ProjectSketch[]
  default_bin_config: BinDefaults | null
  notes: string | null
  created_at: string | null
  updated_at: string | null
}

export interface BinProjectSummary {
  id: string
  name: string
  description: string | null
  status: ProjectStatus
  tool_count: number
  bin_count: number
  placed_count: number
  unplaced_count: number
  sketch_count: number
  created_at: string | null
  updated_at: string | null
}

export interface ProjectHealthIssue {
  code: ProjectHealthCode
  severity: ProjectHealthSeverity
  message: string
  tool_id: string | null
  bin_id: string | null
  other_project_id: string | null
  repairable: boolean
}

export interface ProjectHealthResponse {
  issues: ProjectHealthIssue[]
  repairable_count: number
  manual_count: number
}

// --- bins ---

export interface PlacedTool {
  id: string
  tool_id: string
  name: string
  points: Point[]
  finger_holes: FingerHole[]
  interior_rings: Point[][]
  rotation: number
  depth_override?: number | null
}

export interface BinData {
  id: string
  name: string | null
  project_id: string | null
  bin_config: BinConfig
  placed_tools: PlacedTool[]
  text_labels: TextLabel[]
  stl_path: string | null
  created_at: string | null
}

export interface BinPreviewTool {
  points: Point[]
  interior_rings: Point[][]
}

export interface BinSummary {
  id: string
  name: string | null
  project_id: string | null
  created_at: string | null
  tool_ids: string[]
  tool_count: number
  has_stl: boolean
  grid_x: number
  grid_y: number
  height_units: number
  half_grid_base: boolean
  preview_tools: BinPreviewTool[]
}
