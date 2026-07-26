# Architecture

## Backend (Python/FastAPI)
- Image upload with model-assisted paper corner detection (U2-Net Portable + OpenCV; falls back to OpenCV-only on non-AVX CPUs where ONNX is unavailable)
- Perspective correction using user-adjusted corners (portrait + landscape)
- Tool tracing via local models (BiRefNet Lite, IS-Net, InSPyReNet) or Gemini API
- Optional automatic tool naming from traced polygon crops through Ollama
- Manual mask upload as alternative
- Session persistence (JSON files)
- Tool library, bin, and bin project persistence (JSON files)
- STL/3MF generation with manifold3d

## Frontend (Next.js 16/React/TypeScript)
- Dashboard with project, tool library, and bin management
- Paper corner editor with draggable handles
- Polygon editor with vertex editing, undo/redo
- Tool editor for editing saved tools (vertices, finger holes)
- Bin editor for positioning tools in bins, adding text labels
- Project screen for planning a group of tools/bins and tracking placed vs unplaced tools
- Drawer plan screen for arranging project bins on a virtual gridfinity grid (2D + 3D)
- 3D STL preview (react-three-fiber)
- Shows user what prompts are sent to Gemini

## Project Structure

```
tracefinity/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── constants.py             # GF_GRID etc.
│   │   ├── api/routes.py
│   │   └── services/
│   │       ├── ai_tracer.py              # Gemini/local mask + contour tracing
│   │       ├── tool_namer.py             # optional ToolNamer interface for traced polygons
│   │       ├── image_processor.py         # paper detection + perspective
│   │       ├── polygon_scaler.py          # px-to-mm, clearance, smoothing
│   │       ├── stl_generator_manifold.py  # gridfinity STL + bin splitting
│   │       ├── bin_service.py             # placed-tool sync logic
│   │       ├── image_service.py           # tool thumbnail generation
│   │       ├── session_store.py
│   │       ├── tool_store.py              # tool library persistence
│   │       ├── bin_store.py               # bin persistence
│   │       ├── project_store.py           # bin project persistence
│   │       └── project_service.py         # project summaries, health, repair
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx               # dashboard (projects + tools + bins)
│   │   │   ├── trace/[id]/            # corner + polygon editing
│   │   │   ├── tools/[id]/            # tool vertex/hole editor
│   │   │   ├── projects/[id]/         # project planning workflow
│   │   │   │   └── sketch/[sketchId]/  # one drawer plan (bin placement on a grid)
│   │   │   └── bins/[id]/             # bin builder + 3D preview
│   │   ├── components/
│   │   │   ├── BinEditor.tsx          # bin layout orchestrator
│   │   │   ├── BinEditorToolbar.tsx   # bin toolbar (mode, snap, actions)
│   │   │   ├── BinEditorCanvas.tsx    # bin SVG canvas
│   │   │   ├── BinConfigurator.tsx    # bin settings panel
│   │   │   ├── BinPreview3D.tsx       # three.js STL viewer
│   │   │   ├── DrawerSketchCanvas.tsx # drawer plan SVG canvas (drag/drop)
│   │   │   ├── DrawerSketch3D.tsx     # drawer plan 3D view (loads bin STLs)
│   │   │   ├── ToolEditor.tsx         # tool editor orchestrator
│   │   │   ├── ToolEditorToolbar.tsx  # tool toolbar (mode, smooth, undo)
│   │   │   ├── ToolEditorCanvas.tsx   # tool SVG canvas
│   │   │   ├── ToolBrowser.tsx        # sidebar tool picker for bins
│   │   │   ├── PolygonEditor.tsx      # trace-time polygon editor
│   │   │   ├── CutoutOverlay.tsx      # finger hole SVG rendering
│   │   │   └── ...
│   │   ├── hooks/
│   │   │   ├── useDebouncedSave.ts    # debounced auto-save
│   │   │   └── useHistory.ts          # undo/redo state management
│   │   └── lib/
│   │       ├── api.ts                 # API client
│   │       ├── constants.ts           # shared constants
│   │       ├── drawerLayout.ts        # drawer grid math (footprints, packing)
│   │       └── svg.ts                 # polygon path, smoothing, snap
│   └── package.json
├── .github/workflows/
│   ├── docker-dev.yml      # build on push to main
│   └── docker-release.yml  # build on release
├── Dockerfile              # single container (frontend + backend)
├── .env.example
└── README.md
```

## Data Model

- **Tool**: a single traced polygon + finger holes, stored in mm, centred at origin. Lives in a persistent library (`tools.json`).
- **PlacedTool**: a positioned copy of a tool in a bin. Points/holes in bin-space mm. Has `tool_id` linking back to source.
- **Bin**: bin config + placed tools + text labels. Used for STL generation (`bins.json`).
- **BinProject**: a planning group of tool ids and linked bin ids. Placement status is derived from linked bins (`projects.json`). Projects can carry default bin settings used when creating project bins, plus any number of **ProjectSketch** drawer plans.
- **ProjectSketch**: one drawer plan owned by a project: a name, an optional drawer grid (`target_grid_x`/`target_grid_y`, 1-40 units) and a `bin_layout` of `ProjectBinPlacement` records (`id`, `bin_id`, `x`, `y`, `rotation`, `color`) positioning linked bins on that grid. A bin may appear several times, so placements are identified by their own id.
- **Session**: ephemeral, used only for upload/trace workflow. Output is tools saved to library via `save-tools`.

PlacedTools sync with their library source on bin load (`GET /bins/{id}`) via `bin_service.sync_placed_tools()`. Edits to a tool's points, finger holes, or name propagate to all bins that use it. The position offset is preserved.

Projects do not own tools or bins. Tools keep `project_ids`, bins keep `project_id`, and project health/repair endpoints keep those links consistent when records are renamed, deleted, or manually edited. Drawer placements follow the bin links: detaching or deleting a bin drops its placement from every sketch, and repair prunes placements for bins that are no longer linked.

When `TOOL_LABEL_PROVIDER=ollama`, `tool_namer.py` runs after contour extraction for both AI tracing and manual mask upload, before the session is persisted. It crops each still-generic polygon from the corrected source image, masks everything outside the contour to white, asks the selected `ToolNamer` for one short JSON tool name, validates it, and writes the result back to `Polygon.label`. Naming is optional and non-fatal; unsupported providers, missing images, or naming failures keep the generic `tool N` labels.

## Backend route helpers

`routes.py` uses shared helpers to avoid duplication:
- `_run_generate()` -- cache check, STL generation, split, zip, response. Used by both session and bin generation endpoints.
- `_translate_points()` / `_translate_finger_holes()` -- offset points/holes by (dx, dy). Used when placing tools in bins.
- `BinParams` base model in `schemas.py` -- shared fields and validators inherited by `BinConfig` and `GenerateRequest`.
