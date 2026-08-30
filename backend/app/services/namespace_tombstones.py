"""markers for storage namespaces whose deletion did not finish.

deleting a user destroys the identity that owns a namespace before it
destroys the files, so a failed rmtree, or a process killed between the two
steps, leaves a directory with no owner. that namespace is then claimable:
`default` by the next first-run administrator, and an account id by an admin
create that supplies the same id. either way a new owner inherits the
previous owner's files.

the marker is written before anything is destroyed, and lives beside the
namespace rather than inside it, so the rmtree meant to clear it cannot
remove the marker first and leave the files behind. it outlives the process,
so a claim-time check covers a kill between the two steps that no in-request
compensation can reach.
"""
from __future__ import annotations

import os
from pathlib import Path

from app.auth import valid_user_id
from app.config import settings

# a file, not a directory, so the instance storage-stats scan skips it
_MARKER_PREFIX = ".pending-deletion-"


class NamespaceDeletionPendingError(RuntimeError):
    """files outlived their owner; the namespace must not be handed to anyone"""


def _marker_path(namespace: str) -> Path:
    # the namespace becomes part of a filename at the storage root, so hold it
    # to the same format contract that lets it be a directory name at all
    if namespace != "default" and not valid_user_id(namespace):
        raise ValueError(f"unsupported storage namespace: {namespace!r}")
    return settings.storage_path / f"{_MARKER_PREFIX}{namespace}"


def mark(namespace: str):
    """record that this namespace's deletion has started"""
    path = _marker_path(namespace)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch()


def clear(namespace: str):
    _marker_path(namespace).unlink(missing_ok=True)


def is_marked(namespace: str) -> bool:
    return _marker_path(namespace).exists()


def holds_files(path: Path) -> bool:
    """true when the namespace holds anything but empty directories.

    a partial rmtree, or a later request recreating the empty scaffolding,
    leaves directories with nothing in them, and there is nothing to inherit
    there. a symlink counts as content even when it points at a directory:
    following it would report on a tree that is not this namespace's, and
    handing the link to a new owner hands them whatever it points at. so
    does anything that cannot be inspected, because an unreadable directory
    could hold anything.
    """
    stack = [path]
    while stack:
        current = stack.pop()
        try:
            with os.scandir(current) as entries:
                for entry in entries:
                    if entry.is_dir(follow_symlinks=False):
                        stack.append(Path(entry.path))
                    else:
                        return True
        except FileNotFoundError:
            continue
        except OSError:
            # a directory that cannot be read may hold anything, and the
            # rmtree that could not remove it very likely failed for the
            # same reason. count it as content rather than guess
            return True
    return False


def claim(namespace: str):
    """let a new owner take this namespace, or refuse it.

    a marked namespace with no files left only records a deletion that
    finished without clearing its marker, so the marker goes and the claim
    proceeds. one that still holds files outlived its owner: refuse rather
    than hand a new account someone else's data. an operator resolves it by
    removing the directory, which is the deletion that was asked for.
    """
    if not is_marked(namespace):
        return
    if holds_files(settings.storage_path / namespace):
        raise NamespaceDeletionPendingError(
            f"storage namespace '{namespace}' still holds files from a deletion "
            "that did not finish; remove that directory from the storage volume "
            "before creating an account that would claim it"
        )
    clear(namespace)
