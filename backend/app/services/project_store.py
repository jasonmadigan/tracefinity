from __future__ import annotations

import json
import logging
import tempfile
import threading
from pathlib import Path
from typing import Optional

from app.models.schemas import BinProject
from app.services.store_errors import StoreClosedError

logger = logging.getLogger(__name__)


class ProjectStore:
    def __init__(self, storage_path: Path):
        self.file_path = storage_path / "bin-projects.json"
        self._projects: dict[str, BinProject] = {}
        self._lock = threading.Lock()
        self._closed = False
        self._load()

    def _load(self):
        if self.file_path.exists():
            try:
                data = json.loads(self.file_path.read_text())
                for pid, pdata in data.items():
                    self._projects[pid] = BinProject.model_validate(pdata)
            except OSError:
                logger.error(f"Failed to load {self.file_path}: permission denied")
                raise
            except Exception as e:
                logger.error(f"Failed to load {self.file_path}: {e}")
                self._projects = {}

    def close(self):
        """block further disk writes and drop cached data; called when the
        owning user is deleted so captured references cannot read stale data"""
        with self._lock:
            self._closed = True
            self._projects = {}

    def ensure_open(self):
        """raise StoreClosedError if the owning user has been deleted"""
        if self._closed:
            raise StoreClosedError(f"store closed, refusing write to {self.file_path}")

    def _save(self):
        # runs with self._lock held; refuse writes from references
        # captured before user deletion (issue #160)
        self.ensure_open()
        data = {pid: p.model_dump() for pid, p in self._projects.items()}
        temp_fd, temp_path = tempfile.mkstemp(
            dir=self.file_path.parent,
            prefix=".bin-projects_",
            suffix=".tmp",
        )
        try:
            with open(temp_fd, "w") as f:
                json.dump(data, f, indent=2)
            Path(temp_path).replace(self.file_path)
        except Exception:
            Path(temp_path).unlink(missing_ok=True)
            raise

    def get(self, project_id: str) -> Optional[BinProject]:
        with self._lock:
            return self._projects.get(project_id)

    def set(self, project_id: str, project: BinProject):
        with self._lock:
            # check before mutating so a refused write cannot leave a
            # phantom record in memory
            self.ensure_open()
            self._projects[project_id] = project
            self._save()

    def delete(self, project_id: str) -> Optional[BinProject]:
        with self._lock:
            self.ensure_open()
            project = self._projects.pop(project_id, None)
            if project:
                self._save()
            return project

    def all(self) -> dict[str, BinProject]:
        with self._lock:
            return self._projects.copy()
