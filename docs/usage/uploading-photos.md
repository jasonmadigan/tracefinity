# Uploading Photos

## Paper as a size reference

Tracefinity uses a sheet of paper as a known-size reference to scale outlines to real-world dimensions. Place tools flat on A4, Letter, A3, or Tabloid paper.

The paper is for scale only. Tools can overflow the paper edges. The full visible area beyond the paper is included in the corrected image.

## Tips for good results

- **Contrasting background** -- use a dark surface under white paper (or vice versa). The AI needs to distinguish paper edges from the background.
- **Even lighting** -- avoid harsh shadows across the tools. Diffused overhead light works best.
- **Flat tools** -- tools should lie flat on the paper. Raised handles or 3D shapes confuse the mask generation.
- **No overlap** -- leave a small gap between tools so the AI can separate them.
- **Shoot from above** -- aim for directly overhead. Perspective correction handles some angle, but straight-down needs the least correction. Overhead does not mean close up: distance matters more than angle for scale accuracy.
- **Shoot from a distance** -- 50-60cm or more, with the page filling around half the frame. The paper calibrates the table surface, so anything raised above it projects oversized by H/(H-t) (camera height H, tool thickness t). A thick tool shot from around 20cm can trace roughly 8% too large; from 60cm or more that drops to around 2%.

## Photo warnings

After you confirm the paper corners, Tracefinity checks the photo and flags problems that reduce trace accuracy:

- **Camera too close** -- estimated from the photo's EXIF data. Close shots exaggerate outlines of thick tools (a 15 mm-thick tool shot from 25 cm traces roughly 6% oversized). Shoot from 60 cm or higher. Skipped when the photo has no EXIF data (e.g. screenshots or edited images).
- **Paper cut off** -- a paper corner sits at or beyond the photo edge.
- **Extreme perspective** -- a strong camera angle degrades edge accuracy even after correction.

Warnings are advisory: you can dismiss them and continue, but retaking the photo gives better results.

## Supported formats

JPG, PNG, WebP, and HEIC. Uploads are limited to 20 MB and 64 megapixels by
default. Self-hosted instances can tune these limits with `MAX_UPLOAD_MB` and
`MAX_IMAGE_PIXELS`.

Images are automatically downscaled to a maximum of 2048px on the longest edge. Original uploads are deleted after perspective correction; only the corrected image is retained.

## Paper size

After uploading, select A4, Letter, A3, or Tabloid. Pick whichever you actually used. This determines the scale of everything downstream: tool outlines, bin dimensions, and exported STL geometry.

## Troubleshooting

- **Cutout comes out a few percent larger than the tool** -- the photo was taken too close. The paper sits on the table, but a thick tool's outline sits above it, nearer the camera, so it projects oversized. Re-shoot from 50-60cm or more.
