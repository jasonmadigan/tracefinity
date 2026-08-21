# Design Principles

Decisions that guide contributions. Read this before opening a PR.

## Core

- **Offline-first.** The app must work fully without network access or API keys. Network-dependent features are optional enhancements, never requirements.
- **No assumed inference.** Tool identification, naming, and categorisation must not assume a specific ML model or remote service. These features should be behind pluggable interfaces with manual/simple fallbacks as the default.
- **Coordinate system discipline.** SVG/layout Y is down; manifold3d Y is up. Always negate Y when crossing that boundary. See docs/gotchas.md.

## Scope

Tracefinity is the photo-tracing-to-gridfinity pipeline. Photos are the input; gridfinity bins are the output. Features that serve this pipeline are in scope. Features that turn it into a general outline-to-bin converter are not.

**Non-goals:**
- Alternative outline import formats (SVG, DXF, STL, manual drawing). See #134.
- Non-gridfinity output (freeform bin dimensions, non-standard grids). See #72.
- General-purpose 2D-to-3D conversion unrelated to the tracing workflow.

## Architecture

- **Keep PRs focused.** One concern per PR. If you're touching unrelated files (sidebar width, dev scripts, polish), split them out.
- **Backward compatible schemas.** New fields must have defaults. Existing data must load without migration.
- **Tests must actually run.** Run the backend `pytest` suite and frontend `pnpm test` suite before submitting; compilation alone is not enough.

## Frontend

- **State complexity budget.** If a component has more than ~8 useState hooks, extract related state into a custom hook or sub-component.
- **No polling when SSE/websockets fit.** For background tasks that update UI, prefer server-sent events over polling loops.

## Backend

- **Atomic data operations.** Anything that replaces user data must be atomic (swap, not clear-then-copy). Partial failure must not lose data.
- **Single source of truth for config.** Use pydantic-settings. Don't read env vars directly alongside Settings.

## Linting

Run `make lint` before submitting a PR. CI enforces the same checks on all PRs and pushes to main.

| Layer | Tool | Config |
|-|-|
| Python | [ruff](https://docs.astral.sh/ruff/) | `pyproject.toml` -- E/F/W/I rules, E402+E501 ignored |
| TypeScript | ESLint + `eslint-config-next` | `frontend/eslint.config.mjs` |
| Types | `tsc --noEmit` | `frontend/tsconfig.json` |

Targets: `make lint-backend`, `make lint-frontend`, `make lint-fix` (auto-fix where possible).
