# 3D Simulation Environment — Design Spec

**Date:** 2026-05-09
**Author:** Ken Huang (with Claude)
**Status:** Approved for implementation
**Implements:** P5 (Robot HMI roadmap)

---

## Goal

Add a runtime 3D simulation environment to the Robot HMI that supports four
usage modes — **Offline** (verify scripts before sending to the real robot),
**Live** (mirror the real robot's joint state), **Sync** (digital twin —
drag in 3D to drive the real robot), and **Sandbox** (free exploration with
no robot in the loop) — and offers two manipulation paradigms — **forward
kinematics drag** (rotate a joint) and **inverse kinematics drag** with a
**6DOF gizmo** on the TCP. The implementation also delivers **collision
detection** between links and **trajectory playback** of executed scripts.

This spec covers the full P5 scope: architecture, components, endpoints,
state model, IK strategy, collision strategy, playback strategy, phasing,
testing, and dependencies.

## Non-Goals

- **Multi-robot scene composition.** One robot at a time per page.
- **Photo-realistic rendering.** PBR materials are nice-to-have; functional clarity wins.
- **Workspace / fixture / part modelling.** Only the robot itself is rendered. Fixtures are P6.
- **Path planning / trajectory optimisation.** Playback animates the script as written; it does not re-plan around collisions.
- **Servoing modes (force, vision).** Out of scope.
- **Physics simulation (gravity, contact dynamics).** Pure kinematics.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ Browser — /simulation page                                      │
│                                                                 │
│  ┌────────────┐  ┌────────────┐  ┌─────────────────────────┐    │
│  │ Mode tab   │  │ Robot pick │  │ Playback / FK·IK toggle │    │
│  └─────┬──────┘  └────────────┘  └────────────┬────────────┘    │
│        │                                      │                 │
│  ┌─────▼──────────────────────────────────────▼────────────┐    │
│  │  R3F Canvas                                             │    │
│  │   ├─ RobotModel (URDF, joints bound to state)           │    │
│  │   ├─ JointDragHandles (FK)                              │    │
│  │   ├─ IKGizmo (TransformControls on TCP)                 │    │
│  │   ├─ CollisionViz (red highlight + toast)               │    │
│  │   └─ TrajectoryTrail (TCP line accumulation)            │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Hooks:                                                         │
│   useUrdf  ─ loads URDF + meshes from backend                   │
│   useSimMode ─ owns mode + side effects (WS sub, command emit)  │
│   useIKSolver ─ analytical 6-DOF (spherical wrist), CCD fallback│
│   useScriptPlayback ─ consumes /run/stream SSE, tweens joints   │
└─────────────────────────────────────────────────────────────────┘
        ▲                       ▲                       │
        │                       │                       │ (Sync mode)
        │ /urdf, /meshes/*      │ /ws/{id}              │ POST /command
        │                       │                       ▼
┌─────────────────────────────────────────────────────────────────┐
│ Langflow backend (FastAPI)                                      │
│                                                                 │
│  Existing: /robots, /status, /command, /run, /nl-program/*, /ws │
│  NEW:                                                           │
│   GET  /robots/{id}/urdf                                        │
│   GET  /robots/meshes/{robot_id}/{filename}                     │
│   POST /robots/run/stream                                       │
│                                                                 │
│  Adapter interface gains: urdf_path, mesh_dir                   │
│  Mock adapter ships with robots/mock_6dof/ URDF + meshes        │
└─────────────────────────────────────────────────────────────────┘
```

**Key invariants:**

- **One source of truth for live joint state**: the backend's adapter (when in Live or Sync mode the frontend reads it via WS).
- **Sim and robot states diverge intentionally** in Offline/Sandbox modes — the user expects this.
- **No IK or collision logic on the backend.** Both run in the browser, on the user's machine, where they're cheap and fast.

---

## Modes — Detailed Behaviour

| Mode | WS subscription | FK drag | IK gizmo | Sends commands | Use case |
|---|---|---|---|---|---|
| **Offline** | off | local sim | local sim | no — manual "送到真機" button after preview | verify a script before running on robot |
| **Live** | on (read-only) | disabled | disabled | no | dashboard / observation |
| **Sync** | on | yes — debounced `MOVE` | yes — debounced `MOVE` | yes (250ms debounce) | digital twin / hand-guiding |
| **Sandbox** | off | local sim | local sim | no | training, free exploration |

**Mode transitions:**

- Default mode on page open: **Live**.
- Switching **into Sync** opens a confirmation dialog (`「同步模式會把 3D 操作直接發到真機。確定？」`).
- Switching **out of Sync** silently — sim state freezes at last value.
- Switching **into Live** snaps sim joints to current robot state immediately.
- Switching **into Offline** snaps sim joints to current robot state, then disconnects WS.
- Switching **into Sandbox** does *not* snap — keeps whatever joint state was visible.

**Sync mode safety:**

- Debounce 250ms on FK / IK drag → coalesces fast drags into one `MOVE` command.
- IK no-solution: gizmo flashes red, no command sent.
- Collision detected: drag rejected, no command sent.
- "緊急停止" button visible top-right whenever in Sync — sends `HOME` and reverts to Live.

---

## URDF & Asset Loading

### Backend

**`GET /api/v1/robots/{robot_id}/urdf`** returns:

```json
{
  "urdf_xml": "<robot ...>...</robot>",
  "mesh_base_url": "/api/v1/robots/meshes/<robot_id>"
}
```

- 404 if the adapter has no `urdf_path` configured.
- The XML is returned verbatim. Mesh refs inside (`package://...` or relative paths) are rewritten by the **frontend** loader using `mesh_base_url`, not by the backend.

**`GET /api/v1/robots/meshes/{robot_id}/{filename:path}`** serves mesh files:

- **Path traversal protection**: resolve final path with `Path(...).resolve()`, assert it's `relative_to(adapter.mesh_dir.resolve())`. Else 403.
- Streams binary content with appropriate `Content-Type` (STL → `model/stl`, DAE → `model/vnd.collada+xml`, GLB → `model/gltf-binary`, fallback `application/octet-stream`).

### Adapter interface additions

```python
class RobotAdapter(ABC):
    ...
    @property
    def urdf_path(self) -> Path | None: ...
    @property
    def mesh_dir(self) -> Path | None: ...
```

Default returns `None` (no 3D model). Mock adapter implements both, pointing at `robots/mock_6dof/`.

### Default mock asset

Add to repo:

```
robots/mock_6dof/
├── mock_6dof.urdf            ← simple 6 revolute joints, spherical wrist
└── meshes/
    ├── base.stl
    ├── link1.stl
    ├── link2.stl
    ├── link3.stl
    ├── link4.stl
    ├── link5.stl
    ├── link6.stl
    └── tcp.stl
```

Meshes are box / cylinder primitives, generated programmatically (small repo footprint, ~30KB total). A `scripts/gen_mock_meshes.py` produces them from cube/cylinder primitives so the repo stays small and the file is regenerable.

**Mock adapter behaviour change:** the existing mock adapter simulates sinusoidal
joint motion regardless of commands, which would make trajectory playback
noisy. For the 3D sim, the mock adapter is updated so that `MOVE` actually
sets the reported joints (i.e. `get_status()` returns the last commanded
target, with a small linear ramp toward it). The sinusoidal animation is
removed. This is a behaviour change to the existing mock and is part of
Phase A.

`robots.yaml` gains optional fields per robot:

```yaml
robots:
  robot_01:
    adapter: MyRobotAdapter
    host: "192.168.1.10"
    port: 8080
    urdf_path: "robots/mock_6dof/mock_6dof.urdf"     # optional
    mesh_dir: "robots/mock_6dof/meshes"              # optional
```

The registry passes these through to the adapter constructor.

### Frontend loader

`useUrdf(robotId)` hook:

1. `fetch('/api/v1/robots/{id}/urdf')` → `{urdf_xml, mesh_base_url}`.
2. Parse with `urdf-loader` (https://github.com/gkjohnson/urdf-loaders) — supports STL, DAE, GLB.
3. Mesh URL hook rewrites `package://` and relative paths to `${mesh_base_url}/<filename>`.
4. Cache: keyed by `robotId`. Live state changes do not retrigger load.

Returns `{robot: URDFRobot | null, status: "loading" | "ready" | "error", error: string | null}`.

---

## Frontend Component Inventory

```
src/frontend/src/pages/SimulationPage/
├── index.tsx                       ← page shell, layout, mode tab, robot picker
├── components/
│   ├── Scene.tsx                   ← R3F Canvas + lights, grid, world axes
│   ├── RobotModel.tsx              ← uses useUrdf, applies joint state
│   ├── JointDragHandles.tsx        ← per-joint clickable rings, drag rotates
│   ├── IKGizmo.tsx                 ← drei <TransformControls> on TCP
│   ├── CollisionViz.tsx            ← BVH pair tests, red overlay
│   ├── TrajectoryTrail.tsx         ← <Line> with growing point buffer
│   ├── PlaybackControls.tsx        ← Play/Pause/Step/Speed for /run/stream
│   ├── ModeTabs.tsx                ← Offline/Live/Sync/Sandbox segmented
│   └── EmergencyStop.tsx           ← visible only in Sync mode
└── hooks/
    ├── useUrdf.ts                  ← URDF + meshes loader
    ├── useIKSolver.ts              ← 6-DOF analytical, CCD fallback
    ├── useSimMode.ts               ← mode state + WS sub + command emitter
    ├── useJointState.ts            ← single source for current joints (per mode)
    ├── useCollision.ts             ← BVH manager
    └── useScriptPlayback.ts        ← /run/stream consumer + tween engine
```

### Joint state architecture

`useJointState()` returns `{joints: number[6], setJoints: (j) => void, source: "ws"|"local"}`. Source switches by mode:

- **Live / Sync**: `source: "ws"` — `setJoints` is a no-op when called from outside (Sync's drag bypasses by calling `setJoints(j, {emit: true})` which is allowed).
- **Offline / Sandbox**: `source: "local"` — fully local.

Drag handlers and IK gizmo always call `setJoints`. The hook decides whether to also fire the WS-bound command (Sync) or just update locally (others).

### Mode side-effects

`useSimMode(mode, robotId)`:

- On mount / mode change:
  - **Offline**: snap to current robot state (one fetch), no subscription.
  - **Live / Sync**: open WS to `/api/v1/robots/ws/{id}`, push messages into `useJointState`.
  - **Sandbox**: do nothing.
- On unmount: close WS if open.

---

## IK Solver

### Strategy

**6-DOF spherical wrist** is the common case for industrial 6-axis arms (TM Robot, UR, Fanuc, ABB). When the URDF's last three joint axes intersect at a point, an analytical solution exists with up to 8 distinct solutions (shoulder L/R × elbow up/down × wrist flip).

### Implementation

`useIKSolver(robot: URDFRobot)` returns `(target_pose: Mat4, current: number[6]) => number[6] | null`.

Steps:

1. **At hook init**: walk the URDF, extract DH-equivalent parameters (joint axes, link offsets, joint limits). Detect spherical wrist (last 3 axes intersect within ε). Cache.
2. **At call time** (with `target_pose` = desired TCP pose, `current` = current joints):
   - If spherical wrist: closed-form solve (Pieper's method) → up to 8 candidate joint sets.
   - Filter by joint limits.
   - Pick candidate with smallest `Σ (Δθᵢ)²` vs `current`.
   - If empty: return null (the gizmo handler will paint red).
3. **Fallback (non-spherical-wrist URDF)**: CCD (cyclic coordinate descent) — iterative, slower but robust. Bounded at 32 iters.

The solver is pure TypeScript (no WASM). Spherical-wrist 6-DOF solve is ~50 lines of math; CCD is ~30 lines.

### Singularities

- Wrist singularity (joints 4 & 6 align): gizmo allows movement but warns; solver picks any valid configuration.
- Shoulder / elbow singularities: solver returns null, gizmo flashes red.
- Reach limit: solver returns null.

---

## Collision Detection

### Approach

`three-mesh-bvh` builds a BVH per link mesh once at URDF load. After every joint state update:

1. Update each link's world transform (`URDFRobot.updateMatrixWorld()`).
2. For each non-adjacent link pair `(L_i, L_j)` with `|i-j| >= 2`, run `bvh.intersectsBox(otherBVH, transform)`.
3. Mark colliding links → `CollisionViz` overlays them red + emits a toast.

### Performance

- 6 links → 6×5/2 = 15 pairs, minus 5 adjacent = **10 pair tests** per frame max.
- BVH-vs-BVH on ~5K-tri meshes: ~0.2ms / pair on M1. Total <2ms — comfortably 60fps.
- BVHs stored in a `Map<URDFLink, MeshBVH>`, computed once.

### Behaviour on collision

- **FK / IK drag**: revert the proposed joint update, paint the colliding pair red briefly, toast `「會撞到 link4 / link6」`.
- **Playback**: do *not* revert — the script is what the user wrote. Highlight the collision red, log it, keep playing. (User can pause and inspect.)
- **Sync mode**: revert + do *not* emit command.

### Self-collision tolerance

A small inflation (`+2mm` on each BVH) prevents false positives at adjacent geometry edges.

---

## Trajectory Playback

### `POST /api/v1/robots/run/stream` (new SSE endpoint)

Same body as `/run`: `{robot_id, code}`. Emits SSE:

```
event: step_start
data: {"line": "MOVE j1=0 j2=...", "joints_before": [0,0,0,0,0,0]}

event: step_end
data: {"line": "MOVE j1=0 j2=...", "joints_after": [10,5,...], "success": true, "message": "..."}

event: done
data: {"log": [...]}

event: error
data: {"detail": "..."}
```

The endpoint runs the same line-by-line interpreter as `/run` but:

1. Fetches `joints_before` from `adapter.get_status()`.
2. Calls `adapter.send_command(...)` (real or mock).
3. Fetches `joints_after`.
4. Emits the events as it goes.

Existing `/run` is untouched — the streaming path is additive.

### Frontend playback

`useScriptPlayback({code, robotId})`:

1. Open SSE connection.
2. Maintain a queue of `{joints_before, joints_after}` pairs.
3. Tween from `joints_before` to `joints_after` over `250ms / playback_speed` per step (ease-in-out cubic).
4. Push TCP world position into trajectory buffer each frame.
5. Controls:
   - **Play/Pause**: pauses tween, keeps queue.
   - **Step ±1**: jumps to next / previous keyframe.
   - **Speed**: 0.25× to 4× (preset segmented control).
   - **Clear trail**: clears trajectory buffer.

Playback runs **only in Offline mode** (the only mode where script execution is sim-only). In Live/Sync the script would actually run on the robot — the trajectory trail still draws in real time from incoming WS state, but step controls are disabled.

---

## Phasing

Each phase ends with a working demo + commit + push.

| Phase | Deliverable | Verification | ETA |
|---|---|---|---|
| **A** | Backend `/urdf` + `/meshes/*`, `mock_6dof/` assets, `<RobotModel>` rendering, **Live mode** mirroring | Open `/simulation`, see arm follow `/ws/{id}` | 3 days |
| **B** | `JointDragHandles`, FK drag, **Sandbox** + **Offline** modes, mode tabs | Drag a joint in Sandbox, joints rotate visibly | 3 days |
| **C** | `useIKSolver` (spherical-wrist analytical), `<IKGizmo>` with TransformControls | Grab TCP gizmo, drag, joints solve | 5 days |
| **D** | `useCollision` + `<CollisionViz>` + drag-revert behaviour | Force two links to overlap, see red highlight | 2 days |
| **E** | `/run/stream`, `useScriptPlayback`, `<PlaybackControls>`, `<TrajectoryTrail>` | Run a 5-line script in Offline, watch playback + trail | 3 days |
| **F** | **Sync mode** + confirm dialog + emergency stop + debounced commands | Drag in Sync, real (mock) robot's WS state catches up | 2 days |

Total: ~18 working days.

---

## Dependencies

**New frontend deps** (via `npm install`):

```
@react-three/fiber@^8
@react-three/drei@^9
three@^0.155
urdf-loader@^0.12
three-mesh-bvh@^0.7
```

**No new backend deps** — FastAPI's `StreamingResponse` and `FileResponse` cover the new endpoints.

---

## Testing Strategy

### Backend

- `tests/test_robots_urdf.py`:
  - GET `/robots/{id}/urdf` returns expected XML for `mock_6dof`.
  - GET `/robots/meshes/{id}/{file}` serves the file.
  - **Path traversal**: GET `/robots/meshes/{id}/../../../etc/passwd` → 403.
  - 404 when adapter has no `urdf_path`.
- `tests/test_run_stream.py`:
  - Streaming endpoint emits `step_start` then `step_end` per line.
  - `done` event fires on success.
  - Error halts loop, emits `error` event.

### Frontend

- `useIKSolver` unit tests: feed known target poses, assert joints solve to expected values within 1e-4. Test reach limit (returns null).
- `useCollision`: synthetic two-link case, assert collision detected when overlapping, not when separated.
- `useSimMode`: mode transitions trigger correct WS connect / disconnect.
- Visual smoke: each phase ends with a manual `npm start` walkthrough, recorded in PROGRESS.md.

---

## Error Handling

| Failure | UX |
|---|---|
| Backend `/urdf` 404 | Page shows banner "此機器人尚未設定 3D 模型" + link to `/robot-config` |
| URDF parse error | Banner "URDF 解析失敗：<message>" |
| Mesh 404 | Per-mesh fallback to a primitive (red cube), other meshes still render |
| WS drop in Live/Sync | Auto-fall back to Offline mode, banner "失去連線，已切到離線模式" |
| IK no-solution | Gizmo flashes red 200ms, no joint update |
| Collision in drag | Joints don't update, toast 1.5s |
| `/run/stream` error mid-playback | Pause playback, banner with detail |

---

## Open / Deferred Questions

These are intentionally deferred to keep P5 scope contained.

- **Multiple robots in one scene** — deferred to P6.
- **Workspace fixtures / parts** — P6.
- **TCP offset / tool calibration UI** — P6.
- **Recording playback to file** — could be added in P5 if cheap; leaving out of MVP.
- **Mobile / touch gizmo support** — desktop only for v1.

---

## File Map (target end state)

```
robot-hmi/
├── robots/
│   └── mock_6dof/
│       ├── mock_6dof.urdf
│       └── meshes/*.stl
├── scripts/
│   └── gen_mock_meshes.py                              ← regenerable mock meshes
├── src/backend/base/langflow/
│   ├── api/v1/robots.py                                ← + /urdf, /meshes/*, /run/stream
│   └── robot/adapters/
│       ├── base.py                                     ← + urdf_path, mesh_dir props
│       └── my_robot.py                                 ← reads from registry config
└── src/frontend/src/
    ├── routes.tsx                                      ← + /simulation
    ├── components/core/appHeaderComponent/index.tsx    ← + 「3D 模擬」NavLink
    └── pages/SimulationPage/                           ← all new (see component inventory)
```

---

## Summary

A four-mode 3D simulation page (`/simulation`) layered on the existing
backend, with FK + IK manipulation, BVH-based collision detection, and SSE
trajectory playback. All the heavy logic (rendering, IK, collision) runs in
the browser; the backend only serves URDF + meshes and a streaming variant
of the script runner. Phases A–F each ship a working demo. Mock URDF +
meshes ship in-repo so the feature works out of the box, and per-robot URDF
paths in `robots.yaml` let real robot models slot in without code changes.
