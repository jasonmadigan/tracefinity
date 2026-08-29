"""retention sweep for generated export artefacts.

STLs, 3MFs, part zips, and generation hash markers are regenerable from
stored polygons and bin config, so they are purged once older than the
configured retention. scope is deliberately tight: only files directly
inside each user's outputs/ dir with an export suffix. photos, traces,
tool/bin/session stores, and anything nested are never touched.
"""

from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path

logger = logging.getLogger(__name__)

SWEEP_INTERVAL_SECONDS = 15 * 60

# every file _run_generate writes ends in one of these
_ARTEFACT_SUFFIXES = {".stl", ".3mf", ".zip", ".hash"}


def sweep_expired_outputs(storage_path: Path, retention_hours: float, now: float | None = None) -> int:
    """delete export artefacts older than retention_hours; returns count removed.

    retention_hours <= 0 disables the sweep entirely (keep forever).
    """
    if retention_hours <= 0:
        return 0
    cutoff = (now if now is not None else time.time()) - retention_hours * 3600
    removed = 0
    for outputs_dir in sorted(storage_path.glob("*/outputs")):
        if not outputs_dir.is_dir():
            continue
        for entry in outputs_dir.iterdir():
            if entry.suffix not in _ARTEFACT_SUFFIXES:
                continue
            try:
                if not entry.is_file() or entry.stat().st_mtime >= cutoff:
                    continue
                entry.unlink()
            except FileNotFoundError:
                # generation or deletion raced the sweep; nothing left to do
                continue
            removed += 1
    return removed


async def retention_loop(storage_path: Path, retention_hours: float) -> None:
    """periodic sweep; first pass runs immediately to catch crash leftovers."""
    while True:
        try:
            removed = await asyncio.to_thread(sweep_expired_outputs, storage_path, retention_hours)
            if removed:
                logger.info("retention sweep removed %d expired export file(s)", removed)
        except Exception:
            logger.exception("retention sweep failed")
        await asyncio.sleep(SWEEP_INTERVAL_SECONDS)
