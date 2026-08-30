# API Endpoints

## Authentication

Identity depends on `AUTH_MODE` (see [auth.md](auth.md)). In `native` mode
(default), the `tracefinity_auth` cookie authenticates API and `/storage`
requests; unauthenticated requests receive `401`. In `proxy` mode a trusted
reverse proxy sets `X-User-Id` with the matching `X-Proxy-Secret`; requests
without the header receive `401`. In `open` mode requests fall back to the
`default` namespace. Requests carrying `X-User-Id` when it is not trusted
receive `403 Forbidden`.

### Auth endpoints (native mode)

- `GET /api/auth/status` - `{mode, setup_required, authenticated}`; available in every mode
- `POST /api/auth/setup` - create the first administrator; `409` once setup is done
- `POST /api/auth/login` - password login; 2FA accounts get `{pending: true, pending_token}` instead of a cookie
- `POST /api/auth/login/2fa` - redeem a pending token with a TOTP or backup code
- `POST /api/auth/logout` - revoke the auth token and clear the cookie
- `GET /api/auth/me` - the authenticated account
- `POST /api/auth/password` - self-service password change (requires the current password)
- `POST /api/auth/2fa/enroll` - start TOTP enrolment; returns the secret and otpauth URI
- `POST /api/auth/2fa/confirm` - confirm with a first valid code; enables 2FA and returns backup codes
- `POST /api/auth/2fa/backup-codes` - regenerate backup codes (password + current code)
- `POST /api/auth/2fa/disable` - disable 2FA (password + current code)

Two-step login errors carry a machine-readable code so a client can tell them
apart without matching on wording: `detail` is
`{"code": ..., "message": ...}` instead of a plain string.
`pending_login_invalid` means the pending token is spent and the login must
restart; `two_factor_code_invalid` means only the code was wrong and the
pending token is still good.

### Admin endpoints (native mode)

- `GET /api/admin/users` - list accounts
- `POST /api/admin/users` - create an account; supports credential import (see [auth.md](auth.md))
- `POST /api/admin/users/{id}/disable` - disable and revoke the account's tokens immediately
- `POST /api/admin/users/{id}/enable` - re-enable
- `POST /api/admin/users/{id}/reset-password` - set a new password, revoking tokens
- `POST /api/admin/users/{id}/clear-2fa` - recovery for a lost authenticator

## Sessions (trace workflow)
- `POST /api/upload` - upload image, auto-detect corners
- `POST /api/sessions/{id}/corners` - set corners, apply perspective correction; returns advisory photo warnings (camera too close, paper cut off, extreme perspective)
- `POST /api/sessions/{id}/trace` - AI trace tool outlines
- `POST /api/sessions/{id}/trace-mask` - trace from uploaded mask
- `PUT /api/sessions/{id}/polygons` - save polygon edits
- `POST /api/sessions/{id}/generate` - generate STL/3MF from traced polygons
- `POST /api/sessions/{id}/save-tools` - convert traced polygons to library tools
- `GET /api/sessions` - list sessions
- `GET /api/sessions/{id}` - get session state
- `PATCH /api/sessions/{id}` - update session metadata
- `DELETE /api/sessions/{id}` - delete session

Trace and mask-trace responses include the final visible `Polygon.label` values for the trace result. When `TOOL_LABEL_PROVIDER=ollama`, the backend attempts optional naming before persisting the session; naming failures keep the generic `tool N` labels.

## Tools (library)
- `GET /api/tools` - list tools
- `GET /api/tools/{id}` - get tool
- `PUT /api/tools/{id}` - update tool (name, points, finger_holes)
- `POST /api/tools/{id}/auto-rotate` - compute optimal rotation angle (degrees) to minimise bounding box
- `DELETE /api/tools/{id}` - delete tool

## Bins
- `GET /api/bins` - list bins
- `GET /api/bins/{id}` - get bin (syncs placed tools with library versions)
- `POST /api/bins` - create bin (optionally with tool_ids for auto-sizing and bin_config defaults)
- `PUT /api/bins/{id}` - update bin
- `DELETE /api/bins/{id}` - delete bin + output files
- `POST /api/bins/{id}/generate` - generate STL/3MF from bin

Both generation endpoints may return `503 Service Unavailable` with
`Retry-After: 5` when `STL_GENERATION_CONCURRENCY` is configured and every
generation slot remains occupied for 5 seconds. Cached generation responses
bypass this queue.

## Bin projects
- `GET /api/bin-projects` - list project summaries with tool/bin/placement counts
- `POST /api/bin-projects` - create a project, optionally seeded with tool ids
- `GET /api/bin-projects/{id}` - get project detail with derived placed/unplaced tool ids
- `PATCH /api/bin-projects/{id}` - update project metadata and status
- `DELETE /api/bin-projects/{id}` - delete project metadata; tools and bins are retained
- `POST /api/bin-projects/{id}/tools` - add tools to a project
- `DELETE /api/bin-projects/{id}/tools/{tool_id}` - remove a tool from a project
- `POST /api/bin-projects/{id}/bins` - link existing bins to a project
- `DELETE /api/bin-projects/{id}/bins/{bin_id}` - detach a bin from a project
- `POST /api/bin-projects/{id}/create-bin` - create a new bin from selected project tools, using project or request bin defaults
- `GET /api/bin-projects/{id}/health` - report project/tool/bin link mismatches
- `POST /api/bin-projects/{id}/repair` - repair safe project/tool/bin link mismatches

## API Keys and tracer status
- `GET /api-keys` - returns current provider and available tracers

Response fields:
- `google` (bool): true when the server can trace without a user-supplied key (cloud env key, local, or remote).
- `provider` (string|null): one of `gemini` | `local` | `remote`.
- `provider_label` (string|null): human label for the primary tracer, e.g. `Replicate`.
- `tracers` (array): `{id, label}` entries. Remote tracers include `{"id":"replicate","label":"Replicate"}` and `{"id":"fal","label":"fal.ai"}` when the respective tokens are configured.

## Meta
- `GET /api/version` - running app version. Release images report the release tag (e.g. `0.6.0`), dev images `dev-<sha>`, local runs `dev`. Returns 404 when `SHOW_APP_VERSION=false`.

## File serving
- `GET /api/files/{session_id}/bin.stl` - session STL
- `GET /api/files/{session_id}/bin.3mf` - session 3MF
- `GET /api/files/{session_id}/bin_parts.zip` - session split parts
- `GET /api/files/bins/{bin_id}/bin.stl` - bin STL
- `GET /api/files/bins/{bin_id}/bin.3mf` - bin 3MF
- `GET /api/files/bins/{bin_id}/bin_parts.zip` - bin split parts

Exports are subject to the retention sweep (`STL_RETENTION_HOURS`, see
[stl-generation.md](stl-generation.md)); a purged file returns `404` until the
bin is regenerated.
