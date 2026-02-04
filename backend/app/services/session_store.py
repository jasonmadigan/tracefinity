from __future__ import annotations

import json
import tempfile
import threading
from pathlib import Path
from typing import Optional

from app.models.schemas import Session


class SessionStore:
    def __init__(self, storage_path: Path):
        self.file_path = storage_path / "sessions.json"
        self._sessions: dict[str, Session] = {}
        self._lock = threading.Lock()
        self._load()

    def _load(self):
        if self.file_path.exists():
            try:
                data = json.loads(self.file_path.read_text())
                for sid, sdata in data.items():
                    self._sessions[sid] = Session.model_validate(sdata)
            except Exception:
                self._sessions = {}

    def _save(self):
        # atomic write: write to temp file then rename
        data = {sid: s.model_dump() for sid, s in self._sessions.items()}
        temp_fd, temp_path = tempfile.mkstemp(
            dir=self.file_path.parent,
            prefix=".sessions_",
            suffix=".tmp"
        )
        try:
            with open(temp_fd, 'w') as f:
                json.dump(data, f, indent=2)
            Path(temp_path).replace(self.file_path)
        except Exception:
            Path(temp_path).unlink(missing_ok=True)
            raise

    def get(self, session_id: str) -> Optional[Session]:
        with self._lock:
            return self._sessions.get(session_id)

    def set(self, session_id: str, session: Session):
        with self._lock:
            self._sessions[session_id] = session
            self._save()

    def delete(self, session_id: str) -> Optional[Session]:
        with self._lock:
            session = self._sessions.pop(session_id, None)
            if session:
                self._save()
            return session

    def all(self) -> dict[str, Session]:
        with self._lock:
            return self._sessions.copy()
