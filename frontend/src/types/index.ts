export interface Point {
  x: number
  y: number
}

export interface FingerHole {
  id: string
  x: number
  y: number
  radius: number
  rotation?: number
  shape?: 'circle' | 'square' | 'rectangle'
  width?: number
  height?: number
}

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
  paper_size: 'a4' | 'letter' | null
  scale_factor: number | null
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
}

export interface BinConfig {
  grid_x: number
  grid_y: number
  height_units: number
  magnets: boolean
  stacking_lip: boolean
  wall_thickness: number
  cutout_depth: number
  cutout_clearance: number
  text_labels: TextLabel[]
  bed_size: number
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
  created_at: string | null
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
}

export interface BinData {
  id: string
  name: string | null
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
  created_at: string | null
  tool_count: number
  has_stl: boolean
  grid_x: number
  grid_y: number
  preview_tools: BinPreviewTool[]
}
