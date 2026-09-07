# STL Generation

## How it works

STL generation uses manifold3d (mesh booleans, 10-100x faster than OCCT B-rep). The gridfinity shell is constructed from first principles using `CrossSection` extrusions and `batch_boolean` operations. Polygon cutouts, finger holes, magnet holes and text labels are subtracted from the bin body in one pass. Filleted rectangle cutouts use a full-depth rounded-bottom cutter profile with a dynamic fillet radius clamped by both one-third of the rectangle width and half the pocket depth.

## Generation concurrency

STL generation has no concurrency limit by default. Set
`STL_GENERATION_CONCURRENCY` to a positive integer to cap simultaneous jobs
within the backend process and reduce peak CPU and memory use. Cached results
do not consume a generation slot. When every slot is occupied, a request waits
up to 5 seconds; if no slot becomes available, the API returns `503 Service
Unavailable` with `Retry-After: 5`.

The limit is per process, not shared across processes or replicas. Tracefinity
currently runs as a single backend process, so a value of `1` serializes STL
generation for the standard deployment.

## Export retention

Generated exports are regenerable from the stored polygons and bin config, so
they are not kept indefinitely. A background sweep runs every 15 minutes and
deletes export files older than `STL_RETENTION_HOURS` (default 24). Set it to
`0` to keep exports forever.

The sweep only removes files directly inside each user's `outputs/` directory
with an export suffix: `.stl`, `.3mf`, `.zip`, and the `.hash` cache marker.
Photos, traces, tools, bins, projects, and session data are never touched.

Opening a bin page re-requests generation, which either refreshes the existing
files (cache hit, which also resets their retention clock) or rebuilds them
from saved state. The bin page's export buttons also recover on demand: a
download that finds its file purged regenerates the bin and retries. Trace
pages never request generation, so a purged session-flow export stays gone
until generation is requested again. A purged export endpoint returns `404`
with `<artefact> expired; regenerate the bin` when a prior generation is on
record, and `<artefact> not found` otherwise.

## Z-Axis Reference Heights

- **Base top**: 4.75mm (three tapered layers: 2.15 + 1.8 + 0.8). Infill starts here.
- **Wall top (floor face)**: `height_units * 7`. Infill stops here; cutouts pocket down from here.
- **Raised rim**: with `rim_units > 0`, a hollow perimeter collar extends the wall from the floor face up by `rim_units * 7`mm, leaving the interior open. The stacking lip rides on top of the collar.
- **Lip base**: `height_units * 7 + rim_units * 7` (= wall top when `rim_units == 0`).
- **Stacking lip top**: lip base + 4.4mm (d0=1.9 + d1=1.8 + d2=0.7). Do NOT use bounding box max Z.
- **Pocket extrude margin**: 0.01mm epsilon for boolean cleanliness.

## Shell mode (constant-thickness shell)

`shelled` on `BinParams` rebuilds the bin as a **constant-thickness shell** via `_build_shelled_bin` (additive construction — everything not built is open air). Wall thickness is a user-selected slider (1-3mm in 0.2mm steps; clamped into that range when shelled). The bin's **top floor face is removed**; walls trace both the outer perimeter and each tool outline.

Structure (bottom to top):

- **Floor**: the solid tapered base cells keep the standard underside (feet and between-feet grooves stay open, flare chamfer intact), and a **trench floor plate** (`config.shell_floor_plate`, default `SHELL_TRENCH_PLATE_T` = 0.75mm) sits **on top of** the cells, spanning everything inside the outer wall band. The plate seals the gaps between the tool walls, the outer band and the base cells while leaving the chamfered grooves below it open. The underside (feet, grooves) is unchanged and nothing is cut through.
- **Outer wall band**: bin perimeter rounded-rect minus the same rect inset by the wall thickness, from the floor to the cavity top. **With a stacking lip** (`shell_exterior_standard`), the band widens to the spec lip wall thickness (`LIP_D0 + LIP_D2` = 2.6mm) and runs all the way to the wall top, so the lip sits on a printable, spec-thick wall instead of floating over a thin shell. The band itself is optional via `shell_exterior_wall` (default on): when off, no band is built and the perimeter terminates flush at the trench floor plate — only the tool wall rings stand (still clipped to the standard gridfinity footprint). The schema forces `shell_exterior_wall = True` when a stacking lip is on, so the lip always has a wall to sit on.
- **Tool wall rings**: each clipped tool outline buffered **outward** by the wall thickness (shapely mitre buffer), minus the trace itself — the wall hugs the outside of the trace. Overlapping rings merge with each other and the band (cosmetic only). Rings always run to the **wall top** regardless of `shell_exterior_standard`: with a stacking lip the band already runs to the wall top and the lip collar sits above it at the perimeter, so the ring only merges with existing geometry. (Regression note: rings once stopped at the cavity top — 3.8mm below the wall top — when `shell_exterior_standard` was on, leaving tool walls shorter than the rest of the bin.)
- **Pocket floors**: per tool, a full column of material from the pocket depth down to the trench floor — the same vertical span as the ring walls beside the trace. The cutout depth selection always controls the pocket depth (shell mode or not): `_resolve_pocket_depth` falls back to `config.cutout_depth` unless a per-cutout `depth_override` is set, and `insert_height` still applies on top.

