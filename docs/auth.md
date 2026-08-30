# Authentication

Tracefinity ships with native authentication. A fresh installation prompts for
administrator credentials on first visit; no shared or default password exists
at any point. Everything here works offline and needs no external service.

## Modes

`AUTH_MODE` selects how identity is established.

| Mode | Behaviour |
|-|-|
| `native` (default) | Cookie login with first-run admin setup. Requests without a valid login receive `401` |
| `proxy` | Trusted reverse proxy supplies `X-User-Id` with the matching `X-Proxy-Secret`. Requests without the header receive `401`. Deprecated: retained for existing deployments; removal will be announced with a migration path |
| `open` | The pre-authentication single-user behaviour, for trusted private networks. The only mode where requests silently fall back to the `default` workspace |

Precedence: an explicit `AUTH_MODE` always wins. When `AUTH_MODE` is unset and
`PROXY_SECRET` is set, `proxy` is selected so existing proxy deployments are
unchanged. `AUTH_MODE=proxy` without `PROXY_SECRET` is a startup error.

## First run

In native mode, `GET /api/auth/status` reports `setup_required: true` until an
administrator exists, and the frontend routes to `/setup`. Creating the first
account:

- makes it an administrator
- claims any existing single-user data by assigning it the `default` storage
  namespace; nothing on disk moves, so the claim is atomic and non-destructive
- logs the browser in

A concurrent second setup attempt receives `409`.

Setup is open on a fresh install, and stays open on an install that is being
upgraded from `open` or `proxy` mode so its existing library can be claimed.
On a self-hosted instance that is the point: the first person to reach it is
the operator. If the instance already holds data when native mode starts with
no accounts, the log carries a warning saying so, because the same state also
describes a mis-mounted volume or a partial restore, where the next caller
inherits somebody else's library.

Deployments that create administrators out of band do not want that door at
all. `AUTH_SETUP_ENABLED=false` removes it: `POST /api/auth/setup` returns
`404` whatever the account store holds, and `GET /api/auth/status` never
reports `setup_required: true`, so the instance does not advertise a first run
it will not honour. Those deployments create the first administrator with the
command below.

## Configuration

| Variable | Default | Description |
|-|-|-|
| `AUTH_MODE` | `native` | `native`, `proxy`, or `open` (see above) |
| `AUTH_SECRET` | auto-generated | Key material for encrypting 2FA secrets at rest. Auto-generated into `{storage}/auth_secret` (mode 0600) at first native startup; an environment value wins over the file and must be at least 32 characters |
| `AUTH_SECRET_PREVIOUS` | | Previous `AUTH_SECRET` during rotation. Stored secrets re-encrypt lazily as accounts log in |
| `AUTH_COOKIE_SECURE` | `false` | Mark the auth cookie `Secure`. Set `true` behind TLS |
| `AUTH_COOKIE_DOMAIN` | host-only | Cookie domain for subdomain topologies. Leave unset normally |
| `AUTH_SETUP_ENABLED` | `true` | Whether the first-run web setup exists. Set `false` for deployments that create administrators by other means (see below) |
| `AUTH_ALLOW_ACCOUNT_DATA_WITHOUT_LOGIN` | `false` | Permit `open` or `proxy` mode on an instance that already has native accounts. Refused by default (see below) |

The auth cookie (`tracefinity_auth`) is HttpOnly, SameSite=Lax, with a 14-day
sliding lifetime. Tokens are stored hashed in `{storage}/auth_tokens.json`,
which also holds the administrator API tokens described below; accounts live in
`{storage}/users.json`. Back up both with your storage volume.

When serving the frontend from a different origin than the backend, set
`CORS_ORIGINS` to the real frontend origin. Credentials are only sent to
configured origins, so a wrong value breaks login rather than weakening it.
`CORS_ORIGINS=*` is refused at startup under native authentication: requests
carry credentials, so a wildcard would let any site call the API as the
logged-in user.

`AUTH_SECRET` must be at least 32 characters when set. It derives the key
that encrypts every stored 2FA secret, and it overrides the generated file
secret, so a short value makes `users.json` worth brute-forcing offline.
Leaving it unset generates a strong one into the storage volume.

## Accounts and administration

