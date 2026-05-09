# 3D Simulation Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runtime 3D simulation page (`/simulation`) for the Robot HMI with four modes (Offline / Live / Sync / Sandbox), forward + inverse kinematics drag, BVH-based collision detection, and SSE script playback — per the spec at [`docs/superpowers/specs/2026-05-09-3d-sim-design.md`](../specs/2026-05-09-3d-sim-design.md).

**Architecture:** The 3D scene runs entirely in the browser (React Three Fiber + drei + urdf-loader + three-mesh-bvh). The Langflow backend serves URDF files and meshes, plus an SSE variant of `/run`. Joint state in Live/Sync modes flows through the existing WebSocket; in Offline/Sandbox modes the sim is fully local. IK and collision detection are pure-TS in the browser (no WASM, no IK lib — analytical 6-DOF for spherical wrist with CCD fallback).

**Tech Stack:** FastAPI / Python 3.11 (backend), React 19 / TypeScript / Vite (frontend), `@react-three/fiber`, `@react-three/drei`, `three`, `urdf-loader`, `three-mesh-bvh`.

---

## Scope of this plan

This plan covers **Phase A in full TDD detail** — the foundation:

1. Backend serves URDF + meshes
2. Adapter interface gains `urdf_path` / `mesh_dir`
3. Mock adapter behaviour change (target tracking, no sinusoid)
4. `mock_6dof` URDF + meshes shipped
5. `/simulation` page shell renders the URDF in 3D, mirroring `/ws/{id}` (Live mode)

**Phases B–F are listed at the end as a roadmap with task outlines.** After Phase A is implemented and verified, re-run /writing-plans on Phase B with refined detail informed by Phase A's outcome.

---

## File Structure (Phase A target)

**Backend / repo:**
- `src/backend/base/langflow/robot/adapters/base.py` — modify: add `urdf_path` / `mesh_dir`
- `src/backend/base/langflow/robot/adapters/my_robot.py` — modify: accept new kwargs, switch to target-tracking
- `src/backend/base/langflow/robot/registry.py` — modify: pass new kwargs from YAML
- `src/backend/base/langflow/api/v1/robots.py` — modify: add `/urdf` + `/meshes/{file}` + update CRUD
- `src/backend/tests/unit/api/v1/test_robots_urdf.py` — create
- `src/backend/tests/unit/robot/test_adapter_target_tracking.py` — create
- `scripts/gen_mock_meshes.py` — create
- `robots/mock_6dof/mock_6dof.urdf` — create
- `robots/mock_6dof/meshes/{base,link1,...,link6,tcp}.stl` — create (8 files via gen script)
- `robots.yaml` — modify: add `urdf_path` + `mesh_dir` to `robot_01`

**Frontend:**
- `src/frontend/package.json` / `package-lock.json` — modify: deps
- `src/frontend/src/routes.tsx` — modify: `/simulation`
- `src/frontend/src/components/core/appHeaderComponent/index.tsx` — modify: nav link
- `src/frontend/src/pages/SimulationPage/index.tsx` — create: page shell
- `src/frontend/src/pages/SimulationPage/components/Scene.tsx` — create: R3F canvas
- `src/frontend/src/pages/SimulationPage/components/RobotModel.tsx` — create: URDF render + joint binding
- `src/frontend/src/pages/SimulationPage/hooks/useUrdf.ts` — create
- `src/frontend/src/pages/SimulationPage/hooks/useJointState.ts` — create (Live mode only in Phase A)

---

## Phase A — Foundation (Detailed)

Each task ends with a commit. Run from repo root unless noted. Use `uv run pytest ...` for backend tests per AGENTS.md.

### Task A1: Adapter base — add urdf_path / mesh_dir

**Goal:** Extend `RobotAdapter` to optionally carry filesystem paths to its URDF and mesh directory.

**Files:**
- Modify: `src/backend/base/langflow/robot/adapters/base.py`
- Test: `src/backend/tests/unit/robot/test_adapter_paths.py` (create)

- [ ] **Step 1: Write the failing test**

Create `src/backend/tests/unit/robot/__init__.py` (empty) if needed. Then create `src/backend/tests/unit/robot/test_adapter_paths.py`:

```python
from pathlib import Path
from langflow.robot.adapters.my_robot import MyRobotAdapter


def test_adapter_accepts_urdf_path_and_mesh_dir(tmp_path):
    urdf = tmp_path / "robot.urdf"
    urdf.write_text("<robot/>")
    meshes = tmp_path / "meshes"
    meshes.mkdir()

    adapter = MyRobotAdapter(
        robot_id="r",
        host="h",
        port=1,
        urdf_path=str(urdf),
        mesh_dir=str(meshes),
    )
    assert adapter.urdf_path == urdf
    assert adapter.mesh_dir == meshes


def test_adapter_paths_default_to_none():
    adapter = MyRobotAdapter(robot_id="r", host="h", port=1)
    assert adapter.urdf_path is None
    assert adapter.mesh_dir is None
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src/backend && uv run pytest tests/unit/robot/test_adapter_paths.py -v
```
Expected: FAIL — `MyRobotAdapter() got an unexpected keyword argument 'urdf_path'`.

- [ ] **Step 3: Modify the base adapter**

In `src/backend/base/langflow/robot/adapters/base.py`, replace the `__init__` and add properties:

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class RobotStatus:
    robot_id: str
    connected: bool
    joints: list[float] = field(default_factory=list)
    position: dict[str, float] = field(default_factory=dict)
    current_task: str | None = None
    last_error: str | None = None
    extra: dict = field(default_factory=dict)


@dataclass
class CommandResult:
    success: bool
    message: str
    data: dict = field(default_factory=dict)


class RobotAdapter(ABC):
    def __init__(
        self,
        robot_id: str,
        host: str,
        port: int,
        *,
        urdf_path: str | None = None,
        mesh_dir: str | None = None,
        **kwargs,
    ):
        self.robot_id = robot_id
        self.host = host
        self.port = port
        self._connected = False
        self._urdf_path: Path | None = Path(urdf_path) if urdf_path else None
        self._mesh_dir: Path | None = Path(mesh_dir) if mesh_dir else None

    @property
    def urdf_path(self) -> Path | None:
        return self._urdf_path

    @property
    def mesh_dir(self) -> Path | None:
        return self._mesh_dir

    @abstractmethod
    async def connect(self) -> None: ...

    @abstractmethod
    async def disconnect(self) -> None: ...

    @abstractmethod
    async def get_status(self) -> RobotStatus: ...

    @abstractmethod
    async def send_command(self, cmd: str, params: dict) -> CommandResult: ...

    @property
    def connected(self) -> bool:
        return self._connected
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd src/backend && uv run pytest tests/unit/robot/test_adapter_paths.py -v
```
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/backend/base/langflow/robot/adapters/base.py src/backend/tests/unit/robot/
git commit -m "feat(robot-hmi): adapter base — add urdf_path / mesh_dir"
```

