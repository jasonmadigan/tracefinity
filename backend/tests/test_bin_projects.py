import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

import app.api.routes as routes
from app.config import ensure_user_dirs, settings
from app.main import app
from app.models.schemas import (
    BinConfig,
    BinModel,
    BinProject,
    BinProjectBinsRequest,
    BinProjectCreateBinRequest,
    BinProjectCreateRequest,
    BinProjectToolsRequest,
    BinProjectUpdateRequest,
    PlacedTool,
    ProjectBinPlacement,
    ProjectSketch,
    Tool,
)
from app.services.bin_store import BinStore
from app.services.project_service import project_health, project_status, repair_project_links
from app.services.project_store import ProjectStore
from app.services.tool_store import ToolStore


def test_old_project_records_get_defaults():
    project = BinProject.model_validate({
        "id": "project-1",
        "name": "Top drawer",
    })

    assert project.description is None
    assert project.tool_ids == []
    assert project.bin_ids == []
    assert project.status == "active"
    assert project.sketches == []
    assert project.default_bin_config is None
    assert project.notes is None


def test_project_metadata_round_trips():
    project = BinProject.model_validate({
        "id": "project-1",
        "name": "Top drawer",
        "description": "Metric tools",
        "status": "ready_to_print",
        "tool_ids": ["tool-1", "tool-2"],
        "bin_ids": ["bin-1"],
        "sketches": [{"id": "sketch-1", "name": "Top drawer", "target_grid_x": 4, "target_grid_y": 5}],
        "default_bin_config": {"grid_x": 3, "grid_y": 2},
        "notes": "print first bin as test",
        "created_at": "2026-05-10T00:00:00",
        "updated_at": "2026-05-10T00:00:01",
    })
    data = project.model_dump()

    assert data["tool_ids"] == ["tool-1", "tool-2"]
    assert data["bin_ids"] == ["bin-1"]
    assert data["status"] == "ready_to_print"
    assert data["sketches"][0]["target_grid_x"] == 4
    assert data["sketches"][0]["name"] == "Top drawer"
    assert data["default_bin_config"]["grid_x"] == 3
    assert data["notes"] == "print first bin as test"


def test_project_requests_support_clearable_fields():
    create_req = BinProjectCreateRequest(
        name="Top drawer",
        tool_ids=["tool-1"],
        default_bin_config=BinConfig(grid_x=4, grid_y=3, magnet_diameter=6.2, bed_size=220),
    )
    update_req = BinProjectUpdateRequest(description=None, notes=None)
    tools_req = BinProjectToolsRequest(tool_ids=["tool-1", "tool-2"])
    bins_req = BinProjectBinsRequest(bin_ids=["bin-1"], import_tools=True)
    bin_req = BinProjectCreateBinRequest(
        name="Top drawer bin",
        tool_ids=["tool-1"],
        bin_config=BinConfig(magnet_diameter=6.4, bed_size=210),
    )

    assert create_req.tool_ids == ["tool-1"]
    assert create_req.default_bin_config.grid_x == 4
    assert create_req.default_bin_config.magnet_diameter == 6.2
    assert create_req.default_bin_config.bed_size == 220
    assert "description" in update_req.model_fields_set
    assert "notes" in update_req.model_fields_set
    assert tools_req.tool_ids == ["tool-1", "tool-2"]
    assert bins_req.import_tools is True
    assert bin_req.tool_ids == ["tool-1"]
    assert bin_req.bin_config.magnet_diameter == 6.4


def test_project_store_round_trips(tmp_path):
    store = ProjectStore(tmp_path)
    project = BinProject(id="project-1", name="Top drawer", tool_ids=["tool-1"])

    store.set(project.id, project)
    reloaded = ProjectStore(tmp_path)

    assert reloaded.get("project-1").name == "Top drawer"
    assert reloaded.get("project-1").tool_ids == ["tool-1"]


def test_project_store_delete_keeps_other_projects(tmp_path):
    store = ProjectStore(tmp_path)
    store.set("project-1", BinProject(id="project-1", name="Top drawer"))
    store.set("project-2", BinProject(id="project-2", name="Bottom drawer"))

    deleted = store.delete("project-1")

    assert deleted.name == "Top drawer"
    assert store.get("project-1") is None
    assert store.get("project-2").name == "Bottom drawer"


