"""manifold3d's booleans can leave a seam where two near-identical vertices
land ~1e-4mm apart instead of exactly coincident. trimesh's default
merge_vertices() tolerance is tighter than that gap, so the later
nondegenerate_faces() pass drops the resulting sliver triangle without first
welding its vertices into their neighbors -- opening a small boundary hole
that slicers report as non-manifold geometry.

Reproduced on a real customer export (grid_x=6, grid_y=9, stacking_lip off,
real tool cutouts) and, deterministically without any tool data, on a plain
stacking-lip bin at grid_y=6 -- see test below.
"""
from pathlib import Path

import numpy as np

from app.models.schemas import GenerateRequest
from app.services.stl_generator_manifold import ManifoldSTLGenerator, _manifold_to_trimesh


def _boundary_edge_count(mesh) -> int:
    _, counts = np.unique(mesh.edges_sorted, axis=0, return_counts=True)
    return int((counts == 1).sum())


def test_a_stacking_lip_bin_at_six_grid_units_has_no_boundary_holes(tmp_path: Path):
    """Below grid_y=6 (252mm) this config exports clean; at and above it, the
    unpatched merge tolerance used to leave a 3-edge hole in the lip notch
    seam. No tool polygons needed -- the defect is in the shell/lip geometry
    itself."""
    config = GenerateRequest(
        grid_x=2, grid_y=6, height_units=4, magnets=False, stacking_lip=True,
    )
    body, _ = ManifoldSTLGenerator().generate_bin([], config, str(tmp_path / "bin.stl"))
    tm = _manifold_to_trimesh(body)

    assert _boundary_edge_count(tm) == 0
    assert tm.is_watertight
