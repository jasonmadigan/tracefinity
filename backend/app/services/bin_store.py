from __future__ import annotations

import json
import tempfile
import threading
from pathlib import Path
from typing import Optional

from app.models.schemas import BinModel


class BinStore:
    def __init__(self, storage_path: Path):
        self.file_path = storage_path / "bins.json"
        self._bins: dict[str, BinModel] = {}
        self._lock = threading.Lock()
        self._load()

    def _load(self):
        if self.file_path.exists():
            try:
                data = json.loads(self.file_path.read_text())
                for bid, bdata in data.items():
                    self._bins[bid] = BinModel.model_validate(bdata)
            except Exception:
                self._bins = {}

    def _save(self):
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
