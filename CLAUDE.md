# Tracefinity

Tool tracing app that generates 3D-printable gridfinity bins from photos. Backend is Python/FastAPI with OpenCV and build123d; frontend is Next.js 16/React/TypeScript with react-three-fiber for 3D preview.

See [docs/architecture.md](docs/architecture.md) for project structure, data model, and component breakdown.
See [docs/api.md](docs/api.md) for all API endpoints.
See [docs/stl-generation.md](docs/stl-generation.md) for STL geometry, gridfinity constants, and splitting.
See [docs/gotchas.md](docs/gotchas.md) for Y-axis inversion, memory leaks, Docker, and other hard-won lessons.

## Running

```bash
# docker
docker run -p 3000:3000 -v ./data:/app/storage -e GOOGLE_API_KEY=your-key ghcr.io/jasonmadigan/tracefinity

# local
cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 8000
cd frontend && npm run dev
```

## Key Constraints

**Gemini models**: Use `gemini-3-pro-image-preview` with `response_modalities=["TEXT", "IMAGE"]` for mask generation. This is the only model that works for image generation -- do not change it. Labels use `gemini-2.0-flash` (text only).

**Mask format**: tools BLACK (#000000), background WHITE (#FFFFFF). `_trace_mask()` handles both alpha-channel and RGB masks. Gemini returns masks at different dimensions than input -- always resize to match original before tracing contours.

**Coordinate systems**:
- Trace page: image pixels
- Tool editor: mm, centred at origin
- Bin editor: mm, 0,0 = top-left of bin
- STL generator: bin centred at origin (offset by -width/2, -depth/2)
- SVG/layout Y is down; build123d Y is up -- always negate Y when mapping bin-space to build123d

**Paper orientation**: `apply_perspective_correction` detects landscape by comparing top edge vs left edge from user corners. If top > left, dimensions swap. Paper is used for scale only; the full visible area beyond the paper is included in the corrected image.

**Browser image caching**: add `?v={timestamp}` cache-busting params when displaying images that may change. PolygonEditor needs `key` prop to force remount on URL change.

**`save-tools` conversion**: converts trace polygons from px to mm (via scale_factor), centres at origin, saves as Tools. Bin generation skips `scale_to_mm()` since placed tools are already in mm.

## Open Core vs SaaS Mode

This repo runs in two modes. Open-core is the default; SaaS mode activates when env vars are set.

**Open-core mode** (self-hosted, no env vars):
- No auth, single user ("default"), no limits enforced
- `AuthGate` is a no-op, `AccountMenu` doesn't render
- Trace/save endpoints have no limit checks (JWT has no limit claims)

**SaaS mode** (deployed behind tracefinity.net):
- `AUTH_SECRET` enables JWT auth on all API routes
- `NEXT_PUBLIC_SAAS_URL` enables `AuthGate` (redirects to SaaS login) and `AccountMenu` (links to dashboard/pricing)
- JWT carries `maxTraces` and `maxTools` claims from the SaaS layer
- `trace_tools` endpoint checks trace limit before Gemini call, records to `traces.json` after
- `save_tools_from_session` checks tool count limit before saving
- `GET /api/usage` returns current trace/tool counts (consumed by SaaS dashboard)
- 402 responses trigger upgrade prompts in the trace page UI

Env vars:
- **`AUTH_SECRET`** (backend): enables JWT auth. Without it, all routes use the "default" user with no limits.
- **`NEXT_PUBLIC_SAAS_URL`** (frontend build arg): enables AuthGate and AccountMenu. Without it, no auth UI renders.

Never add hard dependencies on the SaaS layer. Features must work standalone first, with SaaS hooks added as optional wrappers.