---

### Task A2: Mock adapter — target-tracking, drop sinusoid

**Goal:** Replace `MyRobotAdapter`'s sinusoidal motion with target-tracking so MOVE actually changes reported state — required for trajectory playback to be deterministic.

**Files:**
- Modify: `src/backend/base/langflow/robot/adapters/my_robot.py`
- Test: `src/backend/tests/unit/robot/test_adapter_target_tracking.py` (create)

- [ ] **Step 1: Write the failing test**

```python
# src/backend/tests/unit/robot/test_adapter_target_tracking.py
import pytest
from langflow.robot.adapters.my_robot import MyRobotAdapter


@pytest.mark.asyncio
async def test_move_updates_reported_joints():
    a = MyRobotAdapter(robot_id="r", host="h", port=1)
    await a.connect()
    s0 = await a.get_status()
    assert s0.joints == [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]

    await a.send_command("MOVE", {"j1": 30, "j2": -45, "j3": 10})
    s1 = await a.get_status()
    assert s1.joints[0] == 30.0
    assert s1.joints[1] == -45.0
    assert s1.joints[2] == 10.0
    # Untouched joints unchanged
    assert s1.joints[3] == 0.0


@pytest.mark.asyncio
async def test_home_resets_joints():
    a = MyRobotAdapter(robot_id="r", host="h", port=1)
    await a.connect()
    await a.send_command("MOVE", {"j1": 30, "j2": -45})
    await a.send_command("HOME", {})
    s = await a.get_status()
    assert s.joints == [0.0] * 6


@pytest.mark.asyncio
async def test_jog_increments_single_joint():
    a = MyRobotAdapter(robot_id="r", host="h", port=1)
    await a.connect()
    await a.send_command("JOG", {"joint": "J2", "delta": 5})
    await a.send_command("JOG", {"joint": "J2", "delta": 5})
    s = await a.get_status()
    assert s.joints[1] == 10.0


@pytest.mark.asyncio
async def test_gripper_state_recorded():
    a = MyRobotAdapter(robot_id="r", host="h", port=1)
    await a.connect()
    await a.send_command("GRIPPER", {"state": "close"})
    s = await a.get_status()
    assert s.extra.get("gripper") == "close"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src/backend && uv run pytest tests/unit/robot/test_adapter_target_tracking.py -v
```
Expected: failures — current adapter returns sinusoidal joints regardless of commands.

- [ ] **Step 3: Rewrite my_robot.py**

```python
# src/backend/base/langflow/robot/adapters/my_robot.py
"""Mock adapter — target-tracking for deterministic 3D simulation."""

from langflow.robot.adapters.base import CommandResult, RobotAdapter, RobotStatus


class MyRobotAdapter(RobotAdapter):
    """
    Mock adapter that reports the last commanded target state.
    Joints are 6 floats in degrees; gripper is "open" | "close".
    Replace TODOs with real protocol calls when integrating a physical robot.
    """

    def __init__(self, robot_id: str, host: str, port: int, **kwargs):
        super().__init__(robot_id, host, port, **kwargs)
        self._joints: list[float] = [0.0] * 6
        self._gripper: str = "open"
        self._last_cmd: str | None = None

    async def connect(self) -> None:
        # TODO: real handshake
        self._connected = True

    async def disconnect(self) -> None:
        # TODO: real disconnect
        self._connected = False

    async def get_status(self) -> RobotStatus:
        # TODO: real status endpoint
        return RobotStatus(
            robot_id=self.robot_id,
            connected=self._connected,
            joints=list(self._joints),
            position={},  # forward kinematics is computed client-side from joints
            current_task=self._last_cmd,
            last_error=None,
            extra={"gripper": self._gripper},
        )

    async def send_command(self, cmd: str, params: dict) -> CommandResult:
        # TODO: real command endpoint
        self._last_cmd = cmd
        cmd_upper = cmd.upper()

        if cmd_upper == "HOME":
            self._joints = [0.0] * 6
            return CommandResult(success=True, message="homed")

        if cmd_upper == "MOVE":
            for i in range(6):
                key = f"j{i + 1}"
                if key in params:
                    self._joints[i] = float(params[key])
            return CommandResult(success=True, message=f"moved to {self._joints}")

        if cmd_upper == "JOG":
            joint = str(params.get("joint", "")).upper()
            if not joint.startswith("J") or not joint[1:].isdigit():
                return CommandResult(success=False, message=f"bad joint '{joint}'")
            idx = int(joint[1:]) - 1
            if not 0 <= idx < 6:
                return CommandResult(success=False, message=f"joint index out of range: {joint}")
            self._joints[idx] += float(params.get("delta", 0))
            return CommandResult(success=True, message=f"jogged {joint} to {self._joints[idx]}")

        if cmd_upper == "GRIPPER":
            state = str(params.get("state", "")).lower()
            if state not in ("open", "close"):
                return CommandResult(success=False, message=f"bad gripper state '{state}'")
            self._gripper = state
            return CommandResult(success=True, message=f"gripper {state}")

        if cmd_upper == "WAIT":
            return CommandResult(success=True, message=f"waited {params.get('duration', 0)}s")

        return CommandResult(success=False, message=f"unknown command '{cmd}'")
```

- [ ] **Step 4: Run target-tracking tests**

```bash
cd src/backend && uv run pytest tests/unit/robot/test_adapter_target_tracking.py -v
```
Expected: 4 passed.

- [ ] **Step 5: Run earlier tests to make sure nothing regressed**

```bash
cd src/backend && uv run pytest tests/unit/robot/ -v
```
Expected: 6 passed.

- [ ] **Step 6: Commit**

```bash
git add src/backend/base/langflow/robot/adapters/my_robot.py src/backend/tests/unit/robot/test_adapter_target_tracking.py
git commit -m "feat(robot-hmi): mock adapter — target-tracking instead of sinusoid"
```

---

### Task A3: Registry — pass urdf_path / mesh_dir from YAML

**Goal:** Registry should read `urdf_path` and `mesh_dir` from `robots.yaml` and forward them to the adapter constructor. Resolve relative to the YAML file's directory.

**Files:**
- Modify: `src/backend/base/langflow/robot/registry.py`
- Test: `src/backend/tests/unit/robot/test_registry_paths.py` (create)

- [ ] **Step 1: Write the failing test**

