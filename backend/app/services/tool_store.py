from __future__ import annotations

import json
import logging
import tempfile
import threading
from pathlib import Path
from typing import Optional

from app.models.schemas import Tool
from app.services.store_errors import StoreClosedError

logger = logging.getLogger(__name__)


class ToolStore:
    def __init__(self, storage_path: Path):
        self.file_path = storage_path / "tools.json"
        self._tools: dict[str, Tool] = {}
        self._lock = threading.Lock()
        self._closed = False
        self._load()

    def _load(self):
        if self.file_path.exists():
            try:
                data = json.loads(self.file_path.read_text())
                for tid, tdata in data.items():
                    self._tools[tid] = Tool.model_validate(tdata)
            except OSError:
                logger.error(f"Failed to load {self.file_path}: permission denied")
                raise
            except Exception as e:
                logger.error(f"Failed to load {self.file_path}: {e}")
                self._tools = {}

    def close(self):
        """block further disk writes; called when the owning user is deleted"""
        with self._lock:
            self._closed = True

    def ensure_open(self):
        """raise StoreClosedError if the owning user has been deleted"""
        if self._closed:
            raise StoreClosedError(f"store closed, refusing write to {self.file_path}")

    def _save(self):
        # runs with self._lock held; refuse writes from references
        # captured before user deletion (issue #160)
        self.ensure_open()
        data = {tid: t.model_dump() for tid, t in self._tools.items()}
        temp_fd, temp_path = tempfile.mkstemp(
            dir=self.file_path.parent,
            prefix=".tools_",
            suffix=".tmp"
        )
        try:
            with open(temp_fd, 'w') as f:
                json.dump(data, f, indent=2)
            Path(temp_path).replace(self.file_path)
        except Exception:
            Path(temp_path).unlink(missing_ok=True)
            raise

    def get(self, tool_id: str) -> Optional[Tool]:
        with self._lock:
            return self._tools.get(tool_id)

    def set(self, tool_id: str, tool: Tool):
        with self._lock:
            # check before mutating so a refused write cannot leave a
            # phantom record in memory
            self.ensure_open()
            self._tools[tool_id] = tool
            self._save()

    def delete(self, tool_id: str) -> Optional[Tool]:
        with self._lock:
            self.ensure_open()
            tool = self._tools.pop(tool_id, None)
            if tool:
                self._save()
            return tool

    def all(self) -> dict[str, Tool]:
        with self._lock:
            return self._tools.copy()
