# Tracefinity

Tool tracing app that generates 3D-printable gridfinity bins from photos. Backend is Python/FastAPI with OpenCV and manifold3d; frontend is Next.js 16/React/TypeScript with react-three-fiber for 3D preview.

See [docs/architecture.md](docs/architecture.md) for project structure, data model, and component breakdown.
See [docs/api.md](docs/api.md) for all API endpoints.
See [docs/stl-generation.md](docs/stl-generation.md) for STL geometry, gridfinity constants, and splitting.
See [docs/gotchas.md](docs/gotchas.md) for Y-axis inversion, memory leaks, Docker, and other hard-won lessons.

## Running

```bash
# docker
docker run -p 3000:3000 -v ./data:/app/storage -e GOOGLE_API_KEY=your-key ghcr.io/jasonmadigan/tracefinity

# local (first time setup)
cd backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt
cd frontend && npm install

# local (day-to-day)
make dev  # starts backend (:8000) and frontend (:4001) concurrently
```

## Key Constraints

**Gemini models**: Mask generation model is configurable via `GEMINI_IMAGE_MODEL` env var (default `gemini-3-pro-image-preview`). Also supports `gemini-2.5-flash-image` (faster but needs post-hoc alignment). Both use `response_modalities=["TEXT", "IMAGE"]`. Labels use `gemini-2.0-flash` (text only).

**Mask format**: tools BLACK (#000000), background WHITE (#FFFFFF). The prompt asks for a "stencil" image. `_trace_mask()` handles both alpha-channel and RGB masks. Gemini returns masks at different dimensions than requested -- after resizing to match the original, `_align_mask()` uses template matching to correct any positional offset.

**Coordinate systems**:
- Trace page: image pixels
- Tool editor: mm, centred at origin
- Bin editor: mm, 0,0 = top-left of bin
- STL generator: bin centred at origin (offset by -width/2, -depth/2)
- SVG/layout Y is down; manifold3d Y is up -- always negate Y when mapping bin-space to manifold3d

**Paper orientation**: `apply_perspective_correction` detects landscape by comparing top edge vs left edge from user corners. If top > left, dimensions swap. Paper is used for scale only; the full visible area beyond the paper is included in the corrected image.

**Browser image caching**: add `?v={timestamp}` cache-busting params when displaying images that may change. PolygonEditor needs `key` prop to force remount on URL change.

**`save-tools` conversion**: converts trace polygons from px to mm (via scale_factor), centres at origin, saves as Tools. Bin generation skips `scale_to_mm()` since placed tools are already in mm.

