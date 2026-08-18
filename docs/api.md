# API Endpoints

## User namespaces

Standalone installations do not need authentication headers and store data in
the `default` namespace. Multi-user reverse proxies can set `X-User-Id` only
when the backend has `PROXY_SECRET` configured and the request includes the
matching value in `X-Proxy-Secret`. API and storage requests that try to select
a user namespace without a configured proxy secret receive `403 Forbidden`.

## Sessions (trace workflow)
- `POST /api/upload` - upload image, auto-detect corners
- `POST /api/sessions/{id}/corners` - set corners, apply perspective correction; returns advisory photo warnings (camera too close, paper cut off, extreme perspective)
- `POST /api/sessions/{id}/trace` - AI trace tool outlines
- `POST /api/sessions/{id}/trace-mask` - trace from uploaded mask
- `PUT /api/sessions/{id}/polygons` - save polygon edits
- `POST /api/sessions/{id}/generate` - generate STL/3MF from traced polygons
- `POST /api/sessions/{id}/save-tools` - convert traced polygons to library tools
- `GET /api/sessions` - list sessions
- `GET /api/sessions/{id}` - get session state
- `PATCH /api/sessions/{id}` - update session metadata
- `DELETE /api/sessions/{id}` - delete session

Trace and mask-trace responses include the final visible `Polygon.label` values for the trace result. When `TOOL_LABEL_PROVIDER=ollama`, the backend attempts optional naming before persisting the session; naming failures keep the generic `tool N` labels.

## Tools (library)
- `GET /api/tools` - list tools
- `GET /api/tools/{id}` - get tool
- `PUT /api/tools/{id}` - update tool (name, points, finger_holes)
- `POST /api/tools/{id}/auto-rotate` - compute optimal rotation angle (degrees) to minimise bounding box
- `DELETE /api/tools/{id}` - delete tool

## Bins
- `GET /api/bins` - list bins
- `GET /api/bins/{id}` - get bin (syncs placed tools with library versions)
- `POST /api/bins` - create bin (optionally with tool_ids for auto-sizing and bin_config defaults)
- `PUT /api/bins/{id}` - update bin
- `DELETE /api/bins/{id}` - delete bin + output files
- `POST /api/bins/{id}/generate` - generate STL/3MF from bin

Both generation endpoints may return `503 Service Unavailable` with
`Retry-After: 5` when `STL_GENERATION_CONCURRENCY` is configured and every
generation slot remains occupied for 5 seconds. Cached generation responses
bypass this queue.

## Bin projects
- `GET /api/bin-projects` - list project summaries with tool/bin/placement counts
- `POST /api/bin-projects` - create a project, optionally seeded with tool ids
- `GET /api/bin-projects/{id}` - get project detail with derived placed/unplaced tool ids
- `PATCH /api/bin-projects/{id}` - update project metadata and status
- `DELETE /api/bin-projects/{id}` - delete project metadata; tools and bins are retained
- `POST /api/bin-projects/{id}/tools` - add tools to a project
- `DELETE /api/bin-projects/{id}/tools/{tool_id}` - remove a tool from a project
- `POST /api/bin-projects/{id}/bins` - link existing bins to a project
- `DELETE /api/bin-projects/{id}/bins/{bin_id}` - detach a bin from a project
- `POST /api/bin-projects/{id}/create-bin` - create a new bin from selected project tools, using project or request bin defaults
- `GET /api/bin-projects/{id}/health` - report project/tool/bin link mismatches
- `POST /api/bin-projects/{id}/repair` - repair safe project/tool/bin link mismatches
- `POST /api/bin-projects/{id}/sketches` - add a drawer plan (optional `name`, `target_grid_x`, `target_grid_y`)
- `PATCH /api/bin-projects/{id}/sketches/{sketch_id}` - update a plan's name, drawer grid or `bin_layout`
- `DELETE /api/bin-projects/{id}/sketches/{sketch_id}` - delete a plan; bins and tools are untouched

A project holds any number of drawer plans in `sketches`, each `{id, name, target_grid_x, target_grid_y, bin_layout, created_at, updated_at}` with its own grid of 1-40 units. Records written before multiple plans existed are migrated on load: their project-level grid and layout become a single sketch. `bin_layout` is a list of `{id, bin_id, x, y, rotation, color}` placements on the project drawer grid. `x`/`y` are gridfinity units from the top-left in 0.5 steps, `rotation` is 0, 90, 180 or 270, and `color` is an optional `#rrggbb` highlight. Every placement must reference a bin linked to the project; the same bin may be placed several times, so placement ids must be unique (the server generates one when omitted). Placements are dropped automatically when a bin is detached or deleted. `GET /api/bins` reports `grid_x`, `grid_y`, `height_units`, `half_grid_base` and `preview_tools` so a drawer plan can draw bin footprints, their contents and the snap step each bin allows.

## API Keys and tracer status
- `GET /api-keys` - returns current provider and available tracers

Response fields:
- `google` (bool): true when the server can trace without a user-supplied key (cloud env key, local, or remote).
- `provider` (string|null): one of `gemini` | `local` | `remote`.
- `provider_label` (string|null): human label for the primary tracer, e.g. `Replicate`.
- `tracers` (array): `{id, label}` entries. Remote tracers include `{"id":"replicate","label":"Replicate"}` and `{"id":"fal","label":"fal.ai"}` when the respective tokens are configured.

## Meta
- `GET /api/version` - running app version. Release images report the release tag (e.g. `0.6.0`), dev images `dev-<sha>`, local runs `dev`. Returns 404 when `SHOW_APP_VERSION=false`.

## File serving
- `GET /api/files/{session_id}/bin.stl` - session STL
- `GET /api/files/{session_id}/bin.3mf` - session 3MF
- `GET /api/files/{session_id}/bin_parts.zip` - session split parts
- `GET /api/files/bins/{bin_id}/bin.stl` - bin STL
- `GET /api/files/bins/{bin_id}/bin.3mf` - bin 3MF
- `GET /api/files/bins/{bin_id}/bin_parts.zip` - bin split parts