The first account is the administrator. `/api/admin/users` covers the minimum
management surface: list, create, disable and enable (disabling revokes the
account's auth tokens immediately), reset password, and clear 2FA. Every
account can change its own password; a password change logs out other devices.
`/api/admin/tokens` issues and revokes the non-interactive credential described
under [Administrator API tokens](#administrator-api-tokens).

Disabling refuses with `409` when it would leave the instance with no enabled
administrator. The check runs inside the account store under its lock, not in
the route, because two administrators disabling each other pass a route check
independently and both land, leaving nobody able to administer or recover the
instance. Enabling an account is never refused, so an instance that arrives in
that state on a restored volume can still be repaired.

`DELETE /api/users/me` in native mode deletes the account record and revokes
its tokens along with all stored data. It refuses with `409` when the caller
is the only enabled administrator and other accounts remain, because first-run
setup only opens on an empty account store: an instance left with accounts but
no administrator could not be recovered. Deleting the last remaining account
is allowed and returns the instance to first run.

The account record goes before the stored data, so a storage failure part-way
through can leave files with no owner. Deletion marks the namespace first and
only unmarks it once the files are gone, and an account creation that would
claim a marked namespace still holding files is refused with `409`. Remove
that directory from the storage volume to release the namespace.

That refusal happens where a namespace is claimed, which is account creation.
Proxy mode has no accounts: the namespace is whatever `X-User-Id` says, and
Tracefinity cannot tell the original user retrying from a different person
holding a recycled id. A proxy deployment whose identity provider reissues
subject ids must not reuse an id whose deletion failed.

Instance-wide storage totals (`GET /api/admin/storage-stats`) require an
administrator in native mode, and the `PROXY_SECRET` header in proxy mode. In
`open` mode that endpoint, like the rest of the API, is unauthenticated by
design. Switching a populated native instance to `open` would therefore make
its per-account namespace ids anonymously enumerable, which is one of the
reasons that switch is refused at startup.

Admin create also supports importing accounts from a prior system: an optional
caller-supplied `id` (keeps storage keying), a `password_hash` in bcrypt
(`$2a$`/`$2b$`/`$2y$`) or native `$scrypt$` form, a base32 `totp_secret`,
`backup_code_hashes`, and `created_at`. Imports are validated before anything
is written; a repeated import of the same id and email is a no-op and never
overwrites. Imported bcrypt credentials are verified as-is and transparently
rehashed to the native scheme on first successful login. The first
administrator exists before that endpoint can be called, so the command below
imports the same material for that one account.

## Creating the first administrator out of band

Some deployments provision administrators outside the browser: containerised
installs, automated provisioning, or any instance running with
`AUTH_SETUP_ENABLED=false`, where the web setup route does not exist. The
backend carries a command for that, run from `backend/`:

```bash
python -m app.cli create-admin --email you@example.com
```

In a container:

```bash
# interactive prompt
docker exec -it -w /app/backend --user tracefinity <container> \
  python -m app.cli create-admin --email you@example.com

# automated, password on stdin
printf '%s' "$ADMIN_PASSWORD" | docker exec -i -w /app/backend --user tracefinity \
  <container> python -m app.cli create-admin --email you@example.com
```

The password is never a command-line argument, which would leave it in shell
history and in the process table. It is prompted for and confirmed when stdin
is a terminal, and read as a single line from stdin when it is not.

Prefer running the command as the user the backend runs as: `--user
tracefinity` for the default image, or the same `--user` value passed to
`docker run`. It is not required. `users.json` is written mode 0600 owned by
whoever creates it, so without `--user` a `docker exec` lands as `root` and
leaves a credential store the backend user cannot read. When the command does
run as `root` it hands everything it created to whoever owns the storage root,
which is the same target the container entrypoint chowns to, so the instance
starts either way. A file it could not hand over is named in a warning and
the administrator is still created; `chown` that path to the storage owner.

By default the account is the one `POST /api/auth/setup` would create: an
administrator claiming the `default` storage namespace, so existing
single-user data is claimed intact. The command refuses when an account
already exists rather than adding a second or overwriting the first; further
accounts are created through `/api/admin/users`.

| Option | Purpose |
|-|-|
| `--email` | Login email address. Required |
| `--id` | Account id instead of a generated uuid, so provisioning can preserve existing keying. Same format contract as the admin create endpoint. It keys the account, not the namespace |
| `--storage-namespace` | Storage namespace the account opens onto. Defaults to `default` |
| `--password-hash` | Import an existing bcrypt (`$2a$`/`$2b$`/`$2y$`) or native `$scrypt$` credential instead of setting a password. Validated as an admin import is, and bcrypt rehashes to the native scheme on first successful login |
| `--totp-secret` | Import an existing base32 TOTP secret, so an administrator carrying a second factor from a previous system keeps it. Omitted, the account is created with 2FA off |
| `--backup-code-hash` | Import one already-hashed backup code, in the same form as `--password-hash`. Repeat the option for each code |

Reach for `--storage-namespace` when provisioning an account that already owns
storage from a previous system, alongside `--id`. Accounts created through
`/api/admin/users` are namespaced by their account id, so restoring one onto a
new instance means passing that id to both options:

```bash
python -m app.cli create-admin --email you@example.com \
  --id <existing-id> --storage-namespace <existing-id>
```

Supplying `--id` on its own keys the account but not its storage, which would
point a restored account at `default` and leave its real data orphaned under
`storage/<existing-id>/`.

Omitting the option claims `default`, which is what the web first-run flow
does, and is what a self-hoster taking a single-user instance into
authenticated use wants.

The value becomes a directory name under the storage root, so it is held to
the same format contract as `--id`, plus the literal `default`. Anything else
is rejected. Whichever namespace is chosen, it is claimed on the same terms:
a namespace whose deletion did not finish is refused.

`--totp-secret` imports a second factor on the same terms as the admin create
endpoint, through the same validation and the same encryption at rest, so the
account behaves identically to one created through `/api/admin/users`. Supply
`--backup-code-hash` once per code to carry the account's backup codes across
too:

```bash
python -m app.cli create-admin --email you@example.com \
  --totp-secret <base32-secret> \
  --backup-code-hash <hash> --backup-code-hash <hash>
```

The secret is validated before anything is written, so a malformed one creates
no account and leaves an unfinished deletion's namespace marker intact. The
command reports whether a second factor was imported and never prints the
secret. Without `--totp-secret` the account is created with 2FA off, and
login stays one step.

`AUTH_SETUP_ENABLED` does not apply: it governs the web route, and closing
that route is the reason this command exists. The resolved `AUTH_MODE` does
apply and must be `native`. In `open` or `proxy` mode the command refuses,
because native login does not exist there and an instance holding accounts
refuses to start in either mode. To provision ahead of switching an instance
over, set the variable for the one command: `docker exec -e AUTH_MODE=native
...`.

| Exit code | Meaning |
|-|-|
| 0 | Administrator created |
| 1 | Refused by instance state: `AUTH_MODE` is not `native`, the namespace is unclaimable, or storage failed |
| 2 | Invalid input or usage |
| 3 | An account already exists, so there was nothing to do |

Errors go to stderr. Neither the password, the stored hash, nor an imported
TOTP secret is ever printed.

## Administrator API tokens

The first-run command above covers provisioning before anyone can log in.
Ongoing administration has the same problem in a different place: a deployment
that creates accounts from its own front end, an internal tool, or a
provisioning script cannot drive a browser login, and cannot supply a second
factor at all. An administrator API token is the credential for that. It
authenticates to part of the admin API with no password step and no second
factor.

Issuing one requires a logged-in administrator. There is no unauthenticated or
bootstrap path to minting one, and a token cannot mint another, directly or by
creating an administrator that could: containing a leak means revoking what an
administrator issued, with no chain of successors to chase.

```bash
# log in, keeping the session cookie (a 2FA account redeems its code as usual)
curl -sc cookies.txt -X POST http://localhost:8000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"..."}'

# issue the token; the raw value is in this response and nowhere else
curl -sb cookies.txt -X POST http://localhost:8000/api/admin/tokens \
  -H 'content-type: application/json' \
  -d '{"label":"provisioner"}'
```

The response carries `token` once. It is stored only as a sha256 hash in
`{storage}/auth_tokens.json`, alongside login tokens, so nothing can print it
again: a lost token is revoked and reissued, not recovered. It never appears
in a log line, an error, or any later response. Values carry a `tfadm_` prefix
so a leaked one is recognisable in a repository or a CI log.

Present it as a bearer credential:

```bash
curl -X POST http://localhost:8000/api/admin/users \
  -H "Authorization: Bearer $TRACEFINITY_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"email":"new@example.com","password":"a new password"}'
```

`Authorization` is used rather than a bespoke header because every HTTP client
already handles it, and because a browser never attaches it on its own, so a
token cannot become an ambient credential the way a cookie is. It does not
collide with `X-Proxy-Secret`, which authenticates a proxy rather than a
person, or with the auth cookie. A request carrying a bearer
token is decided by that token: an invalid one is `401` and never falls back
to a cookie that happens to be present. An `Authorization` header in another
scheme, such as a fronting proxy's own basic auth, is ignored and the cookie
still applies.

### What a token reaches

| Endpoint | Token | Why |
|-|-|-|
| `GET /api/admin/users` | yes | Provisioning has to be able to check what already exists |
| `POST /api/admin/users` | yes, never an administrator | The reason the credential exists |
| `POST /api/admin/users/{id}/reset-password` | yes, not an administrator's | Scripted recovery and rotation |
| `POST /api/admin/users/{id}/disable`, `/enable` | yes, not an administrator's | Deprovisioning is provisioning |
| `POST /api/admin/users/{id}/clear-2fa` | no | See below |
| `GET`, `POST`, `DELETE /api/admin/tokens` | no | A token must not mint or revoke credentials |
| `GET /api/admin/storage-stats` | no | Not provisioning, and it enumerates every namespace on the instance |
| Everything else under `/api` | no | A token is not a login |

#### Administrator accounts sit outside a token's reach

A token neither creates an administrator nor writes to an account that is one.
`is_admin: true` on create is `403`, as is a password reset, disable or enable
whose target is an administrator, the account that issued the token included.
Ordinary accounts are untouched by the rule: creating, resetting, disabling and
enabling those is the whole point of the credential. An administrator session
keeps every one of these abilities.

The refusal is explicit rather than a quiet downgrade to a member account,
because a provisioning script that asked for an administrator and got a `200`
would carry on believing it had one.

Without that rule the rest of this table is decoration. A token that can set
`is_admin` creates an account with no second factor, logs in as it
interactively, and holds a session: successor tokens, clearing 2FA on anyone,
storage stats, all of it. A token that can reset an administrator's password
arrives at the same place in one step fewer. Disable and enable are excluded
for a weaker reason, denial of service rather than escalation: suspending every
other administrator leaves the people who could revoke the token unable to log
in, and the rule is easier to rely on stated once than carved out per route.

Clearing a second factor is left out on the same principle in a different
shape. A credential that authenticates without a second factor must not be able
to remove second factors from accounts, which combined with a password reset
would make every ordinary account on the instance takeable by whoever holds the
token. Recovery for a lost authenticator stays an interactive act.

Reading is not restricted this way. `GET /api/admin/users` lists every account,
administrators included. It confers no authority, provisioning needs it to see
what already exists, and it is how a caller learns which accounts it may not
write to.

The split is enforced by which dependency each route declares, and the router
declares the administrator check as its default, so a route added without one
is authenticated rather than anonymous. Such a route is reachable by a token;
one that must not be declares the session-only dependency, and both are then
required for the request to proceed.

A token is not a login. It does not authenticate `GET /api/auth/me`, the
password or 2FA endpoints, or any session, tool, bin, or project route, and it
cannot be pasted into the auth cookie: the two kinds of token are stored
together but resolved separately, and neither resolver accepts the other's.

### Revoking

```bash
curl -sb cookies.txt http://localhost:8000/api/admin/tokens
curl -sb cookies.txt -X DELETE http://localhost:8000/api/admin/tokens/<id>
```

Revocation takes effect on the next request. The listing is instance-wide, not
per administrator, so whoever is dealing with a leak can see and revoke a
credential another administrator issued. It reports the issuing account, the
label, when the token was created and last used, and its expiry, never the
token itself.

Revoking a token does not log its issuer out, and logging out does not revoke
the token. A password change, whether self-service or an administrator reset,
revokes login tokens and leaves administrator API tokens alone: rotating a
password is not evidence that a provisioning credential leaked, and quietly
breaking automation on every rotation would teach operators not to rotate.
Revoke a token explicitly when it needs to go.

Disabling the issuing account makes its tokens inert immediately, because every
one of them is checked against the live account on use. Enabling the account
restores them: a disable is a suspension, not a revocation. Demoting the
account out of `is_admin` has the same effect. Deleting the account destroys
its tokens outright.

### Expiry

There is no expiry by default. Provisioning automation runs for as long as the
deployment does, and a credential that silently stops working is a credential
that fails in the middle of something. Pass `expires_in_days` at issue time
when a bounded one is wanted:

```bash
curl -sb cookies.txt -X POST http://localhost:8000/api/admin/tokens \
  -H 'content-type: application/json' \
  -d '{"label":"migration", "expires_in_days": 7}'
```

Unlike the login cookie, an administrator API token never slides: using it
does not push its deadline out, so a bounded credential stays bounded.

Nothing needs configuring to use any of this, and there is no rate limit on
token authentication. The credential is 256 bits of `secrets.token_urlsafe`
compared against stored hashes in constant time with no oracle to work
against, so guessing one is not an attack that a limit would help with, and a
limit keyed on anything a caller controls would hand an attacker a way to lock
out an operator's automation. Password login stays rate limited because
passwords are not 256 bits of randomness.

Tokens exist in `native` mode only. In `open` and `proxy` mode the whole
`/api/admin/users` surface returns `404` as it always has, bearer credential or
not, so nothing here extends `PROXY_SECRET` or has to be unwound when `proxy`
mode goes.

### Attribution

Every administrative mutation is logged with the account that made it and, when
a token was used, the token:

```
admin 3f2a... created account 9b1c...
admin 3f2a... via token 7d41... created account 9b1c...
```

Account creation, disable, enable, password reset and clearing 2FA all record
this, as do issuing and revoking tokens.

## What stays public in native mode

Everything under `/api` resolves identity per mode, so in native mode an
unauthenticated request receives `401`. These are the exceptions, and each is
deliberate:

| Endpoint | Why |
|-|-|
| `GET /health` | Container and load-balancer probes run before any login exists |
| `GET /api/version` | Already toggled off by `SHOW_APP_VERSION=false` |
| `GET /api/auth/status` | The frontend cannot route to `/setup` or `/login` without it |
| `POST /api/auth/setup` | Creating the first administrator is by definition unauthenticated |
| `POST /api/auth/login`, `POST /api/auth/login/2fa` | The login itself |
| `POST /api/auth/logout` | Clears a cookie; revokes nothing when there is none |

FastAPI's generated schema and its viewers (`/openapi.json`, `/docs`,
`/docs/oauth2-redirect`, `/redoc`) are not served in any mode. They granted no
access, but they published a complete description of every endpoint including
the admin surface, and nothing in the product consumes them.

`GET /api/api-keys` is not on that list. It reports tracer configuration,
whether cloud keys are set, and whether photo stations are on, so it resolves
identity like any other route: `401` in native mode without a login, the
proxy identity in proxy mode, unauthenticated in `open` mode.

## Recovery

A forgotten password is reset by an administrator
(`POST /api/admin/users/{id}/reset-password`), which also clears the account's
lockout and revokes its auth tokens. Removing `users.json` is not a password
reset. It deletes every account on the instance and returns a populated
instance to first run, so unless setup is disabled the next caller to reach
`/setup` becomes the administrator and claims the `default` namespace, meaning
whatever library was already there. The same applies to a volume that mounts
empty or restores without that file.

The sole administrator who loses their own password has no in-product path
back in, by design: nothing in the running instance can prove it is them.
Recovery is an operator task on the storage volume, and the safe shape of it
is editing the account's `password_hash` in `users.json` to a known native
`$scrypt$` hash, not deleting the file.

## Two-factor authentication

Accounts can enrol TOTP (RFC 6238: SHA-1, 6 digits, 30-second step) from the
account page. Enrolment shows a QR code and requires a first valid code before
2FA enables, then issues ten single-use backup codes. Login becomes two-step:
the password step returns a five-minute single-use pending token, redeemed
with a TOTP or backup code. Codes cannot be replayed, and failed attempts are
rate limited per account together with password failures.

Disabling 2FA requires the password plus a current code. Recovery for a lost
authenticator is an administrator clearing 2FA on the account
(`POST /api/admin/users/{id}/clear-2fa`); the sole administrator losing both
their authenticator and backup codes has no in-app recovery, so store backup
codes safely.

TOTP secrets are encrypted at rest (AES-256-GCM) under `AUTH_SECRET`. To
rotate: set the new `AUTH_SECRET`, set `AUTH_SECRET_PREVIOUS` to the old
value, and remove `AUTH_SECRET_PREVIOUS` once accounts have logged in again.
Losing `AUTH_SECRET` without a rotation window makes stored 2FA secrets
undecryptable; clear 2FA on affected accounts to recover.

## Opting out

`AUTH_MODE=open` restores the pre-authentication behaviour for installations
on trusted private networks. Nothing else changes: data stays in the `default`
namespace and is claimed intact if native mode is enabled later.

That is a decision to take before any account exists. An instance that already
has accounts in `users.json` refuses to start in `open` or `proxy` mode, and
says why:

- `open` serves every request from the `default` namespace, which is the first
  administrator's own storage. Their projects would be readable, and an
  unauthenticated `DELETE /api/users/me` would destroy them.
- `proxy` takes the namespace from `X-User-Id`, and `default` does not satisfy
  the user id format, so the first administrator's data becomes unreachable
  while every other account's namespace is selectable by whoever holds the
  proxy secret.

Move an instance the other way instead, by keeping `AUTH_MODE=native`, or
remove the accounts and their storage before switching.
`AUTH_ALLOW_ACCOUNT_DATA_WITHOUT_LOGIN=true` permits the switch for an
operator who wants exactly the exposure above; it logs a warning at every
startup and is not a supported way to run an exposed instance.
