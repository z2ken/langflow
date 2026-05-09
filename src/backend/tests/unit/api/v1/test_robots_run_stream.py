import json
import pytest
from fastapi.testclient import TestClient
from langflow.main import create_app
from langflow.robot.registry import robot_registry
from langflow.robot.adapters.my_robot import MyRobotAdapter


@pytest.fixture
def runnable_robot():
    a = MyRobotAdapter(robot_id="run_bot", host="h", port=1)
    robot_registry._adapters["run_bot"] = a
    yield "run_bot"
    robot_registry._adapters.pop("run_bot", None)


@pytest.fixture
def client():
    return TestClient(create_app())


def _parse_sse(body: str) -> list[tuple[str, dict]]:
    """Parse an SSE response body into a list of (event_name, data_dict)."""
    events: list[tuple[str, dict]] = []
    for frame in body.split("\n\n"):
        if not frame.strip():
            continue
        ev = None
        data = None
        for line in frame.splitlines():
            if line.startswith("event:"):
                ev = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                data = json.loads(line.split(":", 1)[1].strip())
        if ev and data is not None:
            events.append((ev, data))
    return events


def test_run_stream_emits_step_events_in_order(client, runnable_robot):
    code = "HOME\nMOVE j1=10 j2=20"
    with client.stream(
        "POST",
        "/api/v1/robots/run/stream",
        json={"robot_id": runnable_robot, "code": code},
    ) as r:
        assert r.status_code == 200
        body = r.read().decode("utf-8")
    events = _parse_sse(body)
    types = [e[0] for e in events]

    assert types[0] == "step_start"
    assert types[1] == "step_end"
    assert types[2] == "step_start"
    assert types[3] == "step_end"
    assert types[-1] == "done"

    home_end = events[1][1]
    assert home_end["line"] == "HOME"
    assert home_end["joints_after"] == [0.0] * 6
    assert home_end["success"] is True

    move_end = events[3][1]
    assert move_end["line"] == "MOVE j1=10 j2=20"
    assert move_end["joints_after"][0] == 10.0
    assert move_end["joints_after"][1] == 20.0


def test_run_stream_404_for_unknown_robot(client):
    r = client.post(
        "/api/v1/robots/run/stream",
        json={"robot_id": "nonexistent", "code": "HOME"},
    )
    assert r.status_code == 404


def test_run_stream_skips_blank_and_comment_lines(client, runnable_robot):
    code = "\n# this is a comment\nHOME\n   \n"
    with client.stream(
        "POST",
        "/api/v1/robots/run/stream",
        json={"robot_id": runnable_robot, "code": code},
    ) as r:
        body = r.read().decode("utf-8")
    events = _parse_sse(body)
    step_starts = [e for e in events if e[0] == "step_start"]
    assert len(step_starts) == 1
    assert step_starts[0][1]["line"] == "HOME"


def test_run_stream_halts_on_failure(client, runnable_robot):
    code = "HOME\nJOG joint=X1 delta=5\nMOVE j1=99"
    with client.stream(
        "POST",
        "/api/v1/robots/run/stream",
        json={"robot_id": runnable_robot, "code": code},
    ) as r:
        body = r.read().decode("utf-8")
    events = _parse_sse(body)
    types = [e[0] for e in events]
    assert "step_end" in types
    failures = [e[1] for e in events if e[0] == "step_end" and not e[1]["success"]]
    assert len(failures) == 1
    assert "JOG" in failures[0]["line"]
    move_starts = [e for e in events if e[0] == "step_start" and "MOVE" in e[1]["line"]]
    assert len(move_starts) == 0
