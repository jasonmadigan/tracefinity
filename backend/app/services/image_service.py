from pathlib import Path
from PIL import Image


def generate_tool_thumbnail(
    src_img: Image.Image, poly_points, tool_id: str, output_dir: Path
) -> str | None:
    """crop and save a tool thumbnail. returns the file path or None."""
    try:
        px_xs = [p.x for p in poly_points]
        px_ys = [p.y for p in poly_points]
        pad = 20
        left = max(0, int(min(px_xs)) - pad)
        top = max(0, int(min(px_ys)) - pad)
        right = min(src_img.width, int(max(px_xs)) + pad)
        bottom = min(src_img.height, int(max(px_ys)) + pad)
        crop = src_img.crop((left, top, right, bottom))
        max_dim = max(crop.width, crop.height)
        if max_dim > 256:
            scale = 256 / max_dim
            crop = crop.resize(
                (int(crop.width * scale), int(crop.height * scale)), Image.LANCZOS
            )
        thumb_file = output_dir / f"{tool_id}.jpg"
        crop.convert("RGB").save(thumb_file, "JPEG", quality=80)
        return str(thumb_file)
    except Exception:
        return None