Cavity top: with `shell_exterior_standard` (default) and stacking lip on, the shell stops at `wall_top - (LIP_D3 + LIP_D4)` so the standard ~2.6mm lip collar stays solid. With `false`, it runs to `wall_top` and the lip notch/rim use `min(2.6, wall_thickness)` as the inset (uniform wall through the lip).

Guards and interactions:

- `_max_pocket_depth(config, wall_top_z)` is the single source of truth for the deepest legal pocket: `1.5 + 7 * (height_units - 1)` (`MIN_CUTOUT_DEPTH` plus one height unit per extra unit of bin height), minus the 3.8mm lip notch for solid bins with a stacking lip. The lip deduction is solid-bin-only — in a shelled bin the lip collar sits above the cavity top at the perimeter, so a pocket cutter never touches it.
- `_build_shelled_bin` returns None (solid fallback + warning) when the bin is too short or the interior too small for the wall thickness.
- Pocket cutters still run afterwards and are no-ops where the shell pre-opened them; finger holes and chamfers still cut into the rings/pocket floors. Partial-bin cutters compose after the shell body.
- **Text labels**: surface labels sit on the trench floor plate top; labels inside tool traces sit on the pocket-floor top (both via `_make_text_labels` overrides).
- **Contrast insert**: the flat insert is exported in bin-space coordinates at its pocket floor (`wall_top_z - _resolve_pocket_depth(...)`, which already includes `insert_height`), with the rings clipped to the bin interior before the fit-clearance shrink — the same clip the pocket cutter uses — so it drops into the pocket exactly where the tool rests. The 3D preview translates it with the bin's transform (not its own bounding box) to keep its position inside the tool pocket. **Text interaction**: embossed labels inside a tool trace rise from the pocket floor — exactly where the insert sits — so `_make_insert_text_cutters` subtracts their silhouettes from the insert's underside (clamped to the insert thickness), leaving the bin's raised text visible through the insert. Each text cutter is offset outward by the insert fit clearance (round join) so the insert keeps its gap around the letters and doesn't bind on the raised text. Recessed labels cut into the bin floor below the insert and do not affect it; labels outside all traces are ignored.
- **Clip rect**: `_interior_clip_rect` uses the effective wall thickness (lip inset `min(2.6, wall_thickness)` when `shell_exterior_standard = false`).

## Gridfinity Constants

```
GRID_UNIT = 42.0mm
HALF_GRID_UNIT = 21.0mm
HEIGHT_UNIT = 7.0mm
BASE_HEIGHT = 4.75mm (three tapered layers: 2.15 + 1.8 + 0.8)
STACKING_LIP = 4.4mm (above wall top: 1.9 + 1.8 + 0.7)
CORNER_RADIUS = 3.75mm
MAGNET_DIAMETER = 6.0mm
MAGNET_DEPTH = 2.4mm
MAGNET_SPACING = 26mm (centre-to-centre, 4 per cell)
```

## Half-grid support

Bin dimensions accept 0.5-unit increments (e.g. 3.5x2.5 = 147x105mm). Half-unit trailing cells use 21mm base units. `half_grid_base` generates all base cells at 21mm for finer baseplate positioning. Magnets are placed only on full 42mm cells.

## Partial bins

Optional per-cell shell trimming controlled by `partial_bins`, `partial_bins_values`, `partial_bins_connect`, and `partial_bins_retain_wall` on `BinParams` / `GenerateRequest`. The shell is always built for the full grid first; partial-bin logic runs after lip features and before pocket/magnet/text cutters.

