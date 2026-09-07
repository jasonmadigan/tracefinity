# Bin Configuration

Gridfinity is a modular storage system where bins snap into a baseplate grid. Each grid unit is 42mm x 42mm. Tracefinity generates bins that conform to the Gridfinity spec.

## Configuration options

| Setting | Range | Default | Notes |
|-|-|-|-|
| Grid width | 1-25 u | 2 | Each unit is 42mm; the grid footprint is limited to 100 cells |
| Grid depth | 1-25 u | 2 | The available maximum adjusts with the width |
| Height | 1-20 u | 4 | Each unit is 7mm + 4.75mm base |
| Cutout depth | 1.5mm-max | 20mm | Min 1.5mm; the max grows 7mm per extra height unit (reduced by the stacking lip on solid bins) |
| Clearance | 0-5mm | 1.0mm | Gap around tool outlines |
| Cutout chamfer | 0-3mm | 0mm | Bevel on top edge of pockets |
| Magnet diameter | 3-10mm | 6mm | Standard Gridfinity magnets are 6x2mm |
| Magnet depth | 1-5mm | 2.4mm | Slightly deeper than magnet for press-fit |
| Insert height | 0.5-10mm | 1.0mm | Only shown when insert is enabled |
| Insert fit | 0-1mm | 0.2mm | Clearance shaved off insert edges so it drops into the pocket |
| Bed size | 150-500mm | 256mm | For auto-splitting oversized bins |

## Toggles

**Magnet holes** -- recesses in the bin base for magnets. On by default.

**Corners only** -- magnet holes only at the four outer corners instead of all grid positions.

**Stacking lip** -- raised rim so bins stack securely. On by default. Adds approximately 4.4mm to total height and reduces maximum cutout depth.

**Raise lip** -- extends the wall and stacking lip upward by this many units (7mm each) above the floor face, leaving the interior open. Use it for shallow bins where a tool protrudes above the floor: the raised lip lets a stacked bin clear the protruding tool. 0 = standard (lip sits at the floor face). Shown only when the stacking lip is on.

**Contrast insert** -- generates a separate STL to print in a different colour. The pocket is deepened automatically to accommodate the insert thickness.

**Partial Bins** -- disables individual grid cells, removing them from the shell.

**Connect Base** -- disabled cells keep the base plate connected instead of being fully removed.

**Retain outer wall** -- keeps the outer bin wall around the full perimeter when connect base is on.

**Shell** -- rebuilds the bin as a constant-thickness shell: walls trace the outside of the bin and the outside of each tool outline, and the top surface between them is open. Saves filament and print time. With the standard base a floor plate above the feet (default 0.75mm) seals the bottom. Unlike solid bins, the stacking lip does **not** reduce shell-mode pocket depth — the lip collar is perimeter-only and never bounds the pockets. When on, these settings appear:

- **Wall Thickness** -- direct slider from 1-3mm in 0.2mm steps.
- **Shell Depth** -- how deep the open shell interior extends below the wall top; the remaining height seals as a floor plate. Snaps in 0.5mm increments and uses the same range rule as Cutout Depth: 1.5mm minimum, max = 1.5 + 7 × (height − 1) at the selected bin height. Higher depth = thinner floor plate = less filament.

Two sub-options control the shell shape:

- **Exterior Wall** -- builds the outer wall band around the bin perimeter. Turn off to drop it, leaving the perimeter flush at the trench floor height with only the tool walls standing (saves more filament; the print is no longer enclosed). Locked on while the stacking lip is enabled — the lip needs a wall to sit on.
- **Gridfinity Standard Exterior** -- keeps the standard stacking-lip profile (~2.6mm solid collar below the lip) so bins stack with any Gridfinity bin. Off runs the shell wall thickness all the way up through the lip, using slightly less filament but with a non-standard stacking surface. Hidden while the exterior wall is off.

**Contrast insert** -- generates a separate STL to print in a different colour. The pocket is deepened automatically to accommodate the insert thickness. In shell mode the insert is the same flat tool-shape print; it rests on the bin floor and the tool rests on top of it.

## Auto grid sizing

On by default. When enabled, grid width and depth automatically adjust to fit all placed tools, and the grid width/depth sliders are disabled. Toggle it off to set grid size manually; the sliders become active again.

Bins can be up to 25 units on either axis with a 100-cell grid footprint. Long, narrow bins are supported and are split according to the configured bed size. If an auto-sized layout exceeds either safety limit, Tracefinity keeps saving the tool placement but pauses preview and export until the tools are reduced or rearranged.

## Default bin settings

Defaults can be saved at two levels:

- **Global** -- stored in browser localStorage. Apply to all new bins. Set from the bin editor or settings page.
- **Per-project** -- stored on the project via the API. Override global defaults for bins created within that project.

Use "Save as defaults" to capture the current bin config. Use "Reset defaults" to restore factory settings (2x2 grid, 4u height, magnets on, stacking lip on).

## Partial Bins

The partial bins option allows you to disable individual parts of the Gridfinity box to save filament. By using a matrix that matches the grid width * grid depth, specific parts of the box can be enabled or disabled.

## Bed splitting

If the bin dimensions exceed your configured bed size or the bin model is separated by the partial bins configuration, Tracefinity automatically splits it into printable pieces. You get:

- Individual STLs for each piece (also available as a ZIP).
- The full merged STL for large-format printers.
- A split preview in the 3D viewer.
