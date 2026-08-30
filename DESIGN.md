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
- Explicit user and project settings take precedence over broader defaults.
  Defaults must not silently replace a choice the user already saved.
- Operations that replace user data must be atomic. Build the replacement first,
  then swap it in; partial failure must not destroy the previous state.
- Atomic is not durable. A rename can reach the directory entry while the
  contents are still in the page cache, so credential and identity material must
  be flushed to disk before the rename and the containing directory flushed
  after it. `app/services/durable_write.py` does both; a platform that cannot
  flush a directory degrades rather than failing the write.
- Do not turn corrupt persistent data into an empty store and then overwrite the
  evidence. Preserve the original and surface a useful error or recovery path.
- Clean up files created by failed operations. Check failure paths as carefully
  as the happy path, especially when several files or records must stay in sync.
- `pydantic-settings` is the source of truth for backend configuration. Do not
  read environment variables directly alongside `Settings`.
- New configuration must have a safe, working default. Example resource values
  must be realistic for Tracefinity, and optional platform-specific acceleration
  must remain opt-in when making it the default would break supported installs.
- Add a data or preference migration only for state a released version actually
  wrote. A version bump must not erase saved choices merely because the current
  code changed.

## Integration boundaries

Integrations depend on Tracefinity capabilities, not provider-specific concepts.
Keep provider code behind adapters so adding or removing one does not leak its
assumptions through routes, storage, and UI state.

## Frontend

- Treat roughly eight `useState` hooks in one component as a prompt to extract a
  coherent custom hook or sub-component. Count relationships, not merely lines.
- For background work that updates the UI, prefer server-sent events or
  websockets to polling loops.
- One failed request should not blank unrelated data that loaded successfully.
  Show partial failure and keep the rest of the page useful.
- Guard repeated submissions and stale async responses so a slow operation
  cannot overwrite a newer choice.
- User-facing status, errors, and controls must remain readable and operable in
  each supported theme and without relying on colour alone.

## Verification

Tests need to exercise the changed behaviour, not merely prove that it compiles
or returns non-empty geometry. Assert the physical property or user outcome that
could regress, including failure and compatibility paths where relevant. Preview
math and generated geometry should use the same rule or have a test proving they
agree.

Run the backend `pytest` suite and frontend `pnpm test` suite before submitting.
Run `make lint`; CI enforces the same backend lint, frontend lint, and type
checks.

| Layer | Tool | Configuration |
|-|-|-|
| Python | [ruff](https://docs.astral.sh/ruff/) | `pyproject.toml` (`E/F/W/I`, with `E402` and `E501` ignored) |
| TypeScript | ESLint with `eslint-config-next` | `frontend/eslint.config.mjs` |
| Types | `tsc --noEmit` | `frontend/tsconfig.json` |

Useful targets: `make lint-backend`, `make lint-frontend`, and `make lint-fix`.
