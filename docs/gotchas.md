# Gotchas

Hard-won lessons. Read before making changes to coordinate mapping, 3D preview, or Docker.

## Y-axis inversion

SVG/layout/bin-space is Y-down (0 = top edge). build123d is Y-up. Always negate Y when mapping: `-(y + offset_y)`.

- Flipping Y reverses polygon winding -- remove any `reversed()` calls if adding a Y-flip
- Text labels use a flipped Plane (z_dir down) so they negate Y separately
- BinPreview3D.tsx: rotation `[-PI/2, 0, 0]` converts Z-up to Y-up. Do NOT add `scale [1, -1, 1]` -- that was a compensating hack for un-flipped Y
- All three must match: layout editor, 3D preview, downloaded STL in slicer

## Three.js memory leaks

Every `BufferGeometry` and `EdgesGeometry` must be `.dispose()`d on React unmount. STL regeneration creates new geometries each time -- if the old ones aren't disposed, the browser will OOM. Same applies to `Image` objects created in useEffect (use a `cancelled` flag in cleanup).

## Docker

Single container runs both frontend and backend via supervisor. Key details:

- CORS origins in `backend/.env` override the Python defaults -- if you change the frontend port, update `.env` too
- `NEXT_TELEMETRY_DISABLED=1` is set in the Dockerfile build stage
- `.dockerignore` excludes `docs/`, `node_modules/`, `venv/`, `storage/`, `.claude/`

## OCCT / build123d performance

Boolean operations (add, subtract) are single-threaded in OCCT. More cores don't help. Polygon cutouts are batched into a single sketch + single extrude to minimise the number of booleans. Apple Silicon is ~7x faster single-thread than EPYC 7402 for these operations.

## Frontend patterns

- Shared constants (`DISPLAY_SCALE`, `SNAP_GRID`, `GRID_UNIT`, etc.) live in `lib/constants.ts`
- `DISPLAY_SCALE = 8` converts mm to SVG units in the bin editor
- Config is spread into the API request body: `{ ...config, polygons }` in `generateStl`
- Text labels live on BinConfig (not Polygon) since they're free-placed
- PolygonEditor uses refs (`polygonsRef`, `onPolygonsChangeRef`) to avoid stale closures during drag -- do not add `polygons` or `onPolygonsChange` to the `handleMouseMove` dependency array
- Auto-save uses the `useDebouncedSave` hook (debounce + `beforeunload` flush). Pass `skipInitial: true` to avoid saving on first load.
- Undo/redo uses the `useHistory` hook (deep-clone, Cmd+Z handling). The `set()` method pushes to history; `undo()`/`redo()` call the `onChange` callback.
- ToolEditor and BinEditor are split into orchestrator + toolbar + canvas sub-components. `CutoutOverlay` renders finger holes in both.

## Gemini mask quirks

- Masks come back at different dimensions than the input image. Always `cv2.resize` with `INTER_NEAREST` before tracing contours.
- `_trace_mask()` handles both alpha-channel PNGs (tool=opaque, bg=transparent) and RGB PNGs (tool=black, bg=white).