### Cell mask

- `partial_bins_values` is a row-major boolean array of length `ceil(grid_x) * ceil(grid_y)`, matching the UI matrix (row 0 = top). Fractional grid sizes use the same ceil counts as half-grid support.
- `_cell_enabled(ix, iy)` returns true when partial bins is off, or when the mask entry is true.
- At least one cell must stay enabled; the API rejects an all-false mask.

### Cut mode (`partial_bins_connect = false`)

Disabled cells are removed with full-height 42×42mm cutters (`_make_disabled_cell_cutters`) from below the bin top through the base. Adjacent enabled cells that share an edge stay one connected manifold volume; separated islands are exported individually (see below). Bed splitting uses the bounding span of **enabled** cells only (`_effective_grid_span`).

### Connect mode (`partial_bins_connect = true`)

Disabled cells keep base geometry but lose walls and lip above `BASE_HEIGHT`:

1. **Wall cutters** (`_make_connect_mode_cell_cutters`) subtract everything from `BASE_HEIGHT` up to the bin top in each disabled cell.
2. **Stability plates** (`_make_connect_mode_stability_plates`) add a 5.8mm floor bridge (`PARTIAL_BIN_CONNECT_PLATE_MM = 6.0 - 0.2`) at `z = BASE_HEIGHT` across each disabled region. Plates extend half a grid unit into neighbouring enabled cells for adhesion.

**Retain outer wall** (`partial_bins_retain_wall`, only valid with connect mode): wall cutters are inset from the bin perimeter by `LIP_D0 + LIP_D2` (~2.6mm) so the outer shell strip survives through disabled edge cells.

Magnet holes use `_cell_retains_base`: holes are placed in enabled cells **and** in disabled cells that still have connect-base geometry, so magnets can sit under bridged regions.

Bed splitting uses the **full** `grid_x` / `grid_y` footprint when connect mode is on, because the printed part spans the entire grid.

### Export and splitting

`export_split_parts` chooses the export path:

1. **Disconnected partial bins** (partial bins on, connect off, at least one disabled cell): `export_separated_parts` decomposes the finished manifold into one STL per connected volume, packaged as a ZIP alongside the merged STL.
2. **Bed-size split** (otherwise, when `bed_size > 0` and the diagonal-fit check fails): `split_bin` cuts along grid planes as for a normal oversized bin.

### Text labels

Labels are generated on a single floor chosen from the label centre (`wall_top_z` or
`cutout_floor_z`, depending on whether the centre is inside a tool polygon).
When partial bins disable a cell, labels in that cell are skipped entirely.

## Base geometry (per cell, reverse-engineered from gridfinity-build123d)

Layer dimensions at key z-heights for a 1x1 cell (outer polygon half-widths):

| z (mm) | outer half-width | notes |
|--------|-----------------|-------|
| 0      | 17.8            | bottom of base, taper start |
| 0.8    | 18.6            | straight section start |
| 2.6    | 18.6            | straight section end |
| 4.75   | 20.75           | wall top of base |

For NxM bins multiply grid centres by `(ix - (N-1)/2) * 42`.

## Bin Auto-Sizing

```
grid_units = ceil((tool_dimension + 2*wall + 2*clearance + 0.5) / 42)
```

Each axis is limited to 25 grid units and the footprint to
`ceil(grid_x) * ceil(grid_y) <= 100`. The footprint limit bounds geometry
generation cost while still allowing long, narrow bins. Auto-size reports the
required dimensions rather than silently shrinking layouts that exceed either
limit.

## Bin Splitting

Large bins are split along grid boundaries using manifold3d `split_by_plane`. Diagonal fit check: `(W + H) / sqrt(2) <= bed_size`. Split parts exported as ZIP.

The full bin manifold is generated before splitting, so bed size controls the
exported piece size rather than the maximum logical bin size or generation
resource use.

With partial bins in cut mode, separated islands are exported via `decompose` instead of plane cuts when connect mode is off. With connect mode on, bed splitting measures against the full grid size. See **Partial bins** above.

## 3MF Export

Embossed text labels produce a separate body for multi-colour printing. Both bin body and text body are exported as separate objects in the 3MF. Uses trimesh for export. Only generated when embossed labels exist.
