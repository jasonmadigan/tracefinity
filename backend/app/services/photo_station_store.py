from __future__ import annotations

import json
import logging
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.models.schemas import PhotoStation
from app.services.store_errors import StoreClosedError

logger = logging.getLogger(__name__)


class PhotoStationStore:
    def __init__(self, storage_path: Path):
        self.file_path = storage_path / "photo-stations.json"
        self._stations: dict[str, PhotoStation] = {}
        self._lock = threading.Lock()
        self._closed = False
        self._load()

    def close(self):
        """Block further writes and discard cached data after user deletion."""
        with self._lock:
            self._closed = True
            self._stations = {}

    def ensure_open(self):
        if self._closed:
            raise StoreClosedError(f"store closed, refusing write to {self.file_path}")

    def _load(self):
        if self.file_path.exists():
            try:
                data = json.loads(self.file_path.read_text())
                for sid, sdata in data.items():
                    self._stations[sid] = PhotoStation.model_validate(sdata)
            except OSError:
                logger.error(f"Failed to load {self.file_path}: permission denied")
                raise
            except Exception as e:
                corrupt_path = self._corrupt_path()
                logger.error(f"Failed to load {self.file_path}: {e}; moving to {corrupt_path}")
                self.file_path.replace(corrupt_path)
                self._stations = {}

    def _corrupt_path(self) -> Path:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
        return self.file_path.with_name(f"{self.file_path.stem}.corrupt-{stamp}{self.file_path.suffix}")

    def _save(self):
        self.ensure_open()
        data = {sid: s.model_dump() for sid, s in self._stations.items()}
        temp_fd, temp_path = tempfile.mkstemp(
            dir=self.file_path.parent,
            prefix=".photo-stations_",
            suffix=".tmp",
        )
        try:
            with open(temp_fd, "w") as f:
                json.dump(data, f, indent=2)
            Path(temp_path).replace(self.file_path)
        except Exception:
            Path(temp_path).unlink(missing_ok=True)
            raise

    def get(self, station_id: str) -> Optional[PhotoStation]:
        with self._lock:
            return self._stations.get(station_id)

    def set(self, station_id: str, station: PhotoStation):
        with self._lock:
            self.ensure_open()
            self._stations[station_id] = station
            self._save()

    def delete(self, station_id: str) -> Optional[PhotoStation]:
        with self._lock:
            self.ensure_open()
            station = self._stations.pop(station_id, None)
            if station:
                self._save()
            return station

    def all(self) -> dict[str, PhotoStation]:
        with self._lock:
            return self._stations.copy()
