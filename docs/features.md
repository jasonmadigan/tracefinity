# Feature Inventory

Reference for AI agents. Check here before suggesting new features or claiming something is missing.

## Tracing and Image Processing

- Image upload (drag-drop or file picker, JPG/PNG/WebP/HEIC)
- Paper corner detection with draggable handles
- Paper size presets (A4, Letter, A3, Tabloid)
- Photo quality warnings before tracing (camera too close via EXIF focal length, paper cut off at the frame edge, extreme perspective)
- AI tracing (multiple tracer backends: IS-Net, BiRefNet, InSPyReNet)
- Remote tracing via Replicate (`REPLICATE_API_TOKEN`, model `men1scus/birefnet` by default; `REPLICATE_RESOLUTION` optional)
- Remote tracing via fal.ai (`FAL_KEY`, model `fal-ai/birefnet/v2` by default; `FAL_OPERATING_RESOLUTION` default `1024x1024`). Uses `sync_mode` so results are not stored in fal request history; Replicate predictions auto-purge after ~1h.
- Manual mask upload
- Corrected image download
- Prompt copy to clipboard
- Mask preview
- Session persistence (save in-progress tracing)
- Step navigation (corners/trace/edit)
- Tool selection with include/exclude checkboxes
- Session renaming

## Polygon Editing

- Vertex add/remove/drag
- Grid snap (5mm increments, toggle on/off)
- Smoothing toggle (accurate vs smooth) with smoothness slider
- 90-degree rotation (clockwise/counter-clockwise)
- Flip/mirror (horizontal and vertical)
- Auto-rotate (minimise bounding box)
- Interior rings / fill-in mode for donut shapes
- Undo/redo (Ctrl+Z / Ctrl+Shift+Z)
- Source image overlay with opacity control
- Zoom/pan (spacebar to pan)
- SVG export of tool outline

## Cutouts (Finger Holes and Pockets)

- Finger hole tool (15mm default)
- Circle mode (spherical pocket, 10mm default)
- Cylinder mode (flat-bottomed circular, 10mm default)
- Square mode (20mm default)
- Rectangle mode (30x20mm default)
- Drag to move, corner handles to resize
- Rotation handle on rectangular cutouts
- Per-hole depth override
- Delete individual holes

## Bin Configuration

- Grid sizing (width/depth in gridfinity units, 1-10, 0.5-unit increments for 21mm half-grid)
- Bin height in units (7mm each + 4.75mm base)
- Cutout depth (5mm to max)
- Clearance (0-5mm extra space around tools)
- Cutout chamfer toggle
- Magnet holes (enable/disable, diameter and depth)
- Magnets at corners only option
- Stacking lip toggle
- Raise lip (extend wall/lip above the floor face in 7mm units so a stacked bin clears a protruding tool)
- Half-grid base (21mm cells for finer baseplate positioning)
- Insert mode (contrast insert with configurable height)
- Bed size for auto-splitting large bins
- Partial bins (disable individual grid cells to reduce print volume)
- Auto-size grid to fit placed tools
- Save/reset default bin configuration (global and per-project)

## Bin Layout and Placement

- Drag-and-drop tools from library into bin
- Click to select placed tools
- Drag to reposition (with/without snap)
- Text labels with emboss/recess options
- Label editing (text, font size, emboss depth)
- Per-tool cutout depth override
- Auto-centre tools in expanded grids
- Centre view (fit all to viewport)

## Export

- STL download (single or multi-part)
- 3MF export (for slicers supporting it)
- ZIP export (split parts as separate STLs)
- Insert STL (separate contrast insert model)
- SVG export (from tool editor)
- Split preview when bin exceeds bed size

## Projects

- Create named projects
- Project status (active, ready_to_print, printed, archived)
- Add/remove tools from projects
- Link/detach bins
- Create bin from project (with preset config)
- Project health check (validate assignments)
- Project repair (auto-fix orphaned items)
- Bulk tool import
- Bin import (with/without tool reassignment)
- Filter tool library by project membership

## Drawer Planning

- Several drawer plans per project, each with its own name and grid
- Optional drawer grid size per plan (width/depth in gridfinity units)
- 2D top-down drawer sketch with bin footprints, tool outlines and bin height indicators
- 3D drawer view rendering the generated bin models, with the same camera presets and edge display as the bin preview
- Drag and drop bins from the project bin list onto the grid
- Drag to move, rotate in 90 degree steps, duplicate, remove placements
- Same bin can be placed multiple times
- Snapping follows each bin's base: full units, or half units for half-grid bins
- Per-bin highlight colours
- Auto arrange (largest bins first) and space usage stats
- Overlap and out-of-drawer warnings

## Tool Library

- Search by name
- Sort by date or alphabetical
- Inline rename
- Delete tools
- Thumbnails with hover preview
- Assignment indicators (which project)
- Placement status ("placed" vs "needs bin")
- Click-through to project view

## 3D Preview

- Interactive real-time 3D viewer (react-three-fiber)
- Split visualisation for multi-part bins
- Insert display when enabled
- Pan/zoom/rotate

## Settings and UI

- Dark/light mode toggle
- Guided tour / onboarding
- Section collapse (remembered state)
- Help tooltips with keyboard shortcut hints
- Default bin settings (global via localStorage, per-project via API)

## Keyboard Shortcuts

- Ctrl+Z: undo
- Ctrl+Shift+Z: redo
- Escape: close modals/dropdowns
- Enter: confirm text input
- Spacebar: pan canvas (hold)
