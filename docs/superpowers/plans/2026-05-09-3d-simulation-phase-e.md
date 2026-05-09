# 3D Simulation — Phase E Implementation Plan (Trajectory Playback)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replay a robot script visually in 3D — paste code in Offline mode, watch the arm tween between each step's joint state, and see the TCP path accumulate as a coloured line. Backend gains an SSE variant of `/run`; frontend gains playback controls + a trajectory trail.

**Architecture:** A new `POST /api/v1/robots/run/stream` SSE endpoint reuses the existing line-by-line interpreter but streams `step_start{line, joints_before}` → `step_end{line, joints_after, success}` → `done{log}` events. The frontend `useScriptPlayback` hook consumes the SSE, queues keyframes, and tweens joints (cubic ease, configurable speed) through `useSimulator.setJoints` — the same path drag uses. A `<TrajectoryTrail>` component is mode-agnostic: each frame it samples the TCP world position and appends to a drei `<Line>`. A `<PlaybackPanel>` (textarea + Play / Pause / Speed / Clear) is shown only in Offline mode.

**Tech Stack:** FastAPI / SSE (backend), React 19 + TypeScript, `@react-three/fiber@9` (`useFrame`), `@react-three/drei@10` (`<Line>`), three@0.160, jest + RTL.

---

## Scope

This plan covers Phase E from the spec. Out of scope:
- Step-backward / scrub timeline — Play / Pause / Speed only for v1
- Trajectory persistence (saving/loading paths) — Phase F+
- Annotated trail (colour by speed, time markers) — v2 polish
- Real robot trajectory recording across long sessions (memory bound) — v2

5 tasks, ~3 days.

---

## File Structure

```
src/backend/base/langflow/api/v1/robots.py          ← modify: add /run/stream
src/backend/tests/unit/api/v1/test_robots_run_stream.py  ← NEW

src/frontend/src/pages/SimulationPage/
├── components/
│   ├── TrajectoryTrail.tsx                   ← NEW — accumulating Line of TCP positions
│   └── PlaybackPanel.tsx                     ← NEW — textarea + Play / Pause / Speed
├── hooks/
│   └── useScriptPlayback.ts                  ← NEW — SSE consumer + tween engine
└── index.tsx                                 ← modify: render trail (always) + panel (Offline)
```

---

## Task E1: Backend — POST /robots/run/stream SSE endpoint

**Files:**
- Modify: `src/backend/base/langflow/api/v1/robots.py`
- Test: `src/backend/tests/unit/api/v1/test_robots_run_stream.py` (create)

**Goal:** A streaming variant of `/run` that emits per-step events as the script executes. Existing `/run` is untouched.

- [ ] **Step 1: Write the failing test**

Create `src/backend/tests/unit/api/v1/test_robots_run_stream.py`:

```python
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

    # Expect step_start/step_end alternating per line, then a final done
    assert types[0] == "step_start"
    assert types[1] == "step_end"
    assert types[2] == "step_start"
    assert types[3] == "step_end"
    assert types[-1] == "done"

    # First step is HOME — joints_after should be all zeros
    home_end = events[1][1]
    assert home_end["line"] == "HOME"
    assert home_end["joints_after"] == [0.0] * 6
    assert home_end["success"] is True

    # Second step is MOVE — joints_after reflects the move
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
    # Only HOME should fire a step
    assert len(step_starts) == 1
    assert step_starts[0][1]["line"] == "HOME"


def test_run_stream_halts_on_failure(client, runnable_robot):
    # JOG with invalid joint name fails per the mock adapter
    code = "HOME\nJOG joint=X1 delta=5\nMOVE j1=99"
    with client.stream(
        "POST",
        "/api/v1/robots/run/stream",
        json={"robot_id": runnable_robot, "code": code},
    ) as r:
        body = r.read().decode("utf-8")
    events = _parse_sse(body)
    types = [e[0] for e in events]
    # HOME succeeds; JOG fails; MOVE never runs
    assert "step_end" in types
    failures = [e[1] for e in events if e[0] == "step_end" and not e[1]["success"]]
    assert len(failures) == 1
    assert "JOG" in failures[0]["line"]
    move_starts = [e for e in events if e[0] == "step_start" and "MOVE" in e[1]["line"]]
    assert len(move_starts) == 0
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/backend && uv run pytest tests/unit/api/v1/test_robots_run_stream.py -v
```
Expected: FAIL — endpoint not implemented (404 on POST).