```python
# src/backend/tests/unit/robot/test_registry_paths.py
from pathlib import Path
import yaml
from langflow.robot.registry import RobotRegistry


def test_registry_passes_urdf_and_mesh_dir(tmp_path):
    cfg = tmp_path / "robots.yaml"
    cfg.write_text(yaml.dump({
        "robots": {
            "test_bot": {
                "adapter": "MyRobotAdapter",
                "host": "127.0.0.1",
                "port": 8080,
                "urdf_path": "models/test.urdf",
                "mesh_dir": "models/meshes",
            }
        }
    }))
    (tmp_path / "models").mkdir()
    (tmp_path / "models" / "test.urdf").write_text("<robot/>")
    (tmp_path / "models" / "meshes").mkdir()

    reg = RobotRegistry()
    reg.load(cfg)
    adapter = reg.get("test_bot")
    assert adapter.urdf_path == (tmp_path / "models" / "test.urdf").resolve()
    assert adapter.mesh_dir == (tmp_path / "models" / "meshes").resolve()


def test_registry_handles_robots_without_paths(tmp_path):
    cfg = tmp_path / "robots.yaml"
    cfg.write_text(yaml.dump({
        "robots": {
            "plain_bot": {"adapter": "MyRobotAdapter", "host": "h", "port": 1}
        }
    }))
    reg = RobotRegistry()
    reg.load(cfg)
    a = reg.get("plain_bot")
    assert a.urdf_path is None
    assert a.mesh_dir is None
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src/backend && uv run pytest tests/unit/robot/test_registry_paths.py -v
```
Expected: first test fails (paths are None).

- [ ] **Step 3: Update registry**

In `src/backend/base/langflow/robot/registry.py`, change `_instantiate` to resolve paths relative to the config file:

```python
def _instantiate(self, robot_id: str, cfg: dict) -> None:
    adapter_cls = _ADAPTER_MAP.get(cfg["adapter"])
    if adapter_cls is None:
        raise ValueError(f"Unknown adapter '{cfg['adapter']}' for robot '{robot_id}'")

    base_dir = self._config_path.parent.resolve() if self._config_path else None

    def _resolve(rel: str | None) -> str | None:
        if not rel:
            return None
        p = Path(rel)
        if p.is_absolute() or base_dir is None:
            return str(p.resolve())
        return str((base_dir / p).resolve())

    self._adapters[robot_id] = adapter_cls(
        robot_id=robot_id,
        host=cfg["host"],
        port=int(cfg["port"]),
        urdf_path=_resolve(cfg.get("urdf_path")),
        mesh_dir=_resolve(cfg.get("mesh_dir")),
    )
```

- [ ] **Step 4: Run tests**

```bash
cd src/backend && uv run pytest tests/unit/robot/ -v
```
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/backend/base/langflow/robot/registry.py src/backend/tests/unit/robot/test_registry_paths.py
git commit -m "feat(robot-hmi): registry — load urdf_path / mesh_dir from yaml, resolve relative to config"
```

---

### Task A4: Config CRUD — round-trip urdf_path / mesh_dir

**Goal:** When `RobotConfigPage` updates a robot, do not erase `urdf_path` / `mesh_dir`. Add optional fields to the request/response.

**Files:**
- Modify: `src/backend/base/langflow/api/v1/robots.py`
- Modify: `src/backend/base/langflow/robot/registry.py`

- [ ] **Step 1: Write the failing test**

Append to `src/backend/tests/unit/robot/test_registry_paths.py`:

```python
def test_registry_add_preserves_paths(tmp_path):
    cfg = tmp_path / "robots.yaml"
    cfg.write_text("robots: {}")
    (tmp_path / "models").mkdir()
    (tmp_path / "models" / "x.urdf").write_text("<robot/>")
    (tmp_path / "models" / "meshes").mkdir()

    reg = RobotRegistry()
    reg.load(cfg)
    reg.add(
        "new_bot",
        adapter="MyRobotAdapter",
        host="h",
        port=1,
        urdf_path="models/x.urdf",
        mesh_dir="models/meshes",
    )
    a = reg.get("new_bot")
    assert a.urdf_path == (tmp_path / "models" / "x.urdf").resolve()

    # And after a re-load from disk, the paths should still be there
    import yaml
    on_disk = yaml.safe_load(cfg.read_text())
    assert on_disk["robots"]["new_bot"]["urdf_path"] == "models/x.urdf"
    assert on_disk["robots"]["new_bot"]["mesh_dir"] == "models/meshes"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src/backend && uv run pytest tests/unit/robot/test_registry_paths.py::test_registry_add_preserves_paths -v
```
Expected: TypeError (`add()` does not accept `urdf_path`).

- [ ] **Step 3: Update registry add/update signatures**

In `registry.py`, change `add` and `update` to accept the optional path fields:

```python
def add(
    self,
    robot_id: str,
    adapter: str,
    host: str,
    port: int,
    *,
    urdf_path: str | None = None,
    mesh_dir: str | None = None,
) -> None:
    if robot_id in self._config:
        raise ValueError(f"Robot '{robot_id}' already exists")
    cfg: dict = {"adapter": adapter, "host": host, "port": port}
    if urdf_path:
        cfg["urdf_path"] = urdf_path
    if mesh_dir:
        cfg["mesh_dir"] = mesh_dir
    self._config[robot_id] = cfg
    self._instantiate(robot_id, cfg)
    self._save()


def update(
    self,
    robot_id: str,
    adapter: str,
    host: str,
    port: int,
    *,
    urdf_path: str | None = None,
    mesh_dir: str | None = None,
) -> None:
    if robot_id not in self._config:
        raise KeyError(f"Robot '{robot_id}' not found")
    cfg: dict = {"adapter": adapter, "host": host, "port": port}
    if urdf_path:
        cfg["urdf_path"] = urdf_path
    if mesh_dir:
        cfg["mesh_dir"] = mesh_dir
    self._config[robot_id] = cfg
    self._instantiate(robot_id, cfg)
    self._save()
```

- [ ] **Step 4: Update RobotConfigBody Pydantic + endpoint handlers in `robots.py`**

Replace `RobotConfigBody`:

```python
class RobotConfigBody(BaseModel):
    adapter: str
    host: str
    port: int
    urdf_path: str | None = None
    mesh_dir: str | None = None
```

Update `add_robot_config` and `update_robot_config` to pass all five:

```python
@router.post("/config/{robot_id}", status_code=201)
async def add_robot_config(robot_id: str, body: RobotConfigBody):
    try:
        robot_registry.add(
            robot_id,
            body.adapter,
            body.host,
            body.port,
            urdf_path=body.urdf_path,
            mesh_dir=body.mesh_dir,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"robot_id": robot_id, **body.model_dump(exclude_none=True)}


