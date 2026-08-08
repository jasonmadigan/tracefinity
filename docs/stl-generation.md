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

## Z-Axis Reference Heights

- **Base top**: 4.75mm (three tapered layers: 2.15 + 1.8 + 0.8). Infill starts here.
- **Wall top (floor face)**: `height_units * 7`. Infill stops here; cutouts pocket down from here.
- **Raised rim**: with `rim_units > 0`, a hollow perimeter collar extends the wall from the floor face up by `rim_units * 7`mm, leaving the interior open. The stacking lip rides on top of the collar.
- **Lip base**: `height_units * 7 + rim_units * 7` (= wall top when `rim_units == 0`).
- **Stacking lip top**: lip base + 4.4mm (d0=1.9 + d1=1.8 + d2=0.7). Do NOT use bounding box max Z.
- **Pocket extrude margin**: 0.01mm epsilon for boolean cleanliness.

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

## Bin Splitting

Large bins are split along grid boundaries using manifold3d `split_by_plane`. Diagonal fit check: `(W + H) / sqrt(2) <= bed_size`. Split parts exported as ZIP.

With partial bins in cut mode, separated islands are exported via `decompose` instead of plane cuts when connect mode is off. With connect mode on, bed splitting measures against the full grid size. See **Partial bins** above.

## 3MF Export

Embossed text labels produce a separate body for multi-colour printing. Both bin body and text body are exported as separate objects in the 3MF. Uses trimesh for export. Only generated when embossed labels exist.
