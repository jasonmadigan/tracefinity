"""tests for store _load() error handling.

validates that stores don't silently cache empty data when the underlying
file exists but can't be read (e.g. PermissionError from UID mismatch).
"""

import json
import logging
import os
import stat

import pytest

from app.services.bin_store import BinStore
from app.services.project_store import ProjectStore
from app.services.session_store import SessionStore
from app.services.tool_store import ToolStore

# -- helpers --

def _write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))


def _make_unreadable(path):
    os.chmod(path, 0o000)


def _restore_readable(path):
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)


# -- PermissionError: store must not cache empty dict --

@pytest.fixture(params=[
    ("tools.json", ToolStore),
    ("bins.json", BinStore),
    ("sessions.json", SessionStore),
    ("bin-projects.json", ProjectStore),
])
def store_spec(request, tmp_path):
    filename, store_cls = request.param
    return filename, store_cls, tmp_path


class TestPermissionError:
    def test_unreadable_file_raises_not_caches_empty(self, store_spec):
        filename, store_cls, tmp_path = store_spec
        file_path = tmp_path / filename
        _write_json(file_path, {"item-1": _seed_data(store_cls)})
        _make_unreadable(file_path)

        try:
            with pytest.raises(PermissionError):
                store_cls(tmp_path)
        finally:
            _restore_readable(file_path)

    def test_unreadable_file_logs_error(self, store_spec, caplog):
        filename, store_cls, tmp_path = store_spec
        file_path = tmp_path / filename
        _write_json(file_path, {"item-1": _seed_data(store_cls)})
        _make_unreadable(file_path)

        try:
            with pytest.raises(PermissionError):
                with caplog.at_level(logging.ERROR):
                    store_cls(tmp_path)

            assert any("Failed to load" in r.message for r in caplog.records)
        finally:
            _restore_readable(file_path)


# -- corrupt JSON: log and use empty dict (data is gone anyway) --

class TestCorruptJson:
    def test_corrupt_json_loads_empty(self, store_spec):
        filename, store_cls, tmp_path = store_spec
        file_path = tmp_path / filename
        file_path.write_text("{invalid json!!!")

        store = store_cls(tmp_path)
        assert store.all() == {}

    def test_corrupt_json_logs_error(self, store_spec, caplog):
        filename, store_cls, tmp_path = store_spec
        file_path = tmp_path / filename
        file_path.write_text("{invalid json!!!")

        with caplog.at_level(logging.ERROR):
            store_cls(tmp_path)

        assert any("Failed to load" in r.message for r in caplog.records)


# -- normal operation still works --

class TestNormalLoad:
    def test_missing_file_loads_empty(self, store_spec):
        _, store_cls, tmp_path = store_spec
        store = store_cls(tmp_path)
        assert store.all() == {}

    def test_valid_file_loads_data(self, store_spec):
        filename, store_cls, tmp_path = store_spec
        file_path = tmp_path / filename
        _write_json(file_path, {"item-1": _seed_data(store_cls)})

        store = store_cls(tmp_path)
        assert len(store.all()) == 1


# -- seed data per store type --

def _seed_data(store_cls):
    """minimal valid record for each store type."""
    from app.models.schemas import BinModel, BinProject, Session, Tool

    if store_cls is ToolStore:
        return Tool(id="item-1", name="test", points=[{"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 1, "y": 1}]).model_dump()
    elif store_cls is BinStore:
        return BinModel(id="item-1").model_dump()
    elif store_cls is SessionStore:
        return Session(id="item-1").model_dump()
    elif store_cls is ProjectStore:
        return BinProject(id="item-1", name="test").model_dump()