@router.put("/config/{robot_id}")
async def update_robot_config(robot_id: str, body: RobotConfigBody):
    try:
        robot_registry.update(
            robot_id,
            body.adapter,
            body.host,
            body.port,
            urdf_path=body.urdf_path,
            mesh_dir=body.mesh_dir,
        )
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"robot_id": robot_id, **body.model_dump(exclude_none=True)}
```

Also update the `list_robot_configs` response to include the optional fields (already covered if you spread `cfg.items()` — verify).

- [ ] **Step 5: Run tests**

```bash
cd src/backend && uv run pytest tests/unit/robot/ -v
```
Expected: 9 passed.

- [ ] **Step 6: Commit**

```bash
git add src/backend/base/langflow/robot/registry.py src/backend/base/langflow/api/v1/robots.py src/backend/tests/unit/robot/test_registry_paths.py
git commit -m "feat(robot-hmi): config CRUD round-trips urdf_path / mesh_dir"
```

---

### Task A5: Backend — GET /robots/{id}/urdf

**Files:**
- Modify: `src/backend/base/langflow/api/v1/robots.py`
- Test: `src/backend/tests/unit/api/v1/test_robots_urdf.py` (create)

- [ ] **Step 1: Write the failing test**

```python
# src/backend/tests/unit/api/v1/test_robots_urdf.py
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src/backend && uv run pytest tests/unit/api/v1/test_robots_urdf.py -v
```
Expected: 404 from a route that doesn't exist (or routing failure).

- [ ] **Step 3: Implement endpoint**

In `src/backend/base/langflow/api/v1/robots.py`, after the existing `/run` and config endpoints, add:

```python
@router.get("/{robot_id}/urdf")
async def get_robot_urdf(robot_id: str):
    try:
        adapter = robot_registry.get(robot_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Robot '{robot_id}' not found")
    if adapter.urdf_path is None or not adapter.urdf_path.is_file():
        raise HTTPException(
            status_code=404,
            detail=f"Robot '{robot_id}' has no URDF configured",
        )
    return {
        "urdf_xml": adapter.urdf_path.read_text(),
        "mesh_base_url": f"/api/v1/robots/meshes/{robot_id}",
    }
```

- [ ] **Step 4: Run tests**

```bash
cd src/backend && uv run pytest tests/unit/api/v1/test_robots_urdf.py -v
```
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/backend/base/langflow/api/v1/robots.py src/backend/tests/unit/api/v1/test_robots_urdf.py
git commit -m "feat(robot-hmi): GET /api/v1/robots/{id}/urdf"
```

---

### Task A6: Backend — GET /robots/meshes/{id}/{file:path}

**Goal:** Stream mesh files with strict path-traversal protection.

**Files:**
- Modify: `src/backend/base/langflow/api/v1/robots.py`
- Test: append to `src/backend/tests/unit/api/v1/test_robots_urdf.py`

- [ ] **Step 1: Write the failing tests**

Append to `test_robots_urdf.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd src/backend && uv run pytest tests/unit/api/v1/test_robots_urdf.py -v
```
Expected: the new mesh tests fail (route undefined).

- [ ] **Step 3: Implement the endpoint**

Append to `src/backend/base/langflow/api/v1/robots.py`:

```python
import mimetypes  # add near other imports if not already present

from fastapi.responses import FileResponse

# Map extensions to model MIME types where the stdlib doesn't have one
_MODEL_MIME = {
    ".stl": "model/stl",
    ".dae": "model/vnd.collada+xml",
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
    ".obj": "text/plain",
}


@router.get("/meshes/{robot_id}/{filename:path}")
async def get_robot_mesh(robot_id: str, filename: str):
    try:
        adapter = robot_registry.get(robot_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Robot '{robot_id}' not found")
    if adapter.mesh_dir is None or not adapter.mesh_dir.is_dir():
        raise HTTPException(
            status_code=404,
            detail=f"Robot '{robot_id}' has no mesh directory configured",
        )

    mesh_root = adapter.mesh_dir.resolve()
    target = (mesh_root / filename).resolve()
    # Strict containment — reject any traversal
    try:
        target.relative_to(mesh_root)
    except ValueError:
        raise HTTPException(status_code=403, detail="path traversal blocked")
    if not target.is_file():
        raise HTTPException(status_code=404, detail=f"mesh '{filename}' not found")

    suffix = target.suffix.lower()
    media_type = _MODEL_MIME.get(suffix) or mimetypes.guess_type(str(target))[0] or "application/octet-stream"
    return FileResponse(target, media_type=media_type)
```

- [ ] **Step 4: Run all robot tests**

```bash
cd src/backend && uv run pytest tests/unit/api/v1/test_robots_urdf.py tests/unit/robot/ -v
```
Expected: 13 passed.

- [ ] **Step 5: Commit**

```bash
git add src/backend/base/langflow/api/v1/robots.py src/backend/tests/unit/api/v1/test_robots_urdf.py
git commit -m "feat(robot-hmi): GET /api/v1/robots/meshes/{id}/{file} with traversal protection"
```

---

### Task A7: Mock asset generator script

**Goal:** A regenerable Python script that produces 8 small binary STL files for the mock 6-DOF arm. Keeps the repo small and the meshes regenerable.

**Files:**
- Create: `scripts/gen_mock_meshes.py`

- [ ] **Step 1: Create the script**

```python
# scripts/gen_mock_meshes.py
"""
Generate placeholder STL meshes for the mock_6dof URDF.

Idempotent — re-running rewrites the same files. No external deps; emits
binary STL by hand. Each mesh is a simple cube or cylinder primitive
positioned in its link's local frame.

Usage (from repo root):
    python scripts/gen_mock_meshes.py
"""
from __future__ import annotations

import math
import struct
from pathlib import Path


Vec3 = tuple[float, float, float]
Tri = tuple[Vec3, Vec3, Vec3, Vec3]  # (normal, v1, v2, v3)


def write_binary_stl(path: Path, triangles: list[Tri]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as f:
        f.write(b"\0" * 80)  # 80-byte header
        f.write(struct.pack("<I", len(triangles)))
        for n, v1, v2, v3 in triangles:
            f.write(struct.pack("<3f", *n))
            f.write(struct.pack("<3f", *v1))
            f.write(struct.pack("<3f", *v2))
            f.write(struct.pack("<3f", *v3))
            f.write(b"\0\0")  # attribute byte count


def box(sx: float, sy: float, sz: float, cx: float = 0, cy: float = 0, cz: float = 0) -> list[Tri]:
    """Axis-aligned box centered on (cx, cy, cz). Triangles wound CCW from outside."""
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    p = [
        (cx - hx, cy - hy, cz - hz),
        (cx + hx, cy - hy, cz - hz),
        (cx + hx, cy + hy, cz - hz),
        (cx - hx, cy + hy, cz - hz),
        (cx - hx, cy - hy, cz + hz),
        (cx + hx, cy - hy, cz + hz),
        (cx + hx, cy + hy, cz + hz),
        (cx - hx, cy + hy, cz + hz),
    ]
    faces = [
        # (normal, indices CCW from outside)
        ((0, 0, -1), [0, 2, 1, 0, 3, 2]),  # bottom
        ((0, 0, 1),  [4, 5, 6, 4, 6, 7]),  # top
        ((0, -1, 0), [0, 1, 5, 0, 5, 4]),  # -y
        ((0, 1, 0),  [2, 3, 7, 2, 7, 6]),  # +y
        ((-1, 0, 0), [0, 4, 7, 0, 7, 3]),  # -x
        ((1, 0, 0),  [1, 2, 6, 1, 6, 5]),  # +x
    ]
    tris: list[Tri] = []
    for n, idx in faces:
        for i in range(0, 6, 3):
            tris.append((n, p[idx[i]], p[idx[i + 1]], p[idx[i + 2]]))
    return tris


def cylinder(radius: float, height: float, segments: int = 16, cz: float = 0) -> list[Tri]:
    """Cylinder along Z, centered at (0, 0, cz)."""
    tris: list[Tri] = []
    bottom_z = cz - height / 2
    top_z = cz + height / 2
    for i in range(segments):
        a0 = 2 * math.pi * i / segments
        a1 = 2 * math.pi * (i + 1) / segments
        x0, y0 = radius * math.cos(a0), radius * math.sin(a0)
        x1, y1 = radius * math.cos(a1), radius * math.sin(a1)
        # Side: two triangles per segment
        nx, ny = math.cos((a0 + a1) / 2), math.sin((a0 + a1) / 2)
        tris.append(((nx, ny, 0), (x0, y0, bottom_z), (x1, y1, bottom_z), (x1, y1, top_z)))
        tris.append(((nx, ny, 0), (x0, y0, bottom_z), (x1, y1, top_z), (x0, y0, top_z)))
        # Bottom cap (normal -Z)
        tris.append(((0, 0, -1), (0, 0, bottom_z), (x1, y1, bottom_z), (x0, y0, bottom_z)))
        # Top cap (normal +Z)
        tris.append(((0, 0, 1), (0, 0, top_z), (x0, y0, top_z), (x1, y1, top_z)))
    return tris


def main() -> None:
    out = Path(__file__).resolve().parent.parent / "robots" / "mock_6dof" / "meshes"

    # base — short cylinder, sits on the ground
    write_binary_stl(out / "base.stl", cylinder(radius=0.10, height=0.05, cz=0.025))

    # link1 — vertical box from base to joint2
    write_binary_stl(out / "link1.stl", box(0.06, 0.06, 0.30, cz=0.15))

    # link2 — long horizontal box (rotates around Y)
    write_binary_stl(out / "link2.stl", box(0.06, 0.06, 0.40, cz=0.20))

    # link3 — medium box
    write_binary_stl(out / "link3.stl", box(0.05, 0.05, 0.30, cz=0.15))

    # link4 — wrist roll housing
    write_binary_stl(out / "link4.stl", box(0.05, 0.05, 0.05))

    # link5 — wrist pitch housing
    write_binary_stl(out / "link5.stl", box(0.04, 0.04, 0.04))

    # link6 — wrist roll output
    write_binary_stl(out / "link6.stl", box(0.04, 0.04, 0.05, cz=0.025))

    # tcp — small marker cube at the flange
    write_binary_stl(out / "tcp.stl", box(0.03, 0.03, 0.03, cz=0.015))

    print(f"wrote 8 meshes to {out}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the script**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi && python scripts/gen_mock_meshes.py
```
Expected: prints `wrote 8 meshes to .../robots/mock_6dof/meshes`. Verify 8 STL files exist.

- [ ] **Step 3: Quick validity check on an STL**

```bash
ls -la robots/mock_6dof/meshes/
file robots/mock_6dof/meshes/base.stl
```
Expected: each file ~1-3 KB; `file` reports binary data.

- [ ] **Step 4: Commit**

```bash
git add scripts/gen_mock_meshes.py robots/mock_6dof/meshes/
git commit -m "feat(robot-hmi): mock 6-DOF mesh generator + generated STL primitives"
```

---

### Task A8: Mock URDF + register with robot_01

**Files:**
- Create: `robots/mock_6dof/mock_6dof.urdf`
- Modify: `robots.yaml`

- [ ] **Step 1: Write the URDF**

```xml
<!-- robots/mock_6dof/mock_6dof.urdf -->
<?xml version="1.0"?>
<robot name="mock_6dof">

  <link name="base">
    <visual>
      <geometry><mesh filename="meshes/base.stl"/></geometry>
      <material name="base_mat"><color rgba="0.2 0.2 0.25 1"/></material>
    </visual>
  </link>

  <joint name="j1" type="revolute">
    <parent link="base"/><child link="link1"/>
    <origin xyz="0 0 0.05" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-3.14" upper="3.14" effort="100" velocity="3"/>
  </joint>

  <link name="link1">
    <visual>
      <geometry><mesh filename="meshes/link1.stl"/></geometry>
      <material name="arm_mat"><color rgba="0.6 0.6 0.65 1"/></material>
    </visual>
  </link>

  <joint name="j2" type="revolute">
    <parent link="link1"/><child link="link2"/>
    <origin xyz="0 0 0.30" rpy="0 0 0"/>
    <axis xyz="0 1 0"/>
    <limit lower="-2.5" upper="2.5" effort="100" velocity="3"/>
  </joint>

  <link name="link2">
    <visual>
      <geometry><mesh filename="meshes/link2.stl"/></geometry>
      <material name="arm_mat"/>
    </visual>
  </link>

  <joint name="j3" type="revolute">
    <parent link="link2"/><child link="link3"/>
    <origin xyz="0 0 0.40" rpy="0 0 0"/>
    <axis xyz="0 1 0"/>
    <limit lower="-2.5" upper="2.5" effort="100" velocity="3"/>
  </joint>

  <link name="link3">
    <visual>
      <geometry><mesh filename="meshes/link3.stl"/></geometry>
      <material name="arm_mat"/>
    </visual>
  </link>

  <!-- Spherical wrist: j4, j5, j6 share an origin point -->
  <joint name="j4" type="revolute">
    <parent link="link3"/><child link="link4"/>
    <origin xyz="0 0 0.30" rpy="0 0 0"/>
    <axis xyz="1 0 0"/>
    <limit lower="-3.14" upper="3.14" effort="50" velocity="3"/>
  </joint>

  <link name="link4">
    <visual>
      <geometry><mesh filename="meshes/link4.stl"/></geometry>
      <material name="wrist_mat"><color rgba="0.85 0.55 0.2 1"/></material>
    </visual>
  </link>

  <joint name="j5" type="revolute">
    <parent link="link4"/><child link="link5"/>
    <origin xyz="0 0 0" rpy="0 0 0"/>
    <axis xyz="0 1 0"/>
    <limit lower="-2" upper="2" effort="50" velocity="3"/>
  </joint>

  <link name="link5">
    <visual>
      <geometry><mesh filename="meshes/link5.stl"/></geometry>
      <material name="wrist_mat"/>
    </visual>
  </link>

  <joint name="j6" type="revolute">
    <parent link="link5"/><child link="link6"/>
    <origin xyz="0 0 0" rpy="0 0 0"/>
    <axis xyz="1 0 0"/>
    <limit lower="-3.14" upper="3.14" effort="50" velocity="3"/>
  </joint>

  <link name="link6">
    <visual>
      <geometry><mesh filename="meshes/link6.stl"/></geometry>
      <material name="wrist_mat"/>
    </visual>
  </link>

  <joint name="tcp_joint" type="fixed">
    <parent link="link6"/><child link="tcp"/>
    <origin xyz="0 0 0.05" rpy="0 0 0"/>
  </joint>

  <link name="tcp">
    <visual>
      <geometry><mesh filename="meshes/tcp.stl"/></geometry>
      <material name="tcp_mat"><color rgba="0.95 0.2 0.2 1"/></material>
    </visual>
  </link>

</robot>
```

- [ ] **Step 2: Update robots.yaml — point robot_01 at the URDF**

Replace `robots.yaml` content:

```yaml
robots:
  robot_01:
    adapter: MyRobotAdapter
    host: "192.168.1.10"
    port: 8080
    urdf_path: "robots/mock_6dof/mock_6dof.urdf"
    mesh_dir: "robots/mock_6dof/meshes"
  robot_02:
    adapter: MyRobotAdapter
    host: "192.168.1.11"
    port: 8080
```

`robot_02` left without URDF — exercises the no-URDF path in the simulation page.

- [ ] **Step 3: Smoke test the backend**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi && \
  PYTHONPATH=src/backend/base:src/lfx/src .venv/bin/uvicorn \
    --factory langflow.main:create_app --host 127.0.0.1 --port 7860 --loop asyncio &
sleep 5
curl -s http://127.0.0.1:7860/api/v1/robots/robot_01/urdf | head -c 200
curl -sI http://127.0.0.1:7860/api/v1/robots/meshes/robot_01/base.stl
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:7860/api/v1/robots/meshes/robot_01/../../../etc/passwd
kill %1
```
Expected: URDF text starts with `<?xml`; mesh response is `200`; traversal request is `403` or `404`.

- [ ] **Step 4: Commit**

```bash
git add robots/mock_6dof/mock_6dof.urdf robots.yaml
git commit -m "feat(robot-hmi): mock_6dof URDF + register with robot_01"
```

---

### Task A9: Frontend — install 3D deps

**Files:** `src/frontend/package.json`, `src/frontend/package-lock.json`

- [ ] **Step 1: Install**

The npm cache has a known bad sub-tree owned by root (see PROGRESS.md notes). Use a temp cache:

```bash
cd src/frontend && npm install \
  @react-three/fiber@^8 \
  @react-three/drei@^9 \
  three@^0.155 \
  urdf-loader@^0.12 \
  --cache=/tmp/npm-cache-3dsim
```

If `urdf-loader@^0.12` is unavailable, install latest stable: `urdf-loader@latest`.

- [ ] **Step 2: Type-check sanity**

```bash
cd src/frontend && npx tsc --noEmit --pretty false --project tsconfig.json 2>&1 | grep -E "three|fiber|drei|urdf" | head -5
```
Expected: no errors mentioning these new packages.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/package.json src/frontend/package-lock.json
git commit -m "build(robot-hmi): add @react-three/fiber, drei, three, urdf-loader for 3D sim"
```

---

### Task A10: Frontend — /simulation route + nav link (placeholder)

**Files:**
- Modify: `src/frontend/src/routes.tsx`
- Modify: `src/frontend/src/components/core/appHeaderComponent/index.tsx`
- Create: `src/frontend/src/pages/SimulationPage/index.tsx` (placeholder)

- [ ] **Step 1: Placeholder page**

```tsx
// src/frontend/src/pages/SimulationPage/index.tsx
export default function SimulationPage() {
  return (
    <div className="flex h-full w-full flex-col p-6">
      <h1 className="mb-4 text-2xl font-semibold">3D 模擬</h1>
      <div className="text-muted-foreground">Loading simulation...</div>
    </div>
  );
}
```

- [ ] **Step 2: Wire route**

Modify `src/frontend/src/routes.tsx` — add import next to `ProgrammingPage` and route inside the same group as `/programming`:

```tsx
import SimulationPage from "./pages/SimulationPage";
// ...
<Route path="simulation" element={<SimulationPage />} />
```

- [ ] **Step 3: Add nav link**

In `src/frontend/src/components/core/appHeaderComponent/index.tsx`, copy an existing NavLink block (e.g., the 設定 one) and add a new entry between 程式編寫 and 設定:

```tsx
<NavLink
  to="/simulation"
  className={({ isActive }) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
      isActive
        ? "bg-muted text-primary"
        : "text-muted-foreground hover:text-primary"
    }`
  }
