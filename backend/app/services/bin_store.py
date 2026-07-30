from __future__ import annotations

import json
import logging
import tempfile
import threading
from pathlib import Path
from typing import Optional

from app.models.schemas import BinModel

logger = logging.getLogger(__name__)


class BinStore:
    def __init__(self, storage_path: Path):
        self.file_path = storage_path / "bins.json"
        self._bins: dict[str, BinModel] = {}
        self._lock = threading.Lock()
        self._closed = False
        self._load()

    def _load(self):
        if self.file_path.exists():
            try:
                data = json.loads(self.file_path.read_text())
                for bid, bdata in data.items():
                    self._bins[bid] = BinModel.model_validate(bdata)
            except OSError:
                logger.error(f"Failed to load {self.file_path}: permission denied")
                raise
            except Exception as e:
                logger.error(f"Failed to load {self.file_path}: {e}")
                self._bins = {}

    def close(self):
        """block further disk writes; called when the owning user is deleted"""
        with self._lock:
            self._closed = True

    def _save(self):
        # runs with self._lock held; refuse writes from references
        # captured before user deletion (issue #160)
        if self._closed:
            raise RuntimeError(f"store closed, refusing write to {self.file_path}")
        data = {bid: b.model_dump() for bid, b in self._bins.items()}
        temp_fd, temp_path = tempfile.mkstemp(
            dir=self.file_path.parent,
            prefix=".bins_",
            suffix=".tmp"
        )
        try:
            with open(temp_fd, 'w') as f:
                json.dump(data, f, indent=2)
            Path(temp_path).replace(self.file_path)
        except Exception:
            Path(temp_path).unlink(missing_ok=True)
            raise

    def get(self, bin_id: str) -> Optional[BinModel]:
        with self._lock:
            return self._bins.get(bin_id)

    def set(self, bin_id: str, bin_data: BinModel):
        with self._lock:
            self._bins[bin_id] = bin_data
            self._save()

    def delete(self, bin_id: str) -> Optional[BinModel]:
        with self._lock:
            bin_data = self._bins.pop(bin_id, None)
            if bin_data:
                self._save()
            return bin_data

    def all(self) -> dict[str, BinModel]:
        with self._lock:
            return self._bins.copy()
