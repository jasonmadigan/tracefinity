# Tool Editor

Open the editor by clicking a tool in your library. The toolbar controls what happens when you click or drag on the canvas.

## Editing modes

**Select** -- drag vertices and cutouts to reposition them.

**Add point** -- click on an edge to insert a new vertex. Disabled in smooth mode.

**Remove** -- click a vertex to delete it. Disabled when the shape has 3 or fewer vertices, or in smooth mode.

**Fill in** -- only appears when the tool has interior rings (donut shapes). Click a ring to fill it solid.

## Cutouts

The cutout dropdown provides five pocket types. Click on the canvas to place one.

| Type | Default size | Shape |
|-|-|-|
| Finger hole | 15mm radius | Spherical pocket for lifting tools out |
| Circle | 10mm radius | Spherical pocket |
| Cylinder | 10mm radius | Flat-bottomed circular pocket |
| Square | 20mm side | Square pocket |
| Rectangle | 30 x 20mm | Rectangular pocket |

Once placed:

- Drag to move any cutout.
- Corner handles to resize circle, cylinder, square, and rectangle cutouts.
- Rotation handle on rectangular cutouts.
- Per-hole depth override (overrides the bin's cutout depth for this hole only).
- Select a hole and click Delete to remove it.

## Smooth vs Accurate

The editor always opens in the **Accurate** view so the editable vertices are
visible. Toggle the canvas preview using the Accurate/Smooth buttons; this does
not change which outline bins and exports use.

**Accurate** -- the raw traced polygon with all vertices. You can add, remove, and drag points.

**Smooth** -- a simplified outline. A slider controls smoothing aggressiveness: range 0 to 1, step 0.05. Uses Chaikin subdivision, which always stays within the control polygon and never overshoots. Vertex editing is unavailable in this preview.

Use the separate **Output: Smooth/Accurate** button to choose which outline is
used for bins and SVG exports. This preference is saved with the tool.

## Transforms

- Rotate 90 degrees clockwise or anticlockwise.
- Flip horizontally or vertically.
- Auto-rotate: finds the rotation angle that minimises the bounding box. Runs on the backend.
- Free-rotate by dragging the rotation handle near the centroid.

## Grid snap

Toggle the Snap button to snap vertices to a 5mm grid. Off by default so outline corrections keep their traced precision. Grid lines are drawn at 10mm intervals for reference.

## Undo / Redo

Ctrl+Z to undo, Ctrl+Shift+Z to redo. Up to 50 steps of history.

## Zoom and pan

Scroll to zoom (0.5x to 20x). Pan by middle-click drag or hold Space and drag.

## Source image overlay

Toggle the source image behind the polygon outline. An opacity slider controls visibility.

## SVG export

Download the tool outline as an SVG file from the tool page header.
