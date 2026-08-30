"""durable replacement of a file on disk.

mkstemp plus os.replace is atomic: a crash mid-write can never expose a
half-written file, because the rename either happened or it did not. it is
not durable. the rename can reach the directory entry while the contents are
still in the page cache, so power loss or an abrupt host termination can
leave a truncated or empty file where a complete one was expected.

closing that needs two flushes. fsync the contents before the rename, then
fsync the containing directory after it, otherwise the rename itself is the
thing that gets lost.
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


def fsync_directory(path: Path):
    """flush a directory entry so a rename inside it survives power loss.

    posix only. windows cannot open a directory, and some filesystems open
    one and then reject the fsync. durability of the rename is that
    platform's problem; it is not a reason to fail a write that has already
    landed.
    """
    try:
        fd = os.open(path, getattr(os, "O_DIRECTORY", os.O_RDONLY))
    except OSError:
        return
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)


def write_json_atomically(file_path: Path, data: Any, prefix: str):
    """replace file_path with data, atomically and durably.

    the temp file inherits mkstemp's 0600, so a credential store never
    exists on disk world-readable, not even briefly.
    """
    temp_fd, temp_path = tempfile.mkstemp(
        dir=file_path.parent, prefix=prefix, suffix=".tmp"
    )
    try:
        with open(temp_fd, "w") as f:
            json.dump(data, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        Path(temp_path).replace(file_path)
    except Exception:
        Path(temp_path).unlink(missing_ok=True)
        raise
    # after the replace: the rename is the thing being made durable
    fsync_directory(file_path.parent)
