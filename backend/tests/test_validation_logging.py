"""a 422 is invisible in the access log unless the detail is recorded."""

import logging

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client():
    return TestClient(app)


def test_validation_failure_logs_field_and_type(client, caplog):
    with caplog.at_level(logging.WARNING, logger="app.validation"):
        resp = client.put(
            "/api/bins/does-not-exist",
            json={"bin_config": {"wall_thickness": None}},
        )

    assert resp.status_code == 422
    logged = "\n".join(r.getMessage() for r in caplog.records)
    assert "422 PUT /api/bins/does-not-exist" in logged
    assert "wall_thickness" in logged
    assert "float_type" in logged


def test_validation_failure_logs_the_specific_rule(client, caplog):
    with caplog.at_level(logging.WARNING, logger="app.validation"):
        resp = client.put(
            "/api/bins/does-not-exist",
            json={"bin_config": {"grid_x": 25.5}},
        )

    assert resp.status_code == 422
    logged = "\n".join(r.getMessage() for r in caplog.records)
    assert "grid_x" in logged
    assert "grid size must not exceed 25 units per axis" in logged


def test_validation_log_does_not_record_the_value(client, caplog):
    # payloads carry user data, so the offending value must never be logged
    with caplog.at_level(logging.WARNING, logger="app.validation"):
        client.put(
            "/api/bins/does-not-exist",
            json={"name": {"secret": "do-not-log-me"}},
        )

    logged = "\n".join(r.getMessage() for r in caplog.records)
    assert "do-not-log-me" not in logged
    assert "name" in logged


def test_valid_payload_logs_nothing(client, caplog):
    with caplog.at_level(logging.WARNING, logger="app.validation"):
        resp = client.put("/api/bins/does-not-exist", json={"name": "fine"})

    assert resp.status_code != 422
    assert [r for r in caplog.records if r.name == "app.validation"] == []
