# Backup and Restore

All Tracefinity state lives in a single storage directory. There is no database, no migration step. Backup means copying the directory; restore means copying it back.

## What's in the storage directory

```
storage/
  users.json                # accounts (hashed credentials, encrypted 2FA secrets)
  auth_tokens.json          # hashed login tokens
  auth_secret               # key material for 2FA secrets (unless AUTH_SECRET is set)
  default/                  # user namespace
    sessions.json           # in-progress trace sessions
    tools.json              # saved tool definitions (polygons, metadata)
    bins.json               # bin configurations (dimensions, placed tools, labels)
    bin-projects.json       # project groupings and status
    uploads/                # original uploaded photos
    processed/              # perspective-corrected images, masks
    outputs/                # generated STLs and 3MF files
    tools/                  # tool thumbnail images
    bins/                   # bin preview images
```

Everything is plain JSON and image files. No binary database format. Back up
the whole directory: restoring user data without `users.json` and
`auth_secret` loses accounts and stored 2FA secrets.

## Docker backup

Stop the container, copy the bind mount directory, restart:

```bash
docker stop tracefinity
cp -r ./data ./data-backup-$(date +%Y%m%d)
docker start tracefinity
```

Alternatively, copy without stopping using `docker cp`. Note that files may be in-flight during writes, so JSON files could be partially written:

```bash
docker cp tracefinity:/app/storage ./data-backup-$(date +%Y%m%d)
```

The stopped-container approach is safer.

## Local dev backup

```bash
cp -r ./data ./data-backup-$(date +%Y%m%d)
```

Or wherever your storage directory is. The default path is `./storage` relative to the backend working directory.

## Restore

1. Stop the container (or the dev server).
2. Replace the storage directory with your backup.
3. Restart.

```bash
docker stop tracefinity
rm -rf ./data
cp -r ./data-backup-20250614 ./data
docker start tracefinity
```

## Storage path configuration

The storage location is set via the `STORAGE_PATH` environment variable. Default is `./storage` relative to the backend. In Docker, the typical setup bind-mounts a host directory to `/app/storage`:

```bash
docker run -p 3000:3000 -v ./data:/app/storage ghcr.io/tracefinity/tracefinity
```

Back up whichever host directory you've mounted.
