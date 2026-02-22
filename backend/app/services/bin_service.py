import math
from app.models.schemas import Point, FingerHole


def sync_placed_tools(bin_data, user_tools) -> bool:
    """sync placed tools with their library versions. returns True if any changed."""
    changed = False
    for pt in bin_data.placed_tools:
        if not pt.tool_id:
            continue
        tool = user_tools.get(pt.tool_id)
        if not tool or not tool.points:
            continue

        n_placed = len(pt.points)
        placed_cx = sum(p.x for p in pt.points) / n_placed
        placed_cy = sum(p.y for p in pt.points) / n_placed

        n_lib = len(tool.points)
        lib_cx = sum(p.x for p in tool.points) / n_lib
        lib_cy = sum(p.y for p in tool.points) / n_lib

        rot = math.radians(pt.rotation)
        cos_r, sin_r = math.cos(rot), math.sin(rot)

        new_points = []
        for p in tool.points:
            rx = (p.x - lib_cx) * cos_r - (p.y - lib_cy) * sin_r
            ry = (p.x - lib_cx) * sin_r + (p.y - lib_cy) * cos_r
            new_points.append(Point(x=placed_cx + rx, y=placed_cy + ry))

        new_fh = []
        for fh in tool.finger_holes:
            rx = (fh.x - lib_cx) * cos_r - (fh.y - lib_cy) * sin_r
            ry = (fh.x - lib_cx) * sin_r + (fh.y - lib_cy) * cos_r
            new_fh.append(FingerHole(
                id=fh.id, x=placed_cx + rx, y=placed_cy + ry,
                radius=fh.radius, width=fh.width, height=fh.height,
                rotation=fh.rotation, shape=fh.shape,
            ))

        if new_points != pt.points or new_fh != pt.finger_holes:
            pt.points = new_points
            pt.finger_holes = new_fh
            pt.name = tool.name
            changed = True

    return changed
