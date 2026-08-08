import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api import routes
from app.config import Settings
from app.models.schemas import GenerateRequest


class _OpenStore:
    def ensure_open(self):
        pass


def test_stl_generation_concurrency_defaults_to_unlimited(monkeypatch):
    monkeypatch.delenv("STL_GENERATION_CONCURRENCY", raising=False)
    assert Settings(_env_file=None).stl_generation_concurrency is None


def test_stl_generation_concurrency_reads_positive_env_value(monkeypatch):
    monkeypatch.setenv("STL_GENERATION_CONCURRENCY", "2")
    assert Settings(_env_file=None).stl_generation_concurrency == 2


@pytest.mark.parametrize("value", ["0", "-1"])
def test_stl_generation_concurrency_rejects_non_positive_values(monkeypatch, value):
    monkeypatch.setenv("STL_GENERATION_CONCURRENCY", value)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_generation_jobs_wait_for_a_concurrency_slot(monkeypatch, tmp_path):
    (tmp_path / "outputs").mkdir()
    monkeypatch.setattr(routes, "_stl_generation_semaphore", threading.BoundedSemaphore(1))

    first_entered = threading.Event()
    release_first = threading.Event()
    second_entered = threading.Event()
    call_count = 0
    call_lock = threading.Lock()

    def fake_generate(*args):
        nonlocal call_count
        with call_lock:
            call_count += 1
            current_call = call_count
        if current_call == 1:
            first_entered.set()
            assert release_first.wait(timeout=2)
        else:
            second_entered.set()
        return current_call

    monkeypatch.setattr(routes, "_generate_uncached", fake_generate)
    request = GenerateRequest()

    def run(entity_id):
        return routes._run_generate(
            [], request, entity_id, tmp_path, entity_id, "default", _OpenStore()
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(run, "first")
        assert first_entered.wait(timeout=2)
        second = executor.submit(run, "second")
        assert not second_entered.wait(timeout=0.1)
        release_first.set()
        assert first.result(timeout=2) == 1
        assert second.result(timeout=2) == 2
        assert second_entered.is_set()


def test_unlimited_generation_jobs_run_concurrently(monkeypatch, tmp_path):
    (tmp_path / "outputs").mkdir()
    monkeypatch.setattr(routes, "_stl_generation_semaphore", None)
    both_entered = threading.Barrier(2, timeout=2)

    def fake_generate(*args):
        both_entered.wait()
        return "generated"

    monkeypatch.setattr(routes, "_generate_uncached", fake_generate)
    request = GenerateRequest()

    def run(entity_id):
        return routes._run_generate(
            [], request, entity_id, tmp_path, entity_id, "default", _OpenStore()
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = [executor.submit(run, entity_id) for entity_id in ("first", "second")]
        assert [result.result(timeout=2) for result in results] == ["generated", "generated"]


def test_cached_request_bypasses_saturated_queue(monkeypatch, tmp_path):
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    (outputs / "cached.stl").write_bytes(b"stl")
    (outputs / "cached.hash").write_text("same")

    class QueueMustNotBeUsed:
        def acquire(self, **kwargs):
            raise AssertionError("cached request entered the queue")

    monkeypatch.setattr(routes, "_stl_generation_semaphore", QueueMustNotBeUsed())
    response = routes._run_generate(
        [], GenerateRequest(), "cached", tmp_path, "same", "default", _OpenStore()
    )

    assert response.stl_url.endswith("/cached.stl")


def test_request_uses_cache_populated_while_waiting(monkeypatch, tmp_path):
    outputs = tmp_path / "outputs"
    outputs.mkdir()

    class CachePopulatingQueue:
        def acquire(self, **kwargs):
            (outputs / "queued.stl").write_bytes(b"stl")
            (outputs / "queued.hash").write_text("same")
            return True

        def release(self):
            pass

    monkeypatch.setattr(routes, "_stl_generation_semaphore", CachePopulatingQueue())
    monkeypatch.setattr(
        routes,
        "_generate_uncached",
        lambda *args: pytest.fail("cache should prevent duplicate generation"),
    )

    response = routes._run_generate(
        [], GenerateRequest(), "queued", tmp_path, "same", "default", _OpenStore()
    )
    assert response.stl_url.endswith("/queued.stl")


def test_saturated_queue_returns_busy_response(monkeypatch, tmp_path):
    (tmp_path / "outputs").mkdir()

    class SaturatedQueue:
        def acquire(self, *, timeout):
            assert timeout == routes.STL_GENERATION_QUEUE_TIMEOUT_SECONDS
            return False

    monkeypatch.setattr(routes, "_stl_generation_semaphore", SaturatedQueue())

    with pytest.raises(HTTPException) as exc_info:
        routes._run_generate(
            [], GenerateRequest(), "busy", tmp_path, "hash", "default", _OpenStore()
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.headers == {"Retry-After": "5"}


def test_uncached_generation_writes_output_and_hash(monkeypatch, tmp_path):
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    monkeypatch.setattr(routes, "_stl_generation_semaphore", None)

    class FakeGenerator:
        def generate_bin(self, scaled, request, output_path, threemf_path):
            assert scaled == []
            assert request == GenerateRequest()
            assert threemf_path.endswith("generated.3mf")
            Path(output_path).write_bytes(b"stl")
            return object(), None

        def export_split_parts(self, *args):
            return []

    monkeypatch.setattr(routes, "stl_generator", FakeGenerator())

    response = routes._run_generate(
        [], GenerateRequest(), "generated", tmp_path, "input-hash", "default", _OpenStore()
    )

    assert response.stl_url.endswith("/generated.stl")
    assert (outputs / "generated.stl").read_bytes() == b"stl"
    assert (outputs / "generated.hash").read_text() == "input-hash"
