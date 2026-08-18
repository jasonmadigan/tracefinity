# Projects

Projects are named containers that group tools and bins for planning a drawer or workspace layout. They help you organise which tools go together and track progress from tracing through to printing.

## Creating a project

From the dashboard, click **New project**. Give it a name and optional description.

## Project status

Each project has a status that tracks its lifecycle:

| Status | Meaning |
|-|-|
| Active | Work in progress. Tools being traced and bins being designed. |
| Ready to print | All tools are placed in bins. Ready for export. |
| Printed | Bins have been printed. |
| Archived | Project is complete or shelved. |

Change the status from the dropdown in the project header.

## Adding tools

The **Add tools** section shows all tools not yet assigned to the project. Select tools using checkboxes and click **Add**. Use the search field to filter by name. Select all / select none buttons are available.

Tools can belong to multiple projects.

## Removing tools

Click the delete icon next to a tool in the **Project tools** section to remove it from the project. This does not delete the tool itself.

## Filtering project tools

The project tools list has filter buttons:

- **All** shows every tool in the project.
- **Unplaced** shows tools not yet placed in any bin.
- **Placed** shows tools already assigned to a bin.

A search field filters by name within the current filter.

## Creating a bin from a project

1. In the **Project tools** section, tick the tools you want in the new bin.
2. Click **Create bin** in the project header.

The bin is created with the project's default configuration (if set) and opens in the bin editor. The bin is automatically linked to the project.

## Default bin settings

Expand the **Bin defaults** section to configure default settings for all new bins created from this project. This uses the same controls as the bin configurator (grid size, height, magnets, stacking lip, etc.).

Click **Save defaults** to store. Click **Clear** to revert to global defaults.

## Linking existing bins

Click **Add existing bin** in the **Linked bins** section header. This shows unassigned bins that can be linked to the project.

Options when importing:

- **Import bin tools** also adds the bin's tools to the project.
- **Show assigned bins** includes bins already linked to other projects.

## Detaching bins

Click the unlink icon next to a bin in the **Linked bins** section. This removes the association but does not delete the bin.

## Deleting bins

Click the delete icon next to a bin to permanently delete it and all associated files.

## Project health check

If there are inconsistencies (orphaned tools, mismatched bin assignments), a health banner appears showing the issues. Common issues:

- A tool referenced by the project no longer exists.
- A bin's project ID does not match.
- A tool in a linked bin is not part of the project.

## Project repair

When health issues are detected and some are repairable, a **Repair links** button appears. Clicking it auto-fixes what it can (re-linking orphaned items, correcting mismatched IDs) and re-runs the health check.

## Bin contents

Expand a linked bin to see which tools are placed in it. Tools from outside the project are flagged with a warning.

## Drawer plans

The **Drawer plans** section at the bottom of the project page lists every plan for this project. Click **New plan** to add one -- a project can hold as many as you like, for example one per drawer or a few variants of the same drawer you want to compare. Click a plan to open it, rename it by clicking its name in the breadcrumb, and delete it with the trash icon. Deleting a plan only removes the arrangement; the bins stay in the project.

### Setting the drawer size

The drawer size is optional. Click **Set drawer size** and enter the width and depth in gridfinity units (1 to 40, in 0.5 steps). The sidebar shows the equivalent millimetres, so a 420 x 336 mm drawer is 10 x 8 units. **Clear drawer size** removes the plan again.

Bins snap to whole gridfinity units. A bin configured with a **half-grid base** snaps to half units instead, matching the 21mm cells it actually sits on -- there is nothing to switch on in the planner.

### Placing bins

- Drag a bin from the **Project bins** list onto the grid.
- Or click the **+** icon to drop it into the first free spot.
- Drag a placed bin to move it.
- **R** or the rotate icon turns a bin by 90 degrees, cycling through 0, 90, 180 and 270.
- **D** or the copy icon duplicates the selected bin.
- **Delete** or the trash icon takes it back out of the drawer.

A bin can be placed as often as you like -- the list shows how many copies of it are in the drawer, and the **x** icon next to a bin removes all of them at once.

### Highlight colours

The palette icon next to a bin sets a highlight colour for every copy of that bin; the swatches in the bar below the canvas recolour just the selected one. The palette follows the Chart.js default colours, with the Tracefinity blue as the default swatch. Colours show up in both views, which helps when you want to mark, say, everything that still needs printing. Bins that overlap or hang out of the drawer are drawn red and amber with a dashed outline, regardless of their colour.

Each placed bin shows the outlines of the tools it contains and a small stack of bars in the corner marking its height in gridfinity units, so you can see at a glance whether a rearrangement is worth reprinting.

### Auto arrange

**Auto arrange** packs all project bins into the drawer, largest first, rotating them when that helps. Bins that do not fit are left in the list as unplaced.

### Space usage

The sidebar tracks how many grid units are used and free, how many bins are placed, and warns when bins overlap or stick out of the drawer. Overlapping bins are outlined in red, bins outside the drawer in amber.

### 2D and 3D

Switch between the top-down sketch and a 3D view with the buttons above the canvas. The 3D view renders the actual bin models, the same geometry you would print, so you can check tool pockets, heights and reach. It uses the same controls as the bin preview: camera presets (home, top, front, right, fit) and a toggle that switches from solid models to contour lines only. Models are generated on demand the first time you open the 3D view; until a model is ready, the bin shows as a translucent block.

The plan saves automatically and is stored with the project.
