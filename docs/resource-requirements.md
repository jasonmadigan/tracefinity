# Resource Requirements

## RAM

Two models run simultaneously: a tracer for tool outlines and U2-Net Portable for paper detection. U2-Net always runs locally regardless of tracing mode, establishing a ~2GB floor.

| Mode | Tracer RAM | Total (with U2-Net) |
|-|-|-|
| IS-Net (default) | ~0.5GB | ~2GB |
| InSPyReNet | ~4GB | ~6GB |
| BiRefNet Lite | ~6GB | ~8GB |
| Gemini API | none (remote) | ~2GB |
| Replicate / fal | none (remote) | ~2GB |

RAM figures are measured in Linux containers with both models loaded. Models load at startup and stay resident.

## CPU

Any modern x86-64 processor with AVX support. All local models (including U2-Net paper detection) use ONNX Runtime, which requires AVX instructions.

On CPUs without AVX (some older VMs, Atoms, low-power NAS boxes):
- U2-Net paper detection falls back to OpenCV-only brightness thresholding. Less accurate -- users may need to adjust corners manually more often.
- Local ONNX tracers (`isnet`, `birefnet-lite`, `inspyrenet`) are unavailable.
- Remote tracers (`gemini`, `replicate`, `fal`) work normally.
- AVX availability is detected at startup (CPU flags + subprocess probe). A warning is logged when ONNX is unavailable.

All local models run on CPU by default. No GPU needed. NVIDIA CUDA acceleration is optionally available for faster inference (see README). Intel Arc and AMD ROCm GPUs are not supported.

ARM is supported: the Docker image ships linux/arm64 builds. Raspberry Pi 4/5 with 4GB+ RAM works (IS-Net or a remote tracer).

## Disk

Storage scales with usage. Rough sizing:

| What | Size |
|-|-|
| Docker image | ~2.5GB (includes model weights) |
| Model weights (from-source, first run) | ~500MB downloaded |
| Per photo (corrected + masks) | ~2-5MB |
| Per tool (JSON + SVG) | ~10-50KB |
| Per bin (JSON + STL/3MF) | ~1-10MB |

A volume with 1GB free is plenty for a personal tool library of a few hundred tools and dozens of bins. Scale accordingly for shared instances.

## Docker Resource Limits

Sensible `--memory` defaults based on tracer choice:

```bash
# IS-Net or remote tracer (Gemini/Replicate/fal)
docker run --memory=3g -p 3000:3000 -v ./data:/app/storage ghcr.io/tracefinity/tracefinity

# InSPyReNet
docker run --memory=8g -p 3000:3000 -v ./data:/app/storage ghcr.io/tracefinity/tracefinity

# BiRefNet Lite
docker run --memory=10g -p 3000:3000 -v ./data:/app/storage ghcr.io/tracefinity/tracefinity
```

Headroom above the model figures accounts for OpenCV image processing, STL generation, and the Node.js frontend server.

Uploaded photos and masks are rejected before decoding when they exceed 64
megapixels. Set `MAX_IMAGE_PIXELS` to a positive integer to tune this limit for
the host's available memory.

STL generation is unlimited by default, preserving the fastest behavior for
well-provisioned hosts. On memory-constrained or shared hosts, set
`STL_GENERATION_CONCURRENCY` to a positive integer to cap the number of
simultaneous generation jobs. Excess requests wait up to 5 seconds for a slot
and then receive a 503 busy response; for example,
`-e STL_GENERATION_CONCURRENCY=1` serializes generation and minimizes peak
memory use. The limit is process-wide.

Bin geometry is limited to a 100-cell grid footprint and 25 units per axis. The
full manifold is generated before bed-size splitting, so printer bed size does
not reduce peak generation memory.

### Kubernetes / Helm

Set `resources.requests.memory` to match the tracer. Example for IS-Net:

```yaml
resources:
  requests:
    memory: "2Gi"
    cpu: "500m"
  limits:
    memory: "3Gi"
```

For BiRefNet Lite, request 8Gi with a limit of 10Gi. The 128Mi placeholder in early Helm values is not viable for any configuration.

## Volume Permissions (Unraid / TrueNAS)

The container runs as UID 1000 by default. On NAS platforms where the host volume is owned by a different user (e.g. `nobody:users` / 99:100 on Unraid), set `PUID` and `PGID` to match:

```bash
docker run -p 3000:3000 -e PUID=99 -e PGID=100 -v /mnt/user/appdata/tracefinity:/app/storage ghcr.io/tracefinity/tracefinity
```

When these variables are set, the entrypoint remaps the internal `tracefinity` user to the given UID/GID and chowns `/app/storage` before starting the application. When unset, behaviour is identical to previous releases (UID 1000:1000).

The `--user` flag still works for platforms that support it directly.

## Platform Support

| Platform | Status |
|-|-|
| linux/amd64 | Supported |
| linux/arm64 | Supported (Apple Silicon via Docker Desktop, Pi 4/5) |
| macOS (from source) | Works on Intel and Apple Silicon |
| Windows (from source) | Works via WSL2 or native Python/Node |
