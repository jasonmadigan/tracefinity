from __future__ import annotations

import asyncio
import json
import logging
import tempfile
import uuid
from collections.abc import Callable
from pathlib import Path

import cv2
import numpy as np

from app.config import settings
from app.models.schemas import Point, Polygon
from app.services.tracer_registry import (
    GPU_REQUIRED_TRACERS,
    LOCAL_MODEL_LABELS,
    REMBG_MODELS,
    REMOTE_TRACERS,
    TRACER_LABELS,
)

# gemini-3-pro respects output dimensions precisely, so a direct
# "create a mask" instruction works and alignment is trivial.
MASK_PROMPT_PRO = """Create a black and white mask of this image.

CRITICAL: The output image MUST be EXACTLY {width}x{height} pixels - the same as the input.

Instructions:
1. Output dimensions: {width} pixels wide, {height} pixels tall (MANDATORY)
2. Tool silhouette: pure black (#000000)
3. Everything else (paper, shadows, background): pure white (#FFFFFF)
4. Trace the actual tool edges, NOT the shadow edges
5. Tool position must stay exactly where it is

Output a {width}x{height} pixel image with black tool silhouette on white background."""

# gemini-2.5-flash ignores dimension requests and returns arbitrary sizes.
# "stencil" language produces cleaner B/W output than "mask" language.
MASK_PROMPT_FLASH = """Look at the input photo and find every tool/object on the paper.

Now generate a completely new {width}x{height} pixel image that is:
- A completely white (#FFFFFF) background
- With a filled black (#000000) silhouette for each tool, in the same position as in the photo

The output must look like a stencil — solid black shapes on a solid white rectangle. No photograph content, no textures, no grey, no gradients, no edges of the original image. Just flat black shapes on flat white.

Output dimensions must be exactly {width}x{height} pixels. Tool positions must match the input photo."""


LABEL_PROMPT = """This image shows tools on a white background. There are {count} tools detected.
For each tool, identify what it is.

The tools are located at these approximate positions (x, y center coordinates):
{positions}

Return ONLY valid JSON:
{{
  "labels": ["tool 1 name", "tool 2 name", ...]
}}

Keep labels short (e.g. "wrench", "screwdriver", "pliers").
Return labels in the same order as the positions listed above."""

# models that need post-hoc alignment (don't respect output dimensions)
_NEEDS_ALIGNMENT = {"gemini-2.5-flash-image"}


