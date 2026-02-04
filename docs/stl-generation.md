# STL Generation

## How it works

The moritzmhmk gridfinity library builds the bin shell (`gf.Bin` with `compartment=None`). We add solid infill and cut tool pockets ourselves. Polygon cutouts are batched into a single boolean subtract for performance.

## Z-Axis Reference Heights

- **Base top**: 4.75mm (2.15 + 1.8 + 0.8 tapered layers). Infill starts here.
- **Wall top**: `height` (= height_units * 7). Infill stops here.
- **Stacking lip top**: wall top + 4.4mm (d0=1.9 + d1=1.8 + d2=0.7). Do NOT use `bin_part.bounding_box().max.Z` as it includes the lip.
- **Pocket extrude margin**: use a tiny epsilon (0.01mm) for boolean cleanliness, not 1mm+ which eats into the lip.

## Gridfinity Constants

```
GRID_UNIT = 42.0mm
HEIGHT_UNIT = 7.0mm
BASE_HEIGHT = 4.75mm (three tapered layers: 2.15 + 1.8 + 0.8)
STACKING_LIP = 4.4mm (above wall top: 1.9 + 1.8 + 0.7)
GRID_INSET = 0.25mm (per side, library clearance)
MAGNET_DIAMETER = 6.0mm
MAGNET_DEPTH = 2.4mm
MAGNET_SPACING = 26mm (centre-to-centre, 4 per cell)
```

## Bin Auto-Sizing

When placing tools in bins, the grid size accounts for wall thickness, cutout clearance, and gridfinity grid inset:
```
grid_units = ceil((tool_dimension + 2*wall + 2*clearance + 0.5) / 42)
```
The 0.5mm is the gridfinity library's own grid clearance (infill is `bin_size - 2*wall - 0.5`).

## Bin Splitting

Large bins that exceed the print bed are split along grid boundaries. Before splitting, a diagonal fit check is performed: a bin of W x H fits at 45 degrees if `(W + H) / sqrt(2) <= bed_size`. Split parts are exported as a ZIP.

## 3MF Export

Embossed text labels produce a separate body for multi-colour printing. The 3MF file has bin body + text body as separate objects. Only generated when embossed labels exist. Uses build123d Mesher.
