# Engineering design principles

[CONSTITUTION.md](CONSTITUTION.md) defines what product Tracefinity should be.
[CONTRIBUTING.md](CONTRIBUTING.md) explains how to propose and submit changes.
This document records the engineering decisions that should survive individual
implementations.

## Coordinate systems

SVG and layout coordinates have Y increasing downwards. Manifold3d has Y
increasing upwards. Negate Y whenever data crosses that boundary. See
[docs/gotchas.md](docs/gotchas.md) for the consequences and regression traps.

## Data and configuration

- New schema fields need defaults. Existing user data must continue to load
  without a manual migration.
- Operations that replace user data must be atomic. Build the replacement first,
  then swap it in; partial failure must not destroy the previous state.
- `pydantic-settings` is the source of truth for backend configuration. Do not
  read environment variables directly alongside `Settings`.

## Integration boundaries

Integrations depend on Tracefinity capabilities, not provider-specific concepts.
Keep provider code behind adapters so adding or removing one does not leak its
assumptions through routes, storage, and UI state.

## Frontend

- Treat roughly eight `useState` hooks in one component as a prompt to extract a
  coherent custom hook or sub-component. Count relationships, not merely lines.
- For background work that updates the UI, prefer server-sent events or
  websockets to polling loops.

## Verification

Tests need to exercise the change, not merely prove that it compiles. Run the
backend `pytest` suite and frontend `pnpm test` suite before submitting. Run
`make lint`; CI enforces the same backend lint, frontend lint, and type checks.

| Layer | Tool | Configuration |
|-|-|-|
| Python | [ruff](https://docs.astral.sh/ruff/) | `pyproject.toml` (`E/F/W/I`, with `E402` and `E501` ignored) |
| TypeScript | ESLint with `eslint-config-next` | `frontend/eslint.config.mjs` |
| Types | `tsc --noEmit` | `frontend/tsconfig.json` |

Useful targets: `make lint-backend`, `make lint-frontend`, and `make lint-fix`.