- [ ] **Step 3: Implement the endpoint**

Edit `src/backend/base/langflow/api/v1/robots.py`. After the existing `run_program` function (which handles `/run`), add:

```python
@router.post("/run/stream")
async def run_program_stream(body: RunProgramRequest):
    """SSE variant of /run. Emits step_start / step_end / done / error events."""
    try:
        adapter = robot_registry.get(body.robot_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Robot '{body.robot_id}' not found")

    async def event_stream():
        log: list[dict] = []
        try:
            for raw_line in body.code.splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#"):
                    continue

                joints_before = list((await adapter.get_status()).joints)
                yield (
                    "event: step_start\n"
                    f"data: {json.dumps({'line': line, 'joints_before': joints_before})}\n\n"
                )

                parts = line.split()
                cmd = parts[0].upper()
                params: dict = {}
                for token in parts[1:]:
                    if "=" in token:
                        k, _, v = token.partition("=")
                        try:
                            params[k] = float(v)
                        except ValueError:
                            params[k] = v
                result = await adapter.send_command(cmd, params)
                joints_after = list((await adapter.get_status()).joints)
                step_log = {
                    "line": line,
                    "joints_after": joints_after,
                    "success": result.success,
                    "message": result.message,
                }
                log.append(step_log)
                yield (
                    "event: step_end\n"
                    f"data: {json.dumps(step_log)}\n\n"
                )
                if not result.success:
                    break

            yield (
                "event: done\n"
                f"data: {json.dumps({'robot_id': body.robot_id, 'log': log})}\n\n"
            )
        except Exception as e:  # noqa: BLE001
            yield (
                "event: error\n"
                f"data: {json.dumps({'detail': str(e)})}\n\n"
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```

`json` and `StreamingResponse` are already imported at the top of the file (added in Phase 4 streaming work). Verify with the first 12 lines of the file; if `json` is missing, add `import json` near the other imports.

- [ ] **Step 4: Run tests**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/backend && uv run pytest tests/unit/api/v1/test_robots_run_stream.py -v
```
Expected: 4 passed. (The `runnable_robot` fixture and `_parse_sse` helper are local to this file.)

- [ ] **Step 5: Run all robot tests to confirm no regressions**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/backend && uv run pytest tests/unit/robot/ tests/unit/api/v1/ -v
```
Expected: 29 passed (25 existing + 4 new).

- [ ] **Step 6: Commit**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi && \
  git add src/backend/base/langflow/api/v1/robots.py \
          src/backend/tests/unit/api/v1/test_robots_run_stream.py && \
  git commit -m "feat(robot-hmi): POST /robots/run/stream — SSE step events for playback"
```

---

## Task E2: useScriptPlayback hook + TrajectoryTrail component

**Files:**
- Create: `src/frontend/src/pages/SimulationPage/hooks/useScriptPlayback.ts`
- Create: `src/frontend/src/pages/SimulationPage/components/TrajectoryTrail.tsx`

**Goal:** The hook consumes the SSE endpoint, queues keyframes, and tweens through them by calling a setter callback. The trail samples the TCP world position every frame (R3F's `useFrame`) and renders a `<Line>` of the accumulated points.

- [ ] **Step 1: Build the playback hook**

Create `src/frontend/src/pages/SimulationPage/hooks/useScriptPlayback.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";

const STEP_DURATION_MS = 500;

interface Keyframe {
  line: string;
  jointsBefore: number[];
  jointsAfter: number[];
  success: boolean;
  message: string;
}

