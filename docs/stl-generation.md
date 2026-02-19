# STL Generation

## How it works

STL generation uses manifold3d (mesh booleans, 10-100x faster than OCCT B-rep). The gridfinity shell is constructed from first principles using `CrossSection` extrusions and `batch_boolean` operations. Polygon cutouts, finger holes, magnet holes and text labels are subtracted from the bin body in one pass.

## Z-Axis Reference Heights

- **Base top**: 4.75mm (three tapered layers: 2.15 + 1.8 + 0.8). Infill starts here.
- **Wall top**: `height_units * 7`. Infill stops here.
- **Stacking lip top**: wall top + 4.4mm (d0=1.9 + d1=1.8 + d2=0.7). Do NOT use bounding box max Z.
- **Pocket extrude margin**: 0.01mm epsilon for boolean cleanliness.

## Gridfinity Constants

```
GRID_UNIT = 42.0mm
HEIGHT_UNIT = 7.0mm
BASE_HEIGHT = 4.75mm (three tapered layers: 2.15 + 1.8 + 0.8)
STACKING_LIP = 4.4mm (above wall top: 1.9 + 1.8 + 0.7)
CORNER_RADIUS = 3.75mm
MAGNET_DIAMETER = 6.0mm
MAGNET_DEPTH = 2.4mm
MAGNET_SPACING = 26mm (centre-to-centre, 4 per cell)
```

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

## 3MF Export

Embossed text labels produce a separate body for multi-colour printing. Both bin body and text body are exported as separate objects in the 3MF. Uses trimesh for export. Only generated when embossed labels exist.
