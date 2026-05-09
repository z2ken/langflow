import pytest
from fastapi.testclient import TestClient
from langflow.main import create_app
from langflow.robot.registry import robot_registry
from langflow.robot.adapters.my_robot import MyRobotAdapter


@pytest.fixture
def urdf_robot(tmp_path):
    urdf = tmp_path / "test.urdf"
    urdf.write_text("<robot name='unit-test-bot'></robot>")
    meshes = tmp_path / "meshes"
    meshes.mkdir()
    (meshes / "cube.stl").write_bytes(b"binary stl content")

    adapter = MyRobotAdapter(
        robot_id="urdf_bot",
        host="localhost",
        port=8080,
        urdf_path=str(urdf),
        mesh_dir=str(meshes),
    )
    robot_registry._adapters["urdf_bot"] = adapter
    yield "urdf_bot"
    robot_registry._adapters.pop("urdf_bot", None)


@pytest.fixture
def plain_robot():
    a = MyRobotAdapter(robot_id="plain_bot", host="h", port=1)
    robot_registry._adapters["plain_bot"] = a
    yield "plain_bot"
    robot_registry._adapters.pop("plain_bot", None)


@pytest.fixture
def client():
    return TestClient(create_app())


# ---- /urdf endpoint (A5) ----

def test_urdf_endpoint_returns_xml_and_mesh_base(client, urdf_robot):
    r = client.get(f"/api/v1/robots/{urdf_robot}/urdf")
    assert r.status_code == 200
    body = r.json()
    assert "<robot name='unit-test-bot'></robot>" in body["urdf_xml"]
    assert body["mesh_base_url"] == f"/api/v1/robots/meshes/{urdf_robot}"


def test_urdf_endpoint_404_when_no_urdf_path(client, plain_robot):
    r = client.get(f"/api/v1/robots/{plain_robot}/urdf")
    assert r.status_code == 404


def test_urdf_endpoint_404_when_robot_missing(client):
    r = client.get("/api/v1/robots/nonexistent/urdf")
    assert r.status_code == 404


# ---- /meshes endpoint (A6) ----

def test_mesh_endpoint_serves_file(client, urdf_robot):
    r = client.get(f"/api/v1/robots/meshes/{urdf_robot}/cube.stl")
    assert r.status_code == 200
    assert r.content == b"binary stl content"


def test_mesh_endpoint_path_traversal_blocked(client, urdf_robot):
    r = client.get(f"/api/v1/robots/meshes/{urdf_robot}/../../../etc/passwd")
    # 403 (rejected) or 404 (rewritten away) both acceptable; 200 is NOT
    assert r.status_code in (403, 404)


def test_mesh_endpoint_404_unknown_file(client, urdf_robot):
    r = client.get(f"/api/v1/robots/meshes/{urdf_robot}/missing.stl")
    assert r.status_code == 404


def test_mesh_endpoint_404_when_robot_has_no_mesh_dir(client, plain_robot):
    r = client.get(f"/api/v1/robots/meshes/{plain_robot}/anything.stl")
    assert r.status_code == 404


def test_mesh_endpoint_404_when_robot_missing(client):
    r = client.get("/api/v1/robots/meshes/nonexistent/x.stl")
    assert r.status_code == 404
