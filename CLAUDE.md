# Tracefinity

Before changing code or documentation, read [CONTRIBUTING.md](CONTRIBUTING.md).
For feature requests, substantial product changes, or issue/PR scope decisions,
also read [CONSTITUTION.md](CONSTITUTION.md) and use the `scope-triage` skill.
Read [DESIGN.md](DESIGN.md) before making architectural changes.

Tracefinity turns photos or scans of physical objects into fitted,
Gridfinity-compatible storage. The backend is Python/FastAPI with OpenCV and
manifold3d; the frontend is Next.js/React/TypeScript with react-three-fiber.

Project setup and commands live in [README.md](README.md). Consult the relevant
document under [docs/](docs/) before changing a subsystem. In particular,
[docs/gotchas.md](docs/gotchas.md) records coordinate-system, image-lifecycle,
geometry, and deployment traps that are easy to reintroduce.

Follow the verification requirements in `CONTRIBUTING.md` and preserve unrelated
worktree changes.
