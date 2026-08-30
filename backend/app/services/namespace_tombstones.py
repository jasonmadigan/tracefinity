"""the rule for handing a storage namespace to a new owner.

a namespace is a directory of one party's files, and an account whose
storage namespace points at it can read and write all of them. so a claim is
refused whenever the directory already holds files, and allowed when it is
empty or absent, which is the ordinary case.

that turns on what is on the volume rather than on a marker, because the
states that produce an occupied but unowned namespace do not all leave one.
an account creation interrupted before its record landed leaves the
directory it made, and a storage volume restored without its users.json
leaves every namespace on it.

markers cover the state that no directory inspection can explain. deleting a
user destroys the identity that owns a namespace before it destroys the
files, so a failed rmtree, or a process killed between the two steps, leaves
files whose owner is gone. the marker is written before anything is
destroyed, and lives beside the namespace rather than inside it, so the
rmtree meant to clear it cannot remove the marker first and leave the files
behind. it outlives the process, so a claim-time check covers a kill between
the two steps that no in-request compensation can reach, and it distinguishes
files an operator may deliberately adopt from files whose owner this instance
already destroyed.
"""
from __future__ import annotations

import os
from pathlib import Path

from app.auth import valid_user_id
from app.config import settings

# a file, not a directory, so the instance storage-stats scan skips it
_MARKER_PREFIX = ".pending-deletion-"


class NamespaceNotClaimableError(RuntimeError):
    """the namespace holds files; handing it over would hand over the files"""


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
    there. anything else counts, at any depth and whatever its size: an empty
    or hidden file is still a record that somebody was here, and a namespace
    holding one is not the untouched directory it would otherwise look like.
    a symlink counts as content even when it points at a directory:
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


def claim(namespace: str, *, adopt_existing: bool = False):
    """let a new owner take this namespace, or refuse it.

    refuse when the directory holds files. a marker is not the condition,
    only the reason: an unmarked namespace full of files is someone's data
    just the same, and marking is the step an interrupted deletion is most
    likely to have reached, not the step it is likely to have missed.

    a marked namespace with no files left only records a deletion that
    finished without clearing its marker, so the marker goes and the claim
    proceeds. an operator resolves the refusal by removing the directory,
    which for a marked namespace is the deletion that was asked for.

    `adopt_existing` is for the callers whose purpose is to take over data
    already on the volume: first-run setup claiming pre-auth single-user
    data, and an import placing an account back on the storage it owned on a
    previous instance. it never overrides a marker, because those files'
    owner was destroyed here and no import means to inherit that.
    """
    marked = is_marked(namespace)
    if (marked or not adopt_existing) and holds_files(settings.storage_path / namespace):
        if marked:
            raise NamespaceNotClaimableError(
                f"storage namespace '{namespace}' still holds files from a deletion "
                "that did not finish; remove that directory from the storage volume "
                "before creating an account that would claim it"
            )
        raise NamespaceNotClaimableError(
            f"storage namespace '{namespace}' already holds files, and an account "
            "created here would take over data it does not own; use a different "
            "account id, or remove that directory from the storage volume, unless "
            "adopting those files is the intent"
        )
    if marked:
        clear(namespace)
