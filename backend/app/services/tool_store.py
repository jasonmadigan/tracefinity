from __future__ import annotations

import json
import tempfile
import threading
from pathlib import Path
from typing import Optional

from app.models.schemas import Tool


class ToolStore:
    def __init__(self, storage_path: Path):
        self.file_path = storage_path / "tools.json"
        self._tools: dict[str, Tool] = {}
        self._lock = threading.Lock()
        self._load()

    def _load(self):
        if self.file_path.exists():
            try:
                data = json.loads(self.file_path.read_text())
                for tid, tdata in data.items():
                    self._tools[tid] = Tool.model_validate(tdata)
            except Exception:
                self._tools = {}

    def _save(self):
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
            self._tools[tool_id] = tool
            self._save()

    def delete(self, tool_id: str) -> Optional[Tool]:
        with self._lock:
            tool = self._tools.pop(tool_id, None)
            if tool:
                self._save()
            return tool

    def all(self) -> dict[str, Tool]:
        with self._lock:
            return self._tools.copy()
