"""End-to-end-ish coverage of the Sync-mode drag → MOVE → adapter path.

The frontend's `useSimulator` hook debounces rapid drag updates into MOVE
commands posted to `/command`. Phase F (F5) wants reassurance that even when
several MOVE commands arrive in quick succession, the mock adapter's reported
state converges to the last commanded joint vector — i.e. nothing gets stuck
in a half-applied transient.
"""
import pytest
from fastapi.testclient import TestClient
from langflow.main import create_app
from langflow.robot.registry import robot_registry
from langflow.robot.adapters.my_robot import MyRobotAdapter


@pytest.fixture
def sync_robot():
    a = MyRobotAdapter(robot_id="sync_bot", host="h", port=1)
    robot_registry._adapters["sync_bot"] = a
    yield "sync_bot"
    robot_registry._adapters.pop("sync_bot", None)


@pytest.fixture
def client():
    return TestClient(create_app())


def _move(client: TestClient, robot_id: str, joints: dict[str, float]):
    return client.post(
        f"/api/v1/robots/{robot_id}/command",
        json={"cmd": "MOVE", "params": joints},
    )


def test_rapid_moves_converge_to_last(sync_robot, client):
    # Simulate a fast drag: many slightly-different targets in quick succession.
    for j2 in (-10.0, -20.0, -30.0, -40.0):
        r = _move(client, sync_robot, {"j2": j2})
        assert r.status_code == 200

    s = client.get(f"/api/v1/robots/{sync_robot}/status").json()
    assert s["joints"][1] == -40.0


def test_emergency_home_after_drag(sync_robot, client):
    """Mirrors the EmergencyStop UX: after drag-induced motion, HOME zeros all
    joints regardless of where they were."""
    _move(client, sync_robot, {"j1": 60.0, "j2": -45.0, "j3": 25.0})
    s = client.get(f"/api/v1/robots/{sync_robot}/status").json()
    assert s["joints"][0] == 60.0
    assert s["joints"][1] == -45.0

    r = client.post(
        f"/api/v1/robots/{sync_robot}/command",
        json={"cmd": "HOME", "params": {}},
    )
    assert r.status_code == 200
    s2 = client.get(f"/api/v1/robots/{sync_robot}/status").json()
    assert s2["joints"] == [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]


def test_ws_streams_post_drag_state(sync_robot, client):
    """Open the status WS, post a MOVE, and confirm the next frame from the
    server reflects the new target. This is the round-trip the Sync indicator
    visualises."""
    with client.websocket_connect(f"/api/v1/robots/ws/{sync_robot}") as ws:
        first = ws.receive_json()
        assert first["robot_id"] == sync_robot
        assert first["joints"] == [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]

        _move(client, sync_robot, {"j1": 15.0, "j5": -5.0})

        # The WS pushes a frame every 500 ms; a few receives should suffice.
        target_seen = False
        for _ in range(5):
            frame = ws.receive_json()
            if frame["joints"][0] == 15.0 and frame["joints"][4] == -5.0:
                target_seen = True
                break
        assert target_seen, "WS never reported the post-MOVE joint state"