interface RawStepStart {
  line: string;
  joints_before: number[];
}

interface RawStepEnd {
  line: string;
  joints_after: number[];
  success: boolean;
  message: string;
}

export interface PlaybackLogEntry {
  line: string;
  success: boolean;
  message: string;
}

export type PlaybackStatus = "idle" | "loading" | "playing" | "paused" | "done" | "error";

export interface UseScriptPlayback {
  status: PlaybackStatus;
  speed: number;
  setSpeed: (s: number) => void;
  log: PlaybackLogEntry[];
  error: string | null;
  /** Start a playback. Cancels any current one. */
  play: (robotId: string, code: string) => void;
  /** Pause an ongoing playback. */
  pause: () => void;
  /** Resume a paused playback. */
  resume: () => void;
  /** Stop and reset. */
  stop: () => void;
}

interface Props {
  /** Called with each tween joint update during playback. */
  onJoints: (jointsDeg: number[]) => void;
}

/** Linear ease in/out cubic. */
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function useScriptPlayback({ onJoints }: Props): UseScriptPlayback {
  const [status, setStatus] = useState<PlaybackStatus>("idle");
  const [speed, setSpeed] = useState(1);
  const [log, setLog] = useState<PlaybackLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const keyframesRef = useRef<Keyframe[]>([]);
  const indexRef = useRef(0);
  const stepStartTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const onJointsRef = useRef(onJoints);
  onJointsRef.current = onJoints;

  const cleanup = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const tick = useCallback(() => {
    rafRef.current = null;
    if (status !== "playing") return;
    const idx = indexRef.current;
    const kfs = keyframesRef.current;
    if (idx >= kfs.length) {
      setStatus("done");
      return;
    }
    const kf = kfs[idx];
    const start = stepStartTimeRef.current ?? performance.now();
    if (stepStartTimeRef.current === null) stepStartTimeRef.current = start;
    const elapsed = performance.now() - start;
    const duration = STEP_DURATION_MS / Math.max(0.01, speedRef.current);
    const t = Math.min(1, elapsed / duration);
    const eased = easeInOut(t);
    const joints = kf.jointsBefore.map(
      (b, i) => b + (kf.jointsAfter[i] - b) * eased,
    );
    onJointsRef.current(joints);

    if (t >= 1) {
      indexRef.current = idx + 1;
      stepStartTimeRef.current = null;
      setLog((prev) => [
        ...prev,
        { line: kf.line, success: kf.success, message: kf.message },
      ]);
      if (!kf.success) {
        setStatus("error");
        setError(kf.message);
        return;
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [status]);

  useEffect(() => {
    if (status === "playing" && rafRef.current === null) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [status, tick]);

  const play = useCallback(
    (robotId: string, code: string) => {
      cleanup();
      keyframesRef.current = [];
      indexRef.current = 0;
      stepStartTimeRef.current = null;
      setLog([]);
      setError(null);
      setStatus("loading");

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      (async () => {
        try {
          const res = await fetch("/api/v1/robots/run/stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ robot_id: robotId, code }),
            signal: ctrl.signal,
          });
          if (!res.ok || !res.body) {
            throw new Error(`HTTP ${res.status}`);
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let pendingStart: RawStepStart | null = null;

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split("\n\n");
            buffer = frames.pop() ?? "";
            for (const frame of frames) {
              const ev = frame
                .split("\n")
                .find((l) => l.startsWith("event:"))
                ?.slice("event:".length)
                .trim();
              const data = frame
                .split("\n")
                .find((l) => l.startsWith("data:"))
                ?.slice("data:".length)
                .trim();
              if (!ev || !data) continue;
              const parsed = JSON.parse(data);
              if (ev === "step_start") {
                pendingStart = parsed as RawStepStart;
              } else if (ev === "step_end" && pendingStart) {
                const end = parsed as RawStepEnd;
                keyframesRef.current.push({
                  line: end.line,
                  jointsBefore: pendingStart.joints_before,
                  jointsAfter: end.joints_after,
                  success: end.success,
                  message: end.message,
                });
                pendingStart = null;
                if (status !== "playing") setStatus("playing");
              } else if (ev === "error") {
                setError(parsed.detail ?? "stream error");
                setStatus("error");
                return;
              }
            }
          }
          // If we never transitioned (empty script), settle into "done"
          if (keyframesRef.current.length === 0) setStatus("done");
        } catch (e: any) {
          if (e?.name === "AbortError") return;
          setError(e?.message ?? String(e));
          setStatus("error");
        }
      })();
    },
    [cleanup, status],
  );

  const pause = useCallback(() => {
    if (status === "playing") {
      // Stash how far into the current step we are by adjusting stepStartTimeRef
      const start = stepStartTimeRef.current;
      if (start !== null) {
        const elapsed = performance.now() - start;
        // We'll resume by remembering elapsed; on resume, set start = now - elapsed
        stepStartTimeRef.current = -elapsed;
      }
      setStatus("paused");
    }
  }, [status]);

  const resume = useCallback(() => {
    if (status === "paused") {
      const stored = stepStartTimeRef.current;
      if (stored !== null && stored < 0) {
        stepStartTimeRef.current = performance.now() + stored; // stored is negative elapsed
      }
      setStatus("playing");
    }
  }, [status]);

  const stop = useCallback(() => {
    cleanup();
    keyframesRef.current = [];
    indexRef.current = 0;
    stepStartTimeRef.current = null;
    setStatus("idle");
    setLog([]);
    setError(null);
  }, [cleanup]);

  return { status, speed, setSpeed, log, error, play, pause, resume, stop };
}
```

- [ ] **Step 2: Build TrajectoryTrail**

Create `src/frontend/src/pages/SimulationPage/components/TrajectoryTrail.tsx`:

```tsx
import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Vector3 } from "three";
import type { URDFRobot } from "urdf-loader/src/URDFClasses";

interface Props {
  robot: URDFRobot;
  /** True to record points; false freezes the trail. */
  recording: boolean;
  /** Bumping this number clears the buffer. */
  clearKey?: number;
  /** Cap on stored points (~5 minutes at 30 Hz). */
  maxPoints?: number;
}

const TCP_LINK = "tcp";
const SAMPLE_INTERVAL_MS = 33; // ~30 Hz
const MIN_DELTA = 0.002; // skip points within 2 mm to avoid clutter

export function TrajectoryTrail({
  robot,
  recording,
  clearKey = 0,
  maxPoints = 6000,
}: Props) {
  const pointsRef = useRef<Vector3[]>([]);
  const lastSampleRef = useRef(0);
  const lastClearKeyRef = useRef(clearKey);

  useFrame((state) => {
    if (lastClearKeyRef.current !== clearKey) {
      pointsRef.current = [];
      lastClearKeyRef.current = clearKey;
    }
    if (!recording) return;
    const now = state.clock.elapsedTime * 1000;
    if (now - lastSampleRef.current < SAMPLE_INTERVAL_MS) return;
    lastSampleRef.current = now;
    const tcp = (robot as any).links?.[TCP_LINK];
    if (!tcp) return;
    const v = new Vector3();
    tcp.getWorldPosition(v);
    const last = pointsRef.current[pointsRef.current.length - 1];
    if (last && last.distanceTo(v) < MIN_DELTA) return;
    pointsRef.current.push(v);
    if (pointsRef.current.length > maxPoints) {
      pointsRef.current.splice(0, pointsRef.current.length - maxPoints);
    }
  });

  if (pointsRef.current.length < 2) return null;
  return (
    <Line
      points={pointsRef.current.map((v) => [v.x, v.y, v.z]) as any}
      color="#33ccff"
      lineWidth={2}
      transparent
      opacity={0.7}
    />
  );
}
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && \
  npx tsc --noEmit --pretty false --project tsconfig.json 2>&1 | grep -iE "useScriptPlayback|TrajectoryTrail" | head -10
```
Expected: 0 errors. If drei `<Line>` props complain (R3F 9 + drei 10 typing differs slightly), apply narrow casts: `points={... as any}` is already in the snippet.

- [ ] **Step 4: Run jest**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && npx jest src/pages/SimulationPage/__tests__ 2>&1 | tail -5
```
Expected: 35 passed (no test changes; this is a regression check).

- [ ] **Step 5: Commit**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi && \
  git add src/frontend/src/pages/SimulationPage/hooks/useScriptPlayback.ts \
          src/frontend/src/pages/SimulationPage/components/TrajectoryTrail.tsx && \
  git commit -m "feat(robot-hmi): script playback hook + TCP trajectory trail"
```

---

## Task E3: PlaybackPanel component

**Files:**
- Create: `src/frontend/src/pages/SimulationPage/components/PlaybackPanel.tsx`

**Goal:** A side panel with a textarea for the script, Play/Pause/Stop buttons, a Speed selector (0.25× to 4×), Clear-trail button, and a per-line log.

- [ ] **Step 1: Build the panel**

Create `src/frontend/src/pages/SimulationPage/components/PlaybackPanel.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import type { PlaybackLogEntry, PlaybackStatus } from "../hooks/useScriptPlayback";

const STARTER = `# Script: HOME, MOVE joints, GRIPPER state, WAIT seconds, JOG one joint
HOME
WAIT duration=0.5
MOVE j1=45 j2=-30 j3=60 j4=0 j5=90 j6=0
GRIPPER state=close
MOVE j1=-45 j2=-30 j3=60 j4=0 j5=90 j6=0
GRIPPER state=open
HOME
`;

const SPEEDS = [0.25, 0.5, 1, 2, 4];

interface Props {
  robotId: string;
  status: PlaybackStatus;
  speed: number;
  log: PlaybackLogEntry[];
  error: string | null;
  onPlay: (robotId: string, code: string) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSpeedChange: (s: number) => void;
  onClearTrail: () => void;
}

export function PlaybackPanel({
  robotId,
  status,
  speed,
  log,
  error,
  onPlay,
  onPause,
  onResume,
  onStop,
  onSpeedChange,
  onClearTrail,
}: Props) {
  const [code, setCode] = useState(STARTER);

  const isPlaying = status === "playing";
  const isPaused = status === "paused";
  const canStart = status === "idle" || status === "done" || status === "error";

  return (
    <div className="flex h-full w-72 shrink-0 flex-col gap-2 rounded-md border p-3">
      <div className="text-sm font-semibold">軌跡回放（離線）</div>

      <Textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="flex-1 resize-none font-mono text-xs"
        placeholder="輸入腳本..."
      />

      <div className="flex items-center gap-1">
        {canStart && (
          <Button
            size="sm"
            onClick={() => onPlay(robotId, code)}
            disabled={!robotId || !code.trim()}
            className="flex-1"
          >
            ▶ 播放
          </Button>
        )}
        {isPlaying && (
          <Button size="sm" variant="outline" onClick={onPause} className="flex-1">
            ⏸ 暫停
          </Button>
        )}
        {isPaused && (
          <Button size="sm" onClick={onResume} className="flex-1">
            ▶ 繼續
          </Button>
        )}
        {(isPlaying || isPaused) && (
          <Button size="sm" variant="outline" onClick={onStop}>
            停止
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">速度</span>
        <Select
          value={String(speed)}
          onValueChange={(v) => onSpeedChange(Number(v))}
        >
          <SelectTrigger className="h-8 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SPEEDS.map((s) => (
              <SelectItem key={s} value={String(s)}>
                {s}×
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={onClearTrail}>
          清除軌跡
        </Button>
      </div>

      <div className="rounded border p-2">
        <div className="mb-1 text-xs font-medium text-muted-foreground">輸出</div>
        <div className="max-h-40 overflow-y-auto font-mono text-xs space-y-1">
          {error && <div className="text-destructive">錯誤: {error}</div>}
          {log.length === 0 && !error && (
            <div className="text-muted-foreground">尚未播放</div>
          )}
          {log.map((entry, i) => (
            <div
              key={i}
              className={entry.success ? "text-green-400" : "text-destructive"}
            >
              {entry.success ? "✓" : "✗"} {entry.line}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && \
  npx tsc --noEmit --pretty false --project tsconfig.json 2>&1 | grep -iE "PlaybackPanel" | head -5
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi && \
  git add src/frontend/src/pages/SimulationPage/components/PlaybackPanel.tsx && \
  git commit -m "feat(robot-hmi): PlaybackPanel — script textarea + Play/Pause/Speed"
```

---

## Task E4: Wire trail + panel into SimulationPage

**Files:**
- Modify: `src/frontend/src/pages/SimulationPage/index.tsx`

**Goal:** Render `<TrajectoryTrail>` always (it's mode-agnostic and just records the TCP path). Render `<PlaybackPanel>` only in Offline mode. During playback, the hook calls `setJoints` to drive the arm; in other modes the panel is hidden.

- [ ] **Step 1: Edit index.tsx**

Add imports:

```tsx
import { useState } from "react";  // already imported, ensure useState is present
import { PlaybackPanel } from "./components/PlaybackPanel";
import { TrajectoryTrail } from "./components/TrajectoryTrail";
import { useScriptPlayback } from "./hooks/useScriptPlayback";
```

Add state for the trail's clear-key and instantiate playback:

```tsx
const [trailClearKey, setTrailClearKey] = useState(0);
const playback = useScriptPlayback({
  onJoints: (jointsDeg) => setJoints(jointsDeg),
});
```

Inside `<Scene>`, after `<RobotModel>`, add:

```tsx
<TrajectoryTrail
  robot={robot}
  recording={mode === "Live" || mode === "Sync" || playback.status === "playing"}
  clearKey={trailClearKey}
/>
```

Wrap the existing scene + panel in a flex row so the panel sits to the side. Replace the existing `<div className="relative flex-1 overflow-hidden rounded-md border">` block. The full body becomes:

```tsx
<div className="flex flex-1 min-h-0 gap-3">
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
        {dragMode === "FK" && (
          <JointDragHandles
            robot={robot}
            jointsDeg={joints}
            enabled={dragEnabled}
            onJointsChange={setJoints}
            wouldCollide={wouldCollide}
          />
        )}
        {dragMode === "IK" && (
          <IKGizmo
            robot={robot}
            jointsDeg={joints}
            enabled={dragEnabled}
            onJointsChange={setJoints}
            solve={solve}
            wouldCollide={wouldCollide}
          />
        )}
        <CollisionViz robot={robot} colliding={collidingLinkSet} />
        <TrajectoryTrail
          robot={robot}
          recording={mode === "Live" || mode === "Sync" || playback.status === "playing"}
          clearKey={trailClearKey}
        />
      </Scene>
    )}
    {!robotId && (
      <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
        請選擇機器人
      </div>
    )}
  </div>
  {mode === "Offline" && robotId && (
    <PlaybackPanel
      robotId={robotId}
      status={playback.status}
      speed={playback.speed}
      log={playback.log}
      error={playback.error}
      onPlay={playback.play}
      onPause={playback.pause}
      onResume={playback.resume}
      onStop={playback.stop}
      onSpeedChange={playback.setSpeed}
      onClearTrail={() => setTrailClearKey((k) => k + 1)}
    />
  )}
</div>
```

- [ ] **Step 2: Type-check + tests**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && \
  npx tsc --noEmit --pretty false --project tsconfig.json 2>&1 | grep -iE "SimulationPage|PlaybackPanel|TrajectoryTrail" | head -10 && \
  npx jest src/pages/SimulationPage/__tests__ 2>&1 | tail -5
```
Expected: 0 errors, 35 passed.

- [ ] **Step 3: Commit**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi && \
  git add src/frontend/src/pages/SimulationPage/index.tsx && \
  git commit -m "feat(robot-hmi): wire trajectory trail + playback panel into /simulation"
```

---

## Task E5: PROGRESS update + push

**Files:**
- Modify: `/Users/kenhuang/Desktop/Dev/PROGRESS.md`

- [ ] **Step 1: Edit PROGRESS.md**

Update Status:
- Phase: `P5 Phase E 完成 — 軌跡回放 + TCP 軌跡線`
- Last updated: today

Append under "What was just completed":

```markdown
### P5 Phase E（2026-05-09）— 軌跡回放（SSE）+ TCP 軌跡線
- 後端 `POST /api/v1/robots/run/stream` SSE：每行 `step_start{line, joints_before}` → 執行 → `step_end{line, joints_after, success, message}` → `done{log}` / `error{detail}`，**4 個 pytest 測試**（順序、404、註解忽略、失敗中斷）
- 前端 `useScriptPlayback({onJoints})` — fetch SSE，解析 step_start/end 為 keyframes，requestAnimationFrame tween（cubic ease-in-out，250ms/step ÷ speed），透過 onJoints callback 改機器人狀態。Play/Pause/Resume/Stop + 0.25×–4× speed
- `<TrajectoryTrail>` — 30 Hz 取 TCP world position，drei `<Line>`，`maxPoints=6000`（~3.3 分鐘），`clearKey` bump 清空
- `<PlaybackPanel>` — textarea + 控制鈕 + 輸出 log，僅 Offline 模式顯示
- SimulationPage：軌跡線恆顯示（Live/Sync 從真機 WS 即時繪製、Offline 播放時跟著畫），PlaybackPanel 在 Offline 模式時側邊出現
```

Update "Next actions" — replace Phase E with Phase F.

- [ ] **Step 2: Push**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi && git push origin main
```

If push to main is blocked, ask the user before retrying.

---

## Phase E Verification Checklist

- [ ] `cd src/backend && uv run pytest tests/unit/api/v1/test_robots_run_stream.py -v` → 4 passed
- [ ] `cd src/frontend && npx jest src/pages/SimulationPage/__tests__` → 35 passed
- [ ] `cd src/frontend && npx tsc --noEmit ...` → no errors in any new file
- [ ] Backend up + frontend up; switch to **Offline mode**, paste a 4-line MOVE script, click Play — arm tweens through each step, TCP draws cyan line
- [ ] Speed 0.25× — clearly slower; 4× — clearly faster
- [ ] Pause / Resume work; Stop clears state
- [ ] Switch to Live, send a few REST `MOVE` commands — the trail draws in real time from the WS broadcast (PlaybackPanel hidden)
- [ ] Clear-trail button bumps `clearKey` and the line disappears

---

## Self-Review (done)

- ✅ Spec coverage: backend SSE matches spec §6 ("step_start / step_end / done / error"); useScriptPlayback covers tween + speed + play/pause/stop; TrajectoryTrail accumulates the TCP line; PlaybackPanel gives the user the controls. Spec also says "Playback runs only in Offline mode" — enforced by gating PlaybackPanel on `mode === "Offline"`. The trail itself is mode-agnostic (matches spec: "trajectory trail still draws in real time from incoming WS state").
- ✅ No placeholders: every code-bearing step has complete code; SSE parsing helper is in the test file rather than the implementation; tween formula and ease function are defined inline with sensible defaults (`STEP_DURATION_MS = 500`, `SAMPLE_INTERVAL_MS = 33`, `MIN_DELTA = 0.002`).
- ✅ Type consistency: `PlaybackStatus`, `PlaybackLogEntry`, `Keyframe`, `UseScriptPlayback` defined once in the hook file and consumed by the panel; `setJoints` signature `(number[]) => void` matches existing `useSimulator.setJoints`.
- ✅ Tests: pure SSE protocol fully unit-tested (4 cases); React layer relies on visual smoke; the tween logic is testable in principle but the cost of mocking `requestAnimationFrame` for full coverage outweighs the benefit at this stage.
