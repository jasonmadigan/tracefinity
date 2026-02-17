from __future__ import annotations

import json
import uuid
import tempfile
from pathlib import Path

import cv2
import numpy as np

from app.models.schemas import Polygon, Point


MASK_PROMPT_GEMINI = """Create a black and white mask of this image.

CRITICAL: The output image MUST be EXACTLY {width}x{height} pixels - the same as the input.

Instructions:
1. Output dimensions: {width} pixels wide, {height} pixels tall (MANDATORY)
2. Tool silhouette: pure black (#000000)
3. Everything else (paper, shadows, background): pure white (#FFFFFF)
4. Trace the actual tool edges, NOT the shadow edges
5. Tool position must stay exactly where it is

Output a {width}x{height} pixel image with black tool silhouette on white background."""


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


class AITracer:
    async def trace_tools(
        self,
        image_path: str,
        api_key: str,
        mask_output_path: str | None = None,
    ) -> tuple[list[Polygon], str | None]:
        """trace tools using Gemini mask generation. returns (polygons, mask_path)"""
        mask_path = await self._generate_mask_gemini(image_path, api_key, mask_output_path)

        if not mask_path:
            return [], None

        contours = self._trace_mask(mask_path, image_path)
        if not contours:
            return [], mask_output_path

        try:
            labels = await self._get_labels(image_path, contours, api_key)
        except Exception:
            labels = [f"tool {i + 1}" for i in range(len(contours))]

        polygons = []
        for i, contour in enumerate(contours):
            label = labels[i] if i < len(labels) else f"tool {i + 1}"
            points = [Point(x=p[0], y=p[1]) for p in contour]
            polygons.append(
                Polygon(
                    id=str(uuid.uuid4()),
                    points=points,
                    label=label,
                )
            )

        return polygons, mask_output_path

    MAX_MASK_DIM = 2048  # keep output in the 1K/2K pricing tier

    async def _generate_mask_gemini(self, image_path: str, api_key: str, output_path: str | None = None) -> str | None:
        """use gemini to generate a clean black/white mask"""
        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=api_key)

            img = cv2.imread(image_path)
            if img is None:
                return None
            height, width = img.shape[:2]

            # scale down to stay in the cheaper 2K output tier
            if max(width, height) > self.MAX_MASK_DIM:
                scale = self.MAX_MASK_DIM / max(width, height)
                new_w, new_h = int(width * scale), int(height * scale)
                resized = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)
                _, buf = cv2.imencode(".png", resized)
                image_bytes = buf.tobytes()
                mime_type = "image/png"
                prompt = MASK_PROMPT_GEMINI.format(width=new_w, height=new_h)
            else:
                with open(image_path, "rb") as f:
                    image_bytes = f.read()
                mime_type = self._get_media_type(image_path)
                prompt = MASK_PROMPT_GEMINI.format(width=width, height=height)

            response = client.models.generate_content(
                model="gemini-3-pro-image-preview",
                contents=[
                    prompt,
                    types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                ],
                config=types.GenerateContentConfig(
                    response_modalities=["TEXT", "IMAGE"],
                ),
            )

            for part in response.candidates[0].content.parts:
                if hasattr(part, "inline_data") and part.inline_data:
                    mask_data = part.inline_data.data
                    if output_path:
                        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
                        Path(output_path).write_bytes(mask_data)
                        return output_path
                    else:
                        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
                            f.write(mask_data)
                            return f.name

            return None
        except Exception:
            raise

    def _trace_mask(self, mask_path: str, original_path: str, min_area: int = 5000) -> list[list[tuple[float, float]]]:
        """trace contours from mask image"""
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
            thresh = cv2.resize(thresh, (target_w, target_h), interpolation=cv2.INTER_NEAREST)

        kernel = np.ones((3, 3), np.uint8)
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=2)
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel, iterations=1)

        mask_contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not mask_contours:
            return []

        shapely_polys = []
        for contour in mask_contours:
            area = cv2.contourArea(contour)
            if area < min_area:
                continue

            points = [(float(p[0][0]), float(p[0][1])) for p in contour]
            if len(points) >= 4:
                try:
                    poly = ShapelyPolygon(points)
                    if poly.is_valid and poly.area > min_area:
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
            simplified = poly.simplify(3.0, preserve_topology=True)
            coords = list(simplified.exterior.coords)[:-1]
            if len(coords) >= 4:
                clamped = [
                    (max(0, min(target_w, x)), max(0, min(target_h, y)))
                    for x, y in coords
                ]
                results.append(clamped)

        return results

    async def _get_labels(
        self,
        image_path: str,
        contours: list[list[tuple[float, float]]],
        api_key: str,
    ) -> list[str]:
        """use gemini to identify what each detected contour is"""
        positions = []
        for i, contour in enumerate(contours):
            cx = sum(p[0] for p in contour) / len(contour)
            cy = sum(p[1] for p in contour) / len(contour)
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
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)

        with open(image_path, "rb") as f:
            image_bytes = f.read()

        mime_type = self._get_media_type(image_path)

        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=[
                prompt,
                types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
            ],
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