def test_project_status_tracks_placed_and_unplaced():
    project = BinProject(id="project-1", name="Top drawer", tool_ids=["tool-1", "tool-2", "tool-3"])
    linked_bins = [
        BinModel(
            id="bin-1",
            placed_tools=[
                PlacedTool(id="pt-1", tool_id="tool-1", name="Tool 1", points=[]),
                PlacedTool(id="pt-2", tool_id="tool-2", name="Tool 2", points=[]),
            ],
        ),
        BinModel(
            id="bin-2",
            placed_tools=[
                PlacedTool(id="pt-3", tool_id="tool-2", name="Tool 2 duplicate", points=[]),
                PlacedTool(id="pt-4", tool_id="other-tool", name="Other", points=[]),
            ],
        ),
    ]

    status = project_status(project, linked_bins)

    assert status["placed_tool_ids"] == ["tool-1", "tool-2"]
    assert status["unplaced_tool_ids"] == ["tool-3"]


def _tool(tool_id: str, project_ids: list[str] | None = None) -> Tool:
    return Tool(
        id=tool_id,
        name=tool_id,
        points=[
            {"x": 0, "y": 0},
            {"x": 10, "y": 0},
            {"x": 10, "y": 10},
        ],
        project_ids=project_ids or [],
    )


def _api_client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "storage_path", tmp_path)
    monkeypatch.setattr(routes.settings, "storage_path", tmp_path)
    routes._store_cache.clear()
    routes._project_store_cache.clear()
    ensure_user_dirs(tmp_path / "default")
    return TestClient(app)


def _seed_tool(tool_id: str):
    _, tool_store, _ = routes.get_stores("default")
    tool_store.set(tool_id, _tool(tool_id))