>
  3D 模擬
</NavLink>
```

- [ ] **Step 4: Type-check**

```bash
cd src/frontend && npx tsc --noEmit --pretty false --project tsconfig.json 2>&1 | grep -E "SimulationPage|simulation" | head -5
```
Expected: no errors.

- [ ] **Step 5: Visual check (optional)**

Start the frontend (in another terminal: `cd src/frontend && npm start`), navigate to `/simulation` — should see the placeholder.

- [ ] **Step 6: Commit**

```bash
git add src/frontend/src/routes.tsx \
        src/frontend/src/components/core/appHeaderComponent/index.tsx \
        src/frontend/src/pages/SimulationPage/index.tsx
git commit -m "feat(robot-hmi): /simulation route + nav link (placeholder page)"
```

---

### Task A11: Frontend — useUrdf hook

**Goal:** Fetch URDF + mesh base URL from the backend and parse with `urdf-loader`. Returns the parsed `URDFRobot`.

**Files:**
- Create: `src/frontend/src/pages/SimulationPage/hooks/useUrdf.ts`

- [ ] **Step 1: Implement the hook**

```ts
// src/frontend/src/pages/SimulationPage/hooks/useUrdf.ts
import { useEffect, useState } from "react";
import URDFLoader, { URDFRobot } from "urdf-loader";
import { LoadingManager } from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";

