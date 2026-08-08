import app.api.routes as routes


def test_storage_stats_snapshot_caches_for_one_minute(tmp_path, monkeypatch):
    user = tmp_path / "user-1"
    user.mkdir()
    (user / "first.bin").write_bytes(b"1234")

    now = [100.0]
    monkeypatch.setattr(routes.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(routes, "_storage_stats_cache", None)

    first = routes._storage_stats_snapshot(tmp_path)
    assert first == {
        "totalBytes": 4,
        "users": [{"userId": "user-1", "bytes": 4}],
    }

    (user / "second.bin").write_bytes(b"56789")
    assert routes._storage_stats_snapshot(tmp_path) is first

    now[0] += routes.STORAGE_STATS_TTL_SECONDS + 1
    refreshed = routes._storage_stats_snapshot(tmp_path)
    assert refreshed == {
        "totalBytes": 9,
        "users": [{"userId": "user-1", "bytes": 9}],
    }