def test_project_create_bin_derives_placed_status_without_persisting_state(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    _seed_tool("tool-1")

    project_resp = client.post("/api/bin-projects", json={"name": "Top drawer", "tool_ids": ["tool-1"]})
    assert project_resp.status_code == 200
    project_id = project_resp.json()["id"]

    bin_resp = client.post(f"/api/bin-projects/{project_id}/create-bin", json={"tool_ids": ["tool-1"]})
    assert bin_resp.status_code == 200

    detail = client.get(f"/api/bin-projects/{project_id}").json()

    assert detail["placed_tool_ids"] == ["tool-1"]
    assert detail["unplaced_tool_ids"] == []


def test_project_placed_status_updates_when_bin_contents_change(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    _seed_tool("tool-1")

    project = client.post("/api/bin-projects", json={"name": "Top drawer", "tool_ids": ["tool-1"]}).json()
    bin_data = client.post("/api/bins", json={"name": "Working bin", "project_id": project["id"], "tool_ids": ["tool-1"]}).json()

    assert client.get(f"/api/bin-projects/{project['id']}").json()["placed_tool_ids"] == ["tool-1"]

    update_resp = client.put(f"/api/bins/{bin_data['id']}", json={"placed_tools": []})
    assert update_resp.status_code == 200
    detail = client.get(f"/api/bin-projects/{project['id']}").json()

    assert detail["placed_tool_ids"] == []
    assert detail["unplaced_tool_ids"] == ["tool-1"]


def test_project_update_round_trips_default_bin_config(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    project = client.post("/api/bin-projects", json={"name": "Top drawer"}).json()

    update_resp = client.patch(f"/api/bin-projects/{project['id']}", json={
        "default_bin_config": {
            "magnet_diameter": 6.2,
            "magnet_depth": 2.8,
            "magnet_corners_only": True,
            "bed_size": 220,
        },
    })

    assert update_resp.status_code == 200
    updated_config = update_resp.json()["default_bin_config"]
    assert updated_config["magnet_diameter"] == 6.2
    assert updated_config["magnet_depth"] == 2.8
    assert updated_config["magnet_corners_only"] is True
    assert updated_config["bed_size"] == 220
    detail_config = client.get(f"/api/bin-projects/{project['id']}").json()["default_bin_config"]
    assert detail_config == updated_config

    clear_resp = client.patch(f"/api/bin-projects/{project['id']}", json={"default_bin_config": None})

    assert clear_resp.status_code == 200
    assert clear_resp.json()["default_bin_config"] is None


def test_create_bin_accepts_default_bin_config(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)

    resp = client.post("/api/bins", json={
        "name": "Magnet test",
        "bin_config": {
            "magnet_diameter": 6.2,
            "magnet_depth": 2.8,
            "magnet_corners_only": True,
            "bed_size": 220,
        },
    })

    assert resp.status_code == 200
    bin_config = resp.json()["bin_config"]
    assert bin_config["magnet_diameter"] == 6.2
    assert bin_config["magnet_depth"] == 2.8
    assert bin_config["magnet_corners_only"] is True
    assert bin_config["bed_size"] == 220


def test_project_create_bin_uses_request_config_before_project_default(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    _seed_tool("tool-1")

    project = client.post("/api/bin-projects", json={
        "name": "Top drawer",
        "tool_ids": ["tool-1"],
        "default_bin_config": {"magnet_diameter": 6.2, "bed_size": 220},
    }).json()

    project_default_resp = client.post(
        f"/api/bin-projects/{project['id']}/create-bin",
        json={"tool_ids": ["tool-1"]},
    )
    override_resp = client.post(
        f"/api/bin-projects/{project['id']}/create-bin",
        json={
            "name": "Override bin",
            "tool_ids": ["tool-1"],
            "bin_config": {"magnet_diameter": 6.4, "bed_size": 210},
        },
    )

    assert project_default_resp.status_code == 200
    assert project_default_resp.json()["bin_config"]["magnet_diameter"] == 6.2
    assert project_default_resp.json()["bin_config"]["bed_size"] == 220
    assert override_resp.status_code == 200
    assert override_resp.json()["bin_config"]["magnet_diameter"] == 6.4
    assert override_resp.json()["bin_config"]["bed_size"] == 210


def test_project_health_reports_and_repairs_safe_link_mismatches(tmp_path):
    project_store = ProjectStore(tmp_path)
    tool_store = ToolStore(tmp_path)
    bin_store = BinStore(tmp_path)

    tool_store.set("tool-1", _tool("tool-1"))
    tool_store.set("tool-extra", _tool("tool-extra", ["project-1"]))
    bin_store.set("bin-1", BinModel(id="bin-1", project_id=None))
    bin_store.set("bin-2", BinModel(id="bin-2", project_id="project-1"))
    project = BinProject(
        id="project-1",
        name="Top drawer",
        tool_ids=["tool-1", "missing-tool"],
        bin_ids=["bin-1", "missing-bin"],
    )
    project_store.set(project.id, project)

    issues = project_health(project, tool_store, bin_store)

    assert {issue.code for issue in issues} >= {
        "missing_tool",
        "missing_bin",
        "tool_missing_project_id",
        "tool_extra_project_id",
        "bin_missing_project_id",
    }

    repaired = repair_project_links(project_store, project, tool_store, bin_store)

    assert repaired.tool_ids == ["tool-1"]
    assert "missing-bin" not in repaired.bin_ids
    assert "bin-2" in repaired.bin_ids
    assert tool_store.get("tool-1").project_ids == ["project-1"]
    assert tool_store.get("tool-extra").project_ids == []
    assert bin_store.get("bin-1").project_id == "project-1"


def test_project_health_reports_outside_bin_tools():
    project = BinProject(id="project-1", name="Top drawer", tool_ids=["tool-1"], bin_ids=["bin-1"])
    class ToolStoreStub:
        def all(self):
            return {"tool-1": _tool("tool-1", ["project-1"]), "tool-2": _tool("tool-2")}
    class BinStoreStub:
        def all(self):
            return {
                "bin-1": BinModel(
                    id="bin-1",
                    project_id="project-1",
                    placed_tools=[PlacedTool(id="pt-1", tool_id="tool-2", name="Tool 2", points=[])],
                )
            }

    issues = project_health(project, ToolStoreStub(), BinStoreStub())

    assert any(issue.code == "outside_tool" and not issue.repairable for issue in issues)


def test_project_bin_placement_validates_grid_offsets():
    placement = ProjectBinPlacement(bin_id="bin-1", x=2.5, y=0, rotation=270)

    assert placement.x == 2.5
    assert placement.rotation == 270
    assert placement.id
    with pytest.raises(ValidationError):
        ProjectBinPlacement(bin_id="bin-1", x=0.3)
    with pytest.raises(ValidationError):
        ProjectBinPlacement(bin_id="bin-1", x=-1)
    with pytest.raises(ValidationError):
        ProjectBinPlacement(bin_id="bin-1", rotation=45)


def test_project_bin_placement_validates_colour():
    assert ProjectBinPlacement(bin_id="bin-1", color="#A1B2C3").color == "#a1b2c3"
    assert ProjectBinPlacement(bin_id="bin-1").color is None
    with pytest.raises(ValidationError):
        ProjectBinPlacement(bin_id="bin-1", color="red")
    with pytest.raises(ValidationError):
        ProjectBinPlacement(bin_id="bin-1", color="#abc")


def test_project_bin_placements_get_distinct_ids():
    first = ProjectBinPlacement(bin_id="bin-1")
    second = ProjectBinPlacement(bin_id="bin-1")

    assert first.id != second.id


def test_sketch_target_grid_covers_drawer_sized_grids():
    sketch = ProjectSketch(target_grid_x=12, target_grid_y=7.5)

    assert sketch.target_grid_x == 12
    assert sketch.target_grid_y == 7.5
    assert sketch.name == "Drawer plan"
    with pytest.raises(ValidationError):
        ProjectSketch(target_grid_x=41)


def test_legacy_project_layout_becomes_a_sketch():
    project = BinProject.model_validate({
        "id": "project-1",
        "name": "Top drawer",
        "target_grid_x": 6,
        "target_grid_y": 4,
        "bin_layout": [{"id": "p1", "bin_id": "bin-1", "x": 1, "y": 0, "rotation": 90}],
        "created_at": "2026-05-10T00:00:00",
    })

    assert len(project.sketches) == 1
    sketch = project.sketches[0]
    assert sketch.name == "Drawer plan"
    assert sketch.target_grid_x == 6
    assert sketch.target_grid_y == 4
    assert [p.bin_id for p in sketch.bin_layout] == ["bin-1"]
    assert sketch.id
    assert "target_grid_x" not in project.model_dump()


def test_project_without_legacy_layout_stays_empty():
    project = BinProject.model_validate({"id": "project-1", "name": "Top drawer", "bin_layout": []})

    assert project.sketches == []


def test_sketch_layout_round_trips_through_patch(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    project = client.post("/api/bin-projects", json={"name": "Top drawer"}).json()
    bin_data = client.post("/api/bins", json={"name": "Bin A", "project_id": project["id"]}).json()
    sketch = client.post(f"/api/bin-projects/{project['id']}/sketches", json={"name": "Top"}).json()

    resp = client.patch(f"/api/bin-projects/{project['id']}/sketches/{sketch['id']}", json={
        "target_grid_x": 6,
        "target_grid_y": 4,
        "bin_layout": [
            {"id": "placement-1", "bin_id": bin_data["id"], "x": 1.5, "y": 2, "rotation": 90, "color": "#4ade80"}
        ],
    })

    assert resp.status_code == 200
    assert resp.json()["target_grid_x"] == 6
    assert resp.json()["bin_layout"] == [
        {"id": "placement-1", "bin_id": bin_data["id"], "x": 1.5, "y": 2.0, "rotation": 90, "color": "#4ade80"}
    ]
    stored = client.get(f"/api/bin-projects/{project['id']}").json()["sketches"][0]
    assert stored["bin_layout"][0]["x"] == 1.5
    assert stored["name"] == "Top"


def test_project_holds_several_sketches(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    project = client.post("/api/bin-projects", json={"name": "Top drawer"}).json()

    first = client.post(f"/api/bin-projects/{project['id']}/sketches", json={}).json()
    second = client.post(f"/api/bin-projects/{project['id']}/sketches", json={"target_grid_x": 8}).json()

    detail = client.get(f"/api/bin-projects/{project['id']}").json()
    summary = next(p for p in client.get("/api/bin-projects").json()["projects"] if p["id"] == project["id"])

    assert first["name"] == "Drawer plan 1"
    assert second["name"] == "Drawer plan 2"
    assert second["target_grid_x"] == 8
    assert [s["id"] for s in detail["sketches"]] == [first["id"], second["id"]]
    assert summary["sketch_count"] == 2

    delete_resp = client.delete(f"/api/bin-projects/{project['id']}/sketches/{first['id']}")
    remaining = client.get(f"/api/bin-projects/{project['id']}").json()["sketches"]

    assert delete_resp.status_code == 200
    assert [s["id"] for s in remaining] == [second["id"]]
    assert client.patch(
        f"/api/bin-projects/{project['id']}/sketches/{first['id']}", json={"name": "gone"}
    ).status_code == 404


def test_sketch_layout_rejects_unlinked_bins_and_duplicate_placement_ids(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    project = client.post("/api/bin-projects", json={"name": "Top drawer"}).json()
    linked = client.post("/api/bins", json={"name": "Bin A", "project_id": project["id"]}).json()
    loose = client.post("/api/bins", json={"name": "Bin B"}).json()
    sketch = client.post(f"/api/bin-projects/{project['id']}/sketches", json={}).json()

    unlinked_resp = client.patch(f"/api/bin-projects/{project['id']}/sketches/{sketch['id']}", json={
        "bin_layout": [{"bin_id": loose["id"], "x": 0, "y": 0}],
    })
    duplicate_resp = client.patch(f"/api/bin-projects/{project['id']}/sketches/{sketch['id']}", json={
        "bin_layout": [
            {"id": "same", "bin_id": linked["id"], "x": 0, "y": 0},
            {"id": "same", "bin_id": linked["id"], "x": 1, "y": 0},
        ],
    })

    assert unlinked_resp.status_code == 400
    assert duplicate_resp.status_code == 400
    assert client.get(f"/api/bin-projects/{project['id']}").json()["sketches"][0]["bin_layout"] == []


def test_sketch_layout_allows_the_same_bin_more_than_once(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    project = client.post("/api/bin-projects", json={"name": "Top drawer"}).json()
    bin_data = client.post("/api/bins", json={"name": "Bin A", "project_id": project["id"]}).json()
    sketch = client.post(f"/api/bin-projects/{project['id']}/sketches", json={}).json()

    resp = client.patch(f"/api/bin-projects/{project['id']}/sketches/{sketch['id']}", json={
        "bin_layout": [
            {"bin_id": bin_data["id"], "x": 0, "y": 0},
            {"bin_id": bin_data["id"], "x": 2, "y": 0, "rotation": 180},
        ],
    })

    assert resp.status_code == 200
    layout = resp.json()["bin_layout"]
    assert [p["bin_id"] for p in layout] == [bin_data["id"], bin_data["id"]]
    assert layout[0]["id"] != layout[1]["id"]
    assert layout[1]["rotation"] == 180


def test_sketch_layout_drops_placements_when_bin_leaves_project(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    project = client.post("/api/bin-projects", json={"name": "Top drawer"}).json()
    kept = client.post("/api/bins", json={"name": "Bin A", "project_id": project["id"]}).json()
    detached = client.post("/api/bins", json={"name": "Bin B", "project_id": project["id"]}).json()
    deleted = client.post("/api/bins", json={"name": "Bin C", "project_id": project["id"]}).json()
    sketch = client.post(f"/api/bin-projects/{project['id']}/sketches", json={}).json()

    client.patch(f"/api/bin-projects/{project['id']}/sketches/{sketch['id']}", json={
        "bin_layout": [
            {"bin_id": kept["id"], "x": 0, "y": 0},
            {"bin_id": kept["id"], "x": 1, "y": 0},
            {"bin_id": detached["id"], "x": 2, "y": 0},
            {"bin_id": deleted["id"], "x": 4, "y": 0},
        ],
    })
    client.delete(f"/api/bin-projects/{project['id']}/bins/{detached['id']}")
    client.delete(f"/api/bins/{deleted['id']}")

    layout = client.get(f"/api/bin-projects/{project['id']}").json()["sketches"][0]["bin_layout"]

    assert [p["bin_id"] for p in layout] == [kept["id"], kept["id"]]


def test_repair_drops_stale_layout_placements(tmp_path):
    project_store = ProjectStore(tmp_path)
    tool_store = ToolStore(tmp_path)
    bin_store = BinStore(tmp_path)
    bin_store.set("bin-1", BinModel(id="bin-1", project_id="project-1"))
    project = BinProject(
        id="project-1",
        name="Top drawer",
        bin_ids=["bin-1"],
        sketches=[ProjectSketch(bin_layout=[
            ProjectBinPlacement(bin_id="bin-1", x=0, y=0),
            ProjectBinPlacement(bin_id="missing-bin", x=1, y=0),
        ])],
    )
    project_store.set(project.id, project)

    repaired = repair_project_links(project_store, project, tool_store, bin_store)

    assert [p.bin_id for p in repaired.sketches[0].bin_layout] == ["bin-1"]


def test_bin_summary_exposes_grid_and_height_for_sketching(tmp_path, monkeypatch):
    client = _api_client(tmp_path, monkeypatch)
    client.post("/api/bins", json={
        "name": "Bin A",
        "bin_config": {"grid_x": 3, "grid_y": 1, "height_units": 6, "half_grid_base": True},
    })

    summary = client.get("/api/bins").json()["bins"][0]

    assert summary["grid_x"] == 3
    assert summary["grid_y"] == 1
    assert summary["height_units"] == 6
    assert summary["half_grid_base"] is True