interface UrdfState {
  robot: URDFRobot | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
}

export function useUrdf(robotId: string | null): UrdfState {
  const [state, setState] = useState<UrdfState>({
    robot: null,
    status: "idle",
    error: null,
  });

  useEffect(() => {
    if (!robotId) {
      setState({ robot: null, status: "idle", error: null });
      return;
    }

    let cancelled = false;
    setState({ robot: null, status: "loading", error: null });

    (async () => {
      try {
        const res = await fetch(`/api/v1/robots/${robotId}/urdf`);
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          throw new Error(detail.detail ?? `HTTP ${res.status}`);
        }
        const { urdf_xml, mesh_base_url } = await res.json();
        if (cancelled) return;

        const manager = new LoadingManager();
        const loader = new URDFLoader(manager);
        loader.loadMeshCb = (path, mgr, done) => {
          // Strip any package:// or absolute prefix; pass relative to mesh_base_url
          const filename = path.replace(/^.*\//, "");
          const url = `${mesh_base_url}/${filename}`;
          const ext = filename.split(".").pop()?.toLowerCase();
          if (ext === "stl") {
            new STLLoader(mgr).load(url, (geo) => {
              const { Mesh, MeshStandardMaterial } = require("three");
              done(new Mesh(geo, new MeshStandardMaterial({ color: 0x999999 })));
            });
          } else if (ext === "dae") {
            new ColladaLoader(mgr).load(url, (col) => done(col.scene));
          } else {
            done(null);
          }
        };

        const robot = loader.parse(urdf_xml);
        manager.onLoad = () => {
          if (!cancelled) setState({ robot, status: "ready", error: null });
        };
        manager.onError = (url) => {
          if (!cancelled)
            setState({ robot: null, status: "error", error: `mesh load failed: ${url}` });
        };
        // Fallback in case onLoad never fires (no async meshes)
        if (!cancelled) setState({ robot, status: "ready", error: null });
      } catch (e: any) {
        if (!cancelled)
          setState({ robot: null, status: "error", error: e.message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [robotId]);

  return state;
}
```

> Note: `require("three")` inside `loadMeshCb` is a workaround for a circular import pattern; if Vite complains, replace with a top-level `import { Mesh, MeshStandardMaterial } from "three"`.

- [ ] **Step 2: Type-check**

```bash
cd src/frontend && npx tsc --noEmit --pretty false --project tsconfig.json 2>&1 | grep -E "useUrdf|SimulationPage" | head -10
```
Expected: no errors. If `urdf-loader` types are missing, add `// @ts-expect-error` on the import or install `@types/three`.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/src/pages/SimulationPage/hooks/useUrdf.ts
git commit -m "feat(robot-hmi): useUrdf hook — fetch + parse URDF, load STL meshes"
```

---

### Task A12: Frontend — Scene + RobotModel + SimulationPage shell

**Files:**
- Create: `src/frontend/src/pages/SimulationPage/components/Scene.tsx`
- Create: `src/frontend/src/pages/SimulationPage/components/RobotModel.tsx`
- Modify: `src/frontend/src/pages/SimulationPage/index.tsx`

- [ ] **Step 1: Scene**

```tsx
// src/frontend/src/pages/SimulationPage/components/Scene.tsx
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { ReactNode } from "react";

export function Scene({ children }: { children: ReactNode }) {
  return (
    <Canvas
      camera={{ position: [1.5, 1.5, 1.5], fov: 50 }}
      shadows
      style={{ background: "#1a1a1a" }}
    >
      <ambientLight intensity={0.3} />
      <directionalLight position={[3, 5, 2]} intensity={1.0} castShadow />
      <Grid
        args={[10, 10]}
        cellSize={0.1}
        cellThickness={0.5}
        sectionSize={1}
        sectionThickness={1}
        infiniteGrid
      />
      <axesHelper args={[0.5]} />
      <OrbitControls makeDefault />
      {children}
    </Canvas>
  );
}
```

- [ ] **Step 2: RobotModel**

```tsx
// src/frontend/src/pages/SimulationPage/components/RobotModel.tsx
import { useEffect, useRef } from "react";
import type { URDFRobot } from "urdf-loader";

interface Props {
  robot: URDFRobot;
  jointsDeg: number[];
}

const JOINT_NAMES = ["j1", "j2", "j3", "j4", "j5", "j6"];

export function RobotModel({ robot, jointsDeg }: Props) {
  const ref = useRef<URDFRobot | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    JOINT_NAMES.forEach((name, i) => {
      const value = (jointsDeg[i] ?? 0) * (Math.PI / 180);
      ref.current!.setJointValue(name, value);
    });
  }, [jointsDeg]);

  return (
    <primitive
      object={robot}
      ref={(o: URDFRobot) => { ref.current = o; }}
      // URDF Z-up → R3F Y-up
      rotation={[-Math.PI / 2, 0, 0]}
    />
  );
}
```

- [ ] **Step 3: SimulationPage — Live mode hardcoded**

Replace `src/frontend/src/pages/SimulationPage/index.tsx`:

```tsx
import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Scene } from "./components/Scene";
import { RobotModel } from "./components/RobotModel";
import { useUrdf } from "./hooks/useUrdf";

export default function SimulationPage() {
  const [robots, setRobots] = useState<string[]>([]);
  const [robotId, setRobotId] = useState<string>("");
  const { robot, status, error } = useUrdf(robotId || null);
  const [joints, setJoints] = useState<number[]>([0, 0, 0, 0, 0, 0]);

  // robots list
  useEffect(() => {
    fetch("/api/v1/robots")
      .then((r) => r.json())
      .then((list: { robot_id: string }[]) => {
        setRobots(list.map((r) => r.robot_id));
        if (list.length > 0 && !robotId) setRobotId(list[0].robot_id);
      })
      .catch(() => {});
  }, []);

  // Live joint state via WS
  useEffect(() => {
    if (!robotId) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/api/v1/robots/ws/${robotId}`);
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (Array.isArray(d.joints) && d.joints.length === 6) setJoints(d.joints);
      } catch {}
    };
    return () => ws.close();
  }, [robotId]);

  return (
    <div className="flex h-full w-full flex-col p-6">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-2xl font-semibold">3D 模擬</h1>
        <Select value={robotId} onValueChange={setRobotId}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="選擇機器人" />
          </SelectTrigger>
          <SelectContent>
            {robots.map((id) => (
              <SelectItem key={id} value={id}>{id}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">Live 模式</span>
      </div>

      <div className="relative flex-1 overflow-hidden rounded-md border">
        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            載入 URDF...
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center text-destructive">
            URDF 載入失敗：{error}
          </div>
        )}
        {status === "ready" && robot && (
          <Scene>
            <RobotModel robot={robot} jointsDeg={joints} />
          </Scene>
        )}
        {!robotId && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            請選擇機器人
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Type-check**

```bash
cd src/frontend && npx tsc --noEmit --pretty false --project tsconfig.json 2>&1 | grep -E "SimulationPage|RobotModel|Scene" | head -10
```
Expected: no errors.

- [ ] **Step 5: Visual smoke test**

In two terminals:

```bash
# Terminal 1 — backend
cd /Users/kenhuang/Desktop/Dev/robot-hmi && \
  PYTHONPATH=src/backend/base:src/lfx/src .venv/bin/uvicorn \
    --factory langflow.main:create_app --host 0.0.0.0 --port 7860 --loop asyncio

# Terminal 2 — frontend
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && npm start
```

Open `http://localhost:3000/simulation` (or 3001 if 3000 is taken). Expected:
- 3D scene renders (grid + axes + arm in dark background)
- `robot_01` is selectable in the dropdown
- The arm appears (initial joints = `[0,0,0,0,0,0]`)
- Selecting `robot_02` → URDF load error banner ("Robot 'robot_02' has no URDF configured")
- Issue an API call (`curl -X POST http://localhost:7860/api/v1/robots/robot_01/command -H "Content-Type: application/json" -d '{"cmd":"MOVE","params":{"j1":45,"j2":-30}}'`) → arm visibly rotates joint 1 by 45° and joint 2 by –30°.

- [ ] **Step 6: Commit**

```bash
git add src/frontend/src/pages/SimulationPage/
git commit -m "feat(robot-hmi): /simulation Live mode — 3D viewer mirrors WS joint state"
```

---

### Task A13: Update PROGRESS.md and push

**Files:**
- Modify: `/Users/kenhuang/Desktop/Dev/PROGRESS.md`

- [ ] **Step 1: Update Phase A entry in PROGRESS.md**

Edit the `Status` block to set Phase to `P5 Phase A 完成 — 3D 模擬基礎架構`. Append to "What was just completed" a P5-A section listing the files added/modified.

- [ ] **Step 2: Push**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi
git push origin main
```

After push succeeds, update PROGRESS.md with the new commit hashes from `git log --oneline c43b4bb..HEAD` and commit/push that update separately (or amend into the last commit only if the user explicitly authorizes).

---

## Phase A Verification Checklist

When all of A1–A13 are done, verify:

- [ ] `cd src/backend && uv run pytest tests/unit/robot/ tests/unit/api/v1/test_robots_urdf.py -v` — all green
- [ ] `cd src/frontend && npx tsc --noEmit --pretty false --project tsconfig.json` — no errors in any `SimulationPage*` file
- [ ] Backend serves `/api/v1/robots/robot_01/urdf` (200) and `/api/v1/robots/meshes/robot_01/base.stl` (200)
- [ ] Backend rejects `/api/v1/robots/meshes/robot_01/../../../etc/passwd` (403/404)
- [ ] `/simulation` page renders the arm in 3D
- [ ] Sending `MOVE` via REST visibly moves the arm in the 3D viewer (via WS broadcast)
- [ ] `robot_02` (no URDF) shows the "未設定 URDF" error gracefully

---

## Phase B — FK Drag + Mode Switching (Roadmap)

After Phase A is verified, plan B with /writing-plans for full TDD detail. Outline:

- **B1** — `useSimMode` hook: track `mode: "Offline"|"Live"|"Sync"|"Sandbox"`, manage WS subscription.
- **B2** — `useJointState` hook: source switches by mode (WS for Live/Sync, local for Offline/Sandbox), exposes `setJoints` and `commitToRobot`.
- **B3** — `<ModeTabs>` component: segmented control on the page header. Sync transition opens a confirm dialog.
- **B4** — Offline / Sandbox snap-on-mount logic (Offline = snap to current WS state once then disconnect; Sandbox = no snap).
- **B5** — `<JointDragHandles>` component: drei `<Sphere>` per joint, `onPointerDown` + drag → rotate joint within URDF limits.
- **B6** — Sync mode debounced `MOVE` command emission (250ms debounce).
- **B7** — Tests: `useJointState` mode transitions; `useSimMode` WS connect/disconnect lifecycle.
- **B8** — Visual smoke per mode.

ETA: ~3 days.

---

## Phase C — IK Solver + 6DOF Gizmo (Roadmap)

- **C1** — Extract DH-equivalent params from URDF at load time, detect spherical wrist.
- **C2** — `useIKSolver` analytical 6-DOF solver (Pieper's method) — pure TS, ~80 lines.
- **C3** — Multi-solution selection: minimize `Σ Δθᵢ²` against current joints; respect joint limits.
- **C4** — CCD fallback for non-spherical-wrist URDFs.
- **C5** — `<IKGizmo>` using drei `<TransformControls>` bound to TCP frame; on change, solve IK and update joints.
- **C6** — FK / IK toggle in the UI (segmented control next to mode tabs).
- **C7** — Singularity / unreachable indication (gizmo flashes red 200ms; no joint update).
- **C8** — Tests: IK round-trip (FK then IK should recover joints); reach limits return null.

ETA: ~5 days.

---

## Phase D — Collision Detection (Roadmap)

- **D1** — Build `MeshBVH` per link mesh at URDF load (cache).
- **D2** — `useCollision` hook: after each joint update, run pairwise BVH-vs-BVH for non-adjacent link pairs (10 pairs for 6 links).
- **D3** — `<CollisionViz>` component: paint colliding links red via material override; emit toast.
- **D4** — Drag-revert: when FK / IK drag would cause collision, reject the update.
- **D5** — Sync mode: also block command emission on collision.
- **D6** — Tests: synthetic two-link case (force overlap, assert detection); inflation tolerance.

ETA: ~2 days.

---

## Phase E — Trajectory Playback (Roadmap)

- **E1** — Backend `POST /api/v1/robots/run/stream` SSE: emit `step_start{line, joints_before}` → `step_end{line, joints_after, success}` → `done{log}` / `error{detail}`. Reuses the line interpreter from `/run`.
- **E2** — Tests: SSE event ordering, error halt, success close.
- **E3** — `useScriptPlayback` hook: consume SSE, queue keyframes, tween joints with cubic-ease over `250ms / playback_speed`.
- **E4** — `<TrajectoryTrail>` component: drei `<Line>` accumulating TCP world position each frame; clear button.
- **E5** — `<PlaybackControls>` component: Play / Pause / Step ± / Speed segmented (0.25× – 4×).
- **E6** — Disable playback controls outside Offline mode.

ETA: ~3 days.

---

## Phase F — Sync Mode Safety (Roadmap)

- **F1** — Sync mode confirm dialog on activation.
- **F2** — `<EmergencyStop>` button visible only in Sync mode; sends `HOME` and reverts to Live.
- **F3** — Debounced command emission already in place (Phase B); validate behaviour under rapid drag.
- **F4** — Visual indicator that drag is influencing the real robot (e.g., red ring around the canvas).
- **F5** — End-to-end test: drag in Sync, observe mock adapter's joint state via WS, confirm convergence.

ETA: ~2 days.

---

## Self-Review (done)

- ✅ Spec coverage: every numbered section in the spec maps to either Phase A tasks (file paths, modes scaffolding, URDF endpoint, mesh endpoint, mock asset, /simulation page, Live mode) or to the roadmap entries (B–F).
- ✅ No placeholders: every code-bearing step contains complete code.
- ✅ Type consistency: `urdf_path` / `mesh_dir` are typed `Path | None` everywhere; `RobotConfigBody` extra fields default to `None`; `useUrdf` returns `{robot, status, error}` consistently; joints are `number[]` of length 6 throughout.
- ✅ Mock adapter behaviour change is documented in A2 with tests covering `MOVE` / `HOME` / `JOG` / `GRIPPER`.