class AITracer:
    def __init__(
        self,
        model: str = "gemini-3-pro-image-preview",
        label_model: str = "gemini-2.0-flash",
        openrouter_key: str | None = None,
        openrouter_image_model: str | None = None,
        openrouter_label_model: str | None = None,
        saliency_tracer: str | None = None,
        remote_model: str | None = None,
        remote_token: str | None = None,
        fal_operating_resolution: str = "1024x1024",
        replicate_resolution: str | None = None,
    ):
        self.model = model
        self.label_model = label_model
        self.openrouter_key = openrouter_key
        self.openrouter_image_model = openrouter_image_model or f"google/{model}"
        self.openrouter_label_model = openrouter_label_model or f"google/{label_model}"
        self.saliency_tracer = saliency_tracer
        self.remote_model = remote_model
        self.remote_token = remote_token
        self.fal_operating_resolution = fal_operating_resolution
        self.replicate_resolution = replicate_resolution
        self.uses_saliency = saliency_tracer is not None
        self._saliency_backend = None

        if self.uses_saliency:
            self._init_saliency_backend()

    def _mask_prompt(self, width: int, height: int) -> str:
        if self.model in _NEEDS_ALIGNMENT:
            return MASK_PROMPT_FLASH.format(width=width, height=height)
        return MASK_PROMPT_PRO.format(width=width, height=height)

    async def trace_tools(
        self,
        image_path: str,
        api_key: str,
        mask_output_path: str | None = None,
        before_mask_write: Callable[[], None] | None = None,
    ) -> tuple[list[Polygon], str | None]:
        """trace tools via local model or gemini mask generation.

        before_mask_write runs just before the mask lands on disk; raising
        from it aborts the write. the caller uses it to stop the mask being
        written (and the user dir recreated) when the owning user was
        deleted while the model call was in flight (issue #160)."""
        import os
        if os.environ.get("E2E_TEST_MODE"):
            return self._mock_trace(mask_output_path, before_mask_write)

        if self.uses_saliency:
            mask_path = await self._generate_mask_saliency(image_path, mask_output_path, before_mask_write)
        else:
            mask_path = await self._generate_mask_gemini(image_path, api_key, mask_output_path, before_mask_write)

        if not mask_path:
            return [], None

        align = not self.uses_saliency and self.model in _NEEDS_ALIGNMENT
        contours = self._trace_mask(mask_path, image_path, align=align)
        if not contours:
            return [], mask_output_path

        polygons = []
        for i, (exterior, holes) in enumerate(contours):
            points = [Point(x=p[0], y=p[1]) for p in exterior]
            interior_rings = [
                [Point(x=p[0], y=p[1]) for p in hole]
                for hole in holes
            ]
            polygons.append(
                Polygon(
                    id=str(uuid.uuid4()),
                    points=points,
                    label=f"tool {i + 1}",
                    interior_rings=interior_rings,
                )
            )

        return polygons, mask_output_path

    def _init_saliency_backend(self):
        """prepare the saliency backend: load local weights, or build a remote
        config (no heavy import on the remote path)."""
        if self._saliency_backend is not None:
            return
        name = self.saliency_tracer
        if name in REMOTE_TRACERS:
            from app.services.remote_saliency import RemoteSaliencyConfig
            cfg = RemoteSaliencyConfig(
                provider=name,
                model=self.remote_model,
                token=self.remote_token,
                fal_operating_resolution=self.fal_operating_resolution,
                replicate_resolution=self.replicate_resolution,
            )
            self._saliency_backend = (name, cfg)
            return
        label = LOCAL_MODEL_LABELS.get(name, name)
        if name in REMBG_MODELS:
            from app.services.onnx_check import is_onnx_available
            if not is_onnx_available():
                raise RuntimeError(
                    f"local tracer '{name}' requires ONNX runtime but this CPU "
                    "lacks AVX support. Use a remote tracer (gemini/replicate/fal) instead."
                )
            from rembg import new_session

            from app.services.ort_runtime import get_onnx_providers
            providers = get_onnx_providers(require_gpu=name in GPU_REQUIRED_TRACERS)
            logging.info("loading %s via rembg with providers: %s", label, providers)
            session = new_session(REMBG_MODELS[name], providers=providers)
            logging.info("%s actual ONNX providers: %s", label, session.inner_session.get_providers())
            self._saliency_backend = ("rembg", session)
        elif name == "inspyrenet":
            import torch
            from transparent_background import Remover
            device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
            logging.info("loading %s on %s", label, device)
            self._saliency_backend = ("inspyrenet", Remover(mode="base", device=device))
        else:
            raise ValueError(f"unsupported saliency model: {name}")

    @staticmethod
    def _detect_paper_rect(img: np.ndarray) -> tuple[int, int, int, int] | None:
        """find the axis-aligned paper rect in a corrected image.
        paper = bright AND desaturated. erodes before bounding so the rect
        lands strictly inside the paper, not on the fringe."""
        h, w = img.shape[:2]
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        s_chan = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)[:, :, 1]

        best: tuple[int, int, int, int, int] | None = None
        for thresh_val in (200, 190, 180, 170):
            _, bright = cv2.threshold(gray, thresh_val, 255, cv2.THRESH_BINARY)
            _, low_sat = cv2.threshold(s_chan, 60, 255, cv2.THRESH_BINARY_INV)
            binary = cv2.bitwise_and(bright, low_sat)
            binary = cv2.erode(binary, np.ones((9, 9), np.uint8), iterations=2)
            binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((25, 25), np.uint8), iterations=3)
            contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if not contours:
                continue
            largest = max(contours, key=cv2.contourArea)
            area = cv2.contourArea(largest)
            if area < (h * w) * 0.1:
                continue
            x, y, bw, bh = cv2.boundingRect(largest)
            if bw < 100 or bh < 100:
                continue
            if best is None or area > best[0]:
                best = (int(area), x, y, bw, bh)

        if best is None:
            return None
        return best[1], best[2], best[3], best[4]

    async def _saliency_on_image(self, pil_img):
        """run the configured saliency backend, return foreground mask (fg=255)."""
        kind, handle = self._saliency_backend
        if kind in REMOTE_TRACERS:
            return await self._saliency_remote(pil_img, handle)
        if kind == "rembg":
            from rembg import remove
            result = remove(pil_img, session=handle)
            alpha = np.array(result)[:, :, 3]
            _, binary = cv2.threshold(alpha, 127, 255, cv2.THRESH_BINARY)
            return binary
        result = handle.process(pil_img, type="map")
        mask_np = np.array(result.convert("L"))
        _, binary = cv2.threshold(mask_np, 127, 255, cv2.THRESH_BINARY)
        return binary

    async def _saliency_remote(self, pil_img, cfg):
        """post the crop to a hosted model, return foreground mask (fg=255)."""
        import io

        from app.services.remote_saliency import remote_saliency_mask
        buf = io.BytesIO()
        pil_img.convert("RGB").save(buf, format="PNG")
        logging.info("generating mask via %s (%s)", cfg.provider, cfg.model)
        return await remote_saliency_mask(cfg, buf.getvalue(), pil_img.size)

    async def _generate_mask_saliency(
        self,
        image_path: str,
        output_path: str | None = None,
        before_mask_write: Callable[[], None] | None = None,
    ) -> str | None:
        """generate a foreground mask using a saliency model (local or remote).

        crop to the paper rect before running the model. saliency models pick
        the most salient object; on the full corrected image that is the bright
        paper, not the tool. cropped to the paper, the tool becomes salient."""
        from PIL import Image

        label = TRACER_LABELS.get(self.saliency_tracer, self.saliency_tracer)
        logging.info("generating mask with %s", label)
        pil_img = Image.open(image_path).convert("RGB")
        np_bgr = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

        rect = self._detect_paper_rect(np_bgr)
        if rect is not None:
            x, y, rw, rh = rect
            logging.info("cropping to paper rect %dx%d at (%d,%d) before saliency", rw, rh, x, y)
            cropped = pil_img.crop((x, y, x + rw, y + rh))
            inside = await self._saliency_on_image(cropped)
            full = np.zeros((np_bgr.shape[0], np_bgr.shape[1]), dtype=np.uint8)
            full[y:y + rh, x:x + rw] = inside
        else:
            logging.info("paper rect not detected; running saliency on full image")
            full = await self._saliency_on_image(pil_img)

        # tool=BLACK, bg=WHITE
        mask_out = cv2.bitwise_not(full)

        if output_path:
            if before_mask_write:
                before_mask_write()
            Path(output_path).parent.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(output_path, mask_out)
            return output_path

        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            cv2.imencode(".png", mask_out)[1].tofile(f)
            return f.name

    def _mock_trace(
        self,
        mask_output_path: str | None,
        before_mask_write: Callable[[], None] | None = None,
    ) -> tuple[list[Polygon], str | None]:
        """return pre-recorded fixture data instead of calling Gemini"""
        import shutil
        fixtures = Path(__file__).resolve().parent.parent.parent / "tests" / "fixtures"
        mock_mask = fixtures / "mock_mask.png"
        mock_json = fixtures / "mock_polygons.json"

        if mask_output_path and mock_mask.exists():
            if before_mask_write:
                before_mask_write()
            Path(mask_output_path).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(mock_mask), mask_output_path)

        polygons = []
        if mock_json.exists():
            data = json.loads(mock_json.read_text())
            for p in data:
                points = [Point(x=pt["x"], y=pt["y"]) for pt in p["points"]]
                interior_rings = [
                    [Point(x=pt["x"], y=pt["y"]) for pt in ring]
                    for ring in p.get("interior_rings", [])
                ]
                polygons.append(Polygon(
                    id=p.get("id", str(uuid.uuid4())),
                    points=points,
                    label=p.get("label", "tool"),
                    interior_rings=interior_rings,
                ))

        return polygons, mask_output_path

    MAX_MASK_DIM = 2048  # keep output in the 1K/2K pricing tier

    def _prepare_image(self, image_path: str) -> tuple[bytes, str, str, int, int]:
        """read and optionally downscale image. returns (bytes, mime, prompt, w, h)."""
        img = cv2.imread(image_path)
        if img is None:
            raise ValueError("failed to read image")
        height, width = img.shape[:2]

        if max(width, height) > self.MAX_MASK_DIM:
            scale = self.MAX_MASK_DIM / max(width, height)
            req_w, req_h = int(width * scale), int(height * scale)
            resized = cv2.resize(img, (req_w, req_h), interpolation=cv2.INTER_AREA)
            _, buf = cv2.imencode(".png", resized)
            return buf.tobytes(), "image/png", self._mask_prompt(req_w, req_h), req_w, req_h

        with open(image_path, "rb") as f:
            image_bytes = f.read()
        mime_type = self._get_media_type(image_path)
        return image_bytes, mime_type, self._mask_prompt(width, height), width, height

    async def _generate_mask_gemini(
        self,
        image_path: str,
        api_key: str,
        output_path: str | None = None,
        before_mask_write: Callable[[], None] | None = None,
    ) -> str | None:
        """generate a mask via ollama, openrouter, or google sdk."""
        image_bytes, mime_type, prompt, _, _ = self._prepare_image(image_path)

        if self.openrouter_key:
            mask_data = await self._mask_via_openrouter(image_bytes, mime_type, prompt)
        else:
            mask_data = await self._mask_via_google(image_bytes, mime_type, prompt, api_key)

        if not mask_data:
            return None

        if output_path:
            if before_mask_write:
                before_mask_write()
            Path(output_path).parent.mkdir(parents=True, exist_ok=True)
            Path(output_path).write_bytes(mask_data)
            return output_path

        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(mask_data)
            return f.name

    async def _mask_via_openrouter(self, image_bytes: bytes, mime_type: str, prompt: str) -> bytes | None:
        """call openrouter chat completions with image modality."""
        import base64

        import httpx

        b64 = base64.b64encode(image_bytes).decode()
        data_url = f"data:{mime_type};base64,{b64}"

        payload = {
            "model": self.openrouter_image_model,
            "modalities": ["image", "text"],
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                }
            ],
        }

        logging.info("generating mask with %s via openrouter", self.model)

        async def _call():
            async with httpx.AsyncClient(timeout=90) as client:
                resp = await client.post(
                    settings.openrouter_url,
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {self.openrouter_key}",
                        "Content-Type": "application/json",
                    },
                )
                resp.raise_for_status()
                return resp.json()

        result = await asyncio.wait_for(_call(), timeout=90)

        # extract base64 image from response
        msg = result["choices"][0]["message"]
        images = msg.get("images", [])
        if images:
            url = images[0].get("image_url", {}).get("url", "")
            if url.startswith("data:"):
                b64_data = url.split(",", 1)[1]
                return base64.b64decode(b64_data)

        return None

    async def _mask_via_google(self, image_bytes: bytes, mime_type: str, prompt: str, api_key: str) -> bytes | None:
        """call google genai sdk directly."""
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)

        logging.info("generating mask with %s via google", self.model)
        response = await asyncio.wait_for(
            asyncio.to_thread(
                client.models.generate_content,
                model=self.model,
                contents=[
                    prompt,
                    types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                ],
                config=types.GenerateContentConfig(
                    response_modalities=["TEXT", "IMAGE"],
                ),
            ),
            timeout=60,
        )

        for part in response.candidates[0].content.parts:
            if hasattr(part, "inline_data") and part.inline_data:
                return part.inline_data.data

        return None

    def _trace_mask(
        self,
        mask_path: str,
        original_path: str,
        min_area: int = 5000,
        align: bool = False,
    ) -> list[tuple[list[tuple[float, float]], list[list[tuple[float, float]]]]]:
        """trace contours from mask image. returns list of (exterior, [holes])."""
        from shapely.geometry import Polygon as ShapelyPolygon
        from shapely.ops import unary_union

        img = cv2.imread(mask_path, cv2.IMREAD_UNCHANGED)
        if img is None:
            return []

        original = cv2.imread(original_path)
        if original is None:
            return []

        target_h, target_w = original.shape[:2]
        mask_h, mask_w = img.shape[:2]

        # check if image has meaningful alpha channel (not all opaque)
        if len(img.shape) == 3 and img.shape[2] == 4:
            alpha = img[:, :, 3]
            # only use alpha if it actually varies (has transparent parts)
            if alpha.min() < 250:
                _, thresh = cv2.threshold(alpha, 10, 255, cv2.THRESH_BINARY)
            else:
                # alpha is all opaque, use RGB instead
                gray = cv2.cvtColor(img[:, :, :3], cv2.COLOR_BGR2GRAY)
                _, thresh = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY_INV)
        else:
            # standard black/white mask (tool=BLACK, background=WHITE)
            if len(img.shape) == 3:
                gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            else:
                gray = img
            # BINARY_INV: dark pixels become white, so findContours finds the tool
            _, thresh = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY_INV)

        # resize mask to match original image dimensions
        if mask_h != target_h or mask_w != target_w:
            logging.info("resizing mask %dx%d -> %dx%d", mask_w, mask_h, target_w, target_h)
            thresh = cv2.resize(thresh, (target_w, target_h), interpolation=cv2.INTER_NEAREST)

        # flash model returns content at unpredictable offsets — correct via
        # template matching. pro model respects dimensions so skip this.
        if align:
            thresh = self._align_mask(thresh, original)

        kernel = np.ones((3, 3), np.uint8)
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=2)
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel, iterations=1)

        mask_contours, hierarchy = cv2.findContours(thresh, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
        if not mask_contours or hierarchy is None:
            return []

        hierarchy = hierarchy[0]  # shape: (N, 4) — [next, prev, child, parent]

        # build parent->children mapping from hierarchy
        parent_children: dict[int, list[int]] = {}
        for i, h in enumerate(hierarchy):
            parent_idx = h[3]
            if parent_idx == -1:
                # top-level contour
                if i not in parent_children:
                    parent_children[i] = []
            else:
                parent_children.setdefault(parent_idx, []).append(i)

        shapely_polys = []
        for parent_idx, child_indices in parent_children.items():
            if hierarchy[parent_idx][3] != -1:
                # not a top-level contour, skip
                continue

            contour = mask_contours[parent_idx]
            area = cv2.contourArea(contour)
            if area < min_area:
                continue

            exterior_pts = [(float(p[0][0]), float(p[0][1])) for p in contour]
            if len(exterior_pts) < 4:
                continue

            # collect hole contours
            holes = []
            for ci in child_indices:
                hole_contour = mask_contours[ci]
                hole_pts = [(float(p[0][0]), float(p[0][1])) for p in hole_contour]
                if len(hole_pts) >= 4 and cv2.contourArea(hole_contour) >= min_area // 4:
                    holes.append(hole_pts)

            try:
                poly = ShapelyPolygon(exterior_pts, holes=holes)
                if not poly.is_valid:
                    poly = poly.buffer(0)
                if poly.area > min_area:
                    shapely_polys.append(poly)
            except Exception:
                continue

        if not shapely_polys:
            return []

        merged = unary_union(shapely_polys)

        results = []
        polys_to_process = []
        if merged.geom_type == "Polygon":
            polys_to_process = [merged]
        elif merged.geom_type == "MultiPolygon":
            polys_to_process = list(merged.geoms)

        for poly in polys_to_process:
            if poly.area < min_area:
                continue
            simplified = poly.simplify(1.0, preserve_topology=True)
            coords = list(simplified.exterior.coords)[:-1]
            if len(coords) < 4:
                continue
            clamped = [
                (max(0, min(target_w, x)), max(0, min(target_h, y)))
                for x, y in coords
            ]
            # extract interior rings (holes)
            hole_rings = []
            for interior in simplified.interiors:
                hole_coords = list(interior.coords)[:-1]
                if len(hole_coords) >= 3:
                    hole_clamped = [
                        (max(0, min(target_w, x)), max(0, min(target_h, y)))
                        for x, y in hole_coords
                    ]
                    hole_rings.append(hole_clamped)
            results.append((clamped, hole_rings))

        return results

    @staticmethod
    def _align_mask(thresh: np.ndarray, original: np.ndarray) -> np.ndarray:
        """correct positional offset between mask and image via template matching.

        gemini flash returns masks at arbitrary dimensions. after resizing to
        match the original, the tool silhouette may be offset by tens to hundreds
        of pixels. we extract the tool region from the mask and match it against
        the inverted photo to find the translation that best aligns them.
        """
        h, w = thresh.shape[:2]
        work = 0.25
        ww, wh = int(w * work), int(h * work)
        if ww < 64 or wh < 64:
            return thresh

        mask_s = cv2.resize(thresh, (ww, wh), interpolation=cv2.INTER_NEAREST)
        orig_gray = cv2.cvtColor(original, cv2.COLOR_BGR2GRAY)
        corr_s = cv2.resize(255 - orig_gray, (ww, wh), interpolation=cv2.INTER_AREA)

        # find tool bbox in reduced mask
        contours, _ = cv2.findContours(mask_s.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return thresh
        largest = max(contours, key=cv2.contourArea)
        bx, by, bw, bh = cv2.boundingRect(largest)

        # template: tool region with padding for context
        pad = 30
        tx1, ty1 = max(0, bx - pad), max(0, by - pad)
        tx2, ty2 = min(ww, bx + bw + pad), min(wh, by + bh + pad)
        template = mask_s[ty1:ty2, tx1:tx2].astype(np.float32)

        # search region: template area plus margin for shift detection
        margin = 75  # ~300px at full resolution
        sx1, sy1 = max(0, tx1 - margin), max(0, ty1 - margin)
        sx2, sy2 = min(ww, tx2 + margin), min(wh, ty2 + margin)
        search = corr_s[sy1:sy2, sx1:sx2].astype(np.float32)

        if template.shape[0] >= search.shape[0] or template.shape[1] >= search.shape[1]:
            return thresh

        result = cv2.matchTemplate(search, template, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, max_loc = cv2.minMaxLoc(result)

        # shift = matched position minus expected position
        dx = (max_loc[0] - (tx1 - sx1)) / work
        dy = (max_loc[1] - (ty1 - sy1)) / work
        logging.info("mask alignment: shift=(%.1f, %.1f)px, score=%.3f", dx, dy, max_val)

        max_shift = max(w, h) * 0.1
        if max_val < 0.15 or (abs(dx) < 2 and abs(dy) < 2):
            return thresh
        if abs(dx) > max_shift or abs(dy) > max_shift:
            logging.warning("mask alignment shift too large, skipping")
            return thresh

        M = np.float32([[1, 0, dx], [0, 1, dy]])
        return cv2.warpAffine(thresh, M, (w, h), flags=cv2.INTER_NEAREST)

    async def _get_labels(
        self,
        image_path: str,
        contours: list[tuple[list[tuple[float, float]], list[list[tuple[float, float]]]]],
        api_key: str,
    ) -> list[str]:
        """use gemini to identify what each detected contour is"""
        positions = []
        for i, (exterior, _holes) in enumerate(contours):
            cx = sum(p[0] for p in exterior) / len(exterior)
            cy = sum(p[1] for p in exterior) / len(exterior)
            positions.append(f"{i + 1}. x={int(cx)}, y={int(cy)}")

        prompt = LABEL_PROMPT.format(
            count=len(contours),
            positions="\n".join(positions),
        )

        result = await self._call_gemini(image_path, api_key, prompt)
        return self._parse_labels(result, len(contours))

    def _get_media_type(self, image_path: str) -> str:
        ext = Path(image_path).suffix.lower()
        return {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
            ".gif": "image/gif",
        }.get(ext, "image/jpeg")

    async def _call_gemini(self, image_path: str, api_key: str, prompt: str) -> str:
        with open(image_path, "rb") as f:
            image_bytes = f.read()
        mime_type = self._get_media_type(image_path)

        if self.openrouter_key:
            return await self._text_via_openrouter(image_bytes, mime_type, prompt)
        return await self._text_via_google(image_bytes, mime_type, prompt, api_key)

    async def _text_via_openrouter(self, image_bytes: bytes, mime_type: str, prompt: str) -> str:
        import base64

        import httpx

        b64 = base64.b64encode(image_bytes).decode()
        data_url = f"data:{mime_type};base64,{b64}"

        payload = {
            "model": self.openrouter_label_model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                }
            ],
        }

        async def _call():
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    settings.openrouter_url,
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {self.openrouter_key}",
                        "Content-Type": "application/json",
                    },
                )
                resp.raise_for_status()
                return resp.json()

        result = await asyncio.wait_for(_call(), timeout=30)
        return result["choices"][0]["message"]["content"]

    async def _text_via_google(self, image_bytes: bytes, mime_type: str, prompt: str, api_key: str) -> str:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)

        response = await asyncio.wait_for(
            asyncio.to_thread(
                client.models.generate_content,
                model=self.label_model,
                contents=[
                    prompt,
                    types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                ],
            ),
            timeout=30,
        )
        return response.text

    def _parse_labels(self, response: str, count: int) -> list[str]:
        """extract labels from ai response"""
        try:
            start = response.find("{")
            end = response.rfind("}") + 1
            if start >= 0 and end > start:
                response = response[start:end]

            data = json.loads(response)
            labels = data.get("labels", [])
            return labels[:count]
        except (json.JSONDecodeError, KeyError):
            return [f"tool {i + 1}" for i in range(count)]
