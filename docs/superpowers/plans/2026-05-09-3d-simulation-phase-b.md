# 3D Simulation — Phase B Implementation Plan (FK Drag + 4 Modes)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Layer four operating modes (Offline / Live / Sync / Sandbox) onto the 3D simulation page and add forward-kinematics joint drag. After Phase B, users can pick a mode, drag joints in 3D (in modes where drag is enabled), and in Sync mode the dragged joints are mirrored to the real (mock) robot via debounced `MOVE` commands.

**Architecture:** A pure state-machine module owns the mode-transition logic (testable). A `useSimulator` hook consolidates mode state, joint state, the WebSocket lifecycle, and command emission — replacing the inline WS code in `SimulationPage`. A `<ModeTabs>` segmented control drives mode changes (with a confirm dialog before entering Sync). A `<JointDragHandles>` component renders draggable spheres at each joint origin; the hook decides whether the drag updates local state, the robot, or is disabled.

**Tech Stack:** React 19 + TypeScript, `@react-three/fiber@9`, `@react-three/drei@10`, `three@0.160`, `urdf-loader`, jest + @testing-library/react.

---

## Scope

This plan covers Phase B only — modes + FK drag. It does NOT cover:
- IK / 6-DOF gizmo (Phase C)
- Collision detection (Phase D)
- Trajectory playback / `/run/stream` (Phase E)
- Sync-mode safety polish beyond confirm dialog and debounce (Phase F adds emergency stop, drag-rejection on collision, etc.)

Each task ends with a commit. Phase A is shipped at `5cfb8e5` on `origin/main`. Total ETA ~3 days, 7 tasks.

---

## File Structure (Phase B target)

```
src/frontend/src/pages/SimulationPage/
├── index.tsx                                ← refactored to use useSimulator
├── components/
│   ├── Scene.tsx                            ← unchanged from Phase A
│   ├── RobotModel.tsx                       ← unchanged from Phase A
│   ├── ModeTabs.tsx                         ← NEW — segmented control + confirm dialog
│   └── JointDragHandles.tsx                 ← NEW — drei Sphere per joint, drag handler
└── hooks/
    ├── useUrdf.ts                           ← unchanged from Phase A
    ├── simModeFsm.ts                        ← NEW — pure mode-transition functions + tests
    └── useSimulator.ts                      ← NEW — combined mode + joints + WS + sendMove

src/frontend/src/pages/SimulationPage/__tests__/
├── simModeFsm.test.ts                       ← NEW — pure FSM unit tests
└── useSimulator.test.ts                     ← NEW — hook tests with renderHook
```

---

## Task B1: Pure mode-state FSM with tests

**Files:**
- Create: `src/frontend/src/pages/SimulationPage/hooks/simModeFsm.ts`
- Test: `src/frontend/src/pages/SimulationPage/__tests__/simModeFsm.test.ts`

**Goal:** Encode mode transitions as pure functions so we can unit-test them without React or WebSocket. The hook layer (B2) calls these and applies the side effects.

- [ ] **Step 1: Write the failing test**

Create `src/frontend/src/pages/SimulationPage/__tests__/simModeFsm.test.ts`:

```ts
import {
  type SimMode,
  jointSourceFor,
  isDragEnabled,
  isCommandEmitted,
  sideEffectsForTransition,
  needsConfirmation,
} from "../hooks/simModeFsm";

describe("jointSourceFor", () => {
  it("returns 'ws' for Live and Sync", () => {
    expect(jointSourceFor("Live")).toBe("ws");
    expect(jointSourceFor("Sync")).toBe("ws");
  });
  it("returns 'local' for Offline and Sandbox", () => {
    expect(jointSourceFor("Offline")).toBe("local");
    expect(jointSourceFor("Sandbox")).toBe("local");
  });
});

describe("isDragEnabled", () => {
  it("disables drag in Live", () => {
    expect(isDragEnabled("Live")).toBe(false);
  });
  it("enables drag in Offline / Sync / Sandbox", () => {
    expect(isDragEnabled("Offline")).toBe(true);
    expect(isDragEnabled("Sync")).toBe(true);
    expect(isDragEnabled("Sandbox")).toBe(true);
  });
});

describe("isCommandEmitted", () => {
  it("emits commands ONLY in Sync", () => {
    expect(isCommandEmitted("Sync")).toBe(true);
    expect(isCommandEmitted("Live")).toBe(false);
    expect(isCommandEmitted("Offline")).toBe(false);
    expect(isCommandEmitted("Sandbox")).toBe(false);
  });
});

describe("needsConfirmation", () => {
  it("requires confirm only when entering Sync", () => {
    expect(needsConfirmation("Live", "Sync")).toBe(true);
    expect(needsConfirmation("Offline", "Sync")).toBe(true);
    expect(needsConfirmation("Sandbox", "Sync")).toBe(true);
    expect(needsConfirmation("Sync", "Sync")).toBe(false);
    expect(needsConfirmation("Live", "Live")).toBe(false);
    expect(needsConfirmation("Live", "Offline")).toBe(false);
  });
});

describe("sideEffectsForTransition", () => {
  const all: SimMode[] = ["Live", "Sync", "Offline", "Sandbox"];

  it("connects WS when entering Live or Sync from off-WS modes", () => {
    expect(sideEffectsForTransition("Offline", "Live")).toEqual(
      expect.arrayContaining(["connect_ws"]),
    );
    expect(sideEffectsForTransition("Sandbox", "Sync")).toEqual(
      expect.arrayContaining(["connect_ws"]),
    );
  });

  it("does not reconnect when staying within WS modes (Live <-> Sync)", () => {
    expect(sideEffectsForTransition("Live", "Sync")).not.toContain("connect_ws");
    expect(sideEffectsForTransition("Sync", "Live")).not.toContain("connect_ws");
  });

  it("disconnects WS when leaving WS modes", () => {
    expect(sideEffectsForTransition("Live", "Offline")).toEqual(
      expect.arrayContaining(["disconnect_ws"]),
    );
    expect(sideEffectsForTransition("Sync", "Sandbox")).toEqual(
      expect.arrayContaining(["disconnect_ws"]),
    );
  });

  it("snaps once when entering Offline (capture last WS state)", () => {
    expect(sideEffectsForTransition("Live", "Offline")).toEqual(
      expect.arrayContaining(["snap_once"]),
    );
  });

  it("does NOT snap when entering Sandbox", () => {
    expect(sideEffectsForTransition("Live", "Sandbox")).not.toContain("snap_once");
  });

  it("returns empty effects for same-mode transitions", () => {
    for (const m of all) {
      expect(sideEffectsForTransition(m, m)).toEqual([]);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && npx jest src/pages/SimulationPage/__tests__/simModeFsm.test.ts 2>&1 | tail -10
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the FSM**

Create `src/frontend/src/pages/SimulationPage/hooks/simModeFsm.ts`:

```ts
export type SimMode = "Offline" | "Live" | "Sync" | "Sandbox";

export type JointSource = "ws" | "local";

export type SideEffect =
  | "connect_ws"
  | "disconnect_ws"
  | "snap_once"
  | "show_sync_confirm";

const WS_MODES = new Set<SimMode>(["Live", "Sync"]);

export function jointSourceFor(mode: SimMode): JointSource {
  return WS_MODES.has(mode) ? "ws" : "local";
}

export function isDragEnabled(mode: SimMode): boolean {
  return mode !== "Live";
}

export function isCommandEmitted(mode: SimMode): boolean {
  return mode === "Sync";
}

export function needsConfirmation(from: SimMode, to: SimMode): boolean {
  return to === "Sync" && from !== "Sync";
}

export function sideEffectsForTransition(
  from: SimMode,
  to: SimMode,
): SideEffect[] {
  if (from === to) return [];

  const effects: SideEffect[] = [];
  const fromOnWs = WS_MODES.has(from);
  const toOnWs = WS_MODES.has(to);

  // Snap to current WS joints once before disconnecting (Offline only;
  // Sandbox keeps whatever the user was already looking at).
  if (fromOnWs && to === "Offline") {
    effects.push("snap_once");
  }

  if (!fromOnWs && toOnWs) effects.push("connect_ws");
  if (fromOnWs && !toOnWs) effects.push("disconnect_ws");

  return effects;
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && npx jest src/pages/SimulationPage/__tests__/simModeFsm.test.ts 2>&1 | tail -10
```
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi && \
  git add src/frontend/src/pages/SimulationPage/hooks/simModeFsm.ts \
          src/frontend/src/pages/SimulationPage/__tests__/simModeFsm.test.ts && \
  git commit -m "feat(robot-hmi): sim mode FSM — pure mode-transition functions + tests"
```

---

## Task B2: useSimulator hook (mode + joints + WS + sendMove)

**Files:**
- Create: `src/frontend/src/pages/SimulationPage/hooks/useSimulator.ts`
- Test: `src/frontend/src/pages/SimulationPage/__tests__/useSimulator.test.ts`

**Goal:** A single hook that owns the simulation's runtime state. Replaces the inline WS code in the page. The hook handles mode transitions (using the FSM from B1) and exposes a clean API: `{ mode, setMode, joints, setJoints, status }`.

- [ ] **Step 1: Write the failing test**

Create `src/frontend/src/pages/SimulationPage/__tests__/useSimulator.test.ts`:

```ts
import { act, renderHook, waitFor } from "@testing-library/react";
import { useSimulator } from "../hooks/useSimulator";

// Minimal in-test WebSocket mock that lets us push frames at will.
class MockWS {
  static instances: MockWS[] = [];
  url: string;
  onopen: ((this: WebSocket, ev: Event) => any) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null = null;
  onclose: ((this: WebSocket, ev: CloseEvent) => any) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    MockWS.instances.push(this);
  }
  send(_data: any) {}
  close() {
    this.closed = true;
    this.onclose?.call(this as any, {} as CloseEvent);
  }
  emit(payload: any) {
    this.onmessage?.call(this as any, { data: JSON.stringify(payload) } as MessageEvent);
  }
}

beforeEach(() => {
  MockWS.instances = [];
  (globalThis as any).WebSocket = MockWS as any;
  // Stub fetch (used by a "snap once" path); default to error so missing stubs
  // are obvious.
  (globalThis as any).fetch = jest.fn().mockRejectedValue(new Error("no fetch stub"));
});

describe("useSimulator — initial state", () => {
  it("starts in Live mode with zero joints and idle status", () => {
    const { result } = renderHook(() => useSimulator("robot_01"));
    expect(result.current.mode).toBe("Live");
    expect(result.current.joints).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe("useSimulator — Live mode", () => {
  it("opens a WebSocket on mount", () => {
    renderHook(() => useSimulator("robot_01"));
    expect(MockWS.instances).toHaveLength(1);
    expect(MockWS.instances[0].url).toMatch(/\/api\/v1\/robots\/ws\/robot_01$/);
  });

  it("updates joints when WS pushes a frame", async () => {
    const { result } = renderHook(() => useSimulator("robot_01"));
    act(() => {
      MockWS.instances[0].emit({ joints: [1, 2, 3, 4, 5, 6] });
    });
    await waitFor(() => expect(result.current.joints).toEqual([1, 2, 3, 4, 5, 6]));
  });

  it("ignores malformed frames", () => {
    const { result } = renderHook(() => useSimulator("robot_01"));
    act(() => {
      MockWS.instances[0].emit({ joints: "not-an-array" });
      MockWS.instances[0].emit({ joints: [1, 2] });  // wrong length
    });
    expect(result.current.joints).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe("useSimulator — mode transitions", () => {
  it("disconnects the WS when switching Live -> Sandbox", async () => {
    const { result } = renderHook(() => useSimulator("robot_01"));
    const ws = MockWS.instances[0];
    act(() => result.current.setMode("Sandbox"));
    await waitFor(() => expect(ws.closed).toBe(true));
    expect(result.current.mode).toBe("Sandbox");
  });

  it("does NOT reconnect when going Live -> Sync (both are WS modes)", async () => {
    const { result } = renderHook(() => useSimulator("robot_01"));
    const wsBefore = MockWS.instances[0];
    act(() => result.current.setMode("Sync"));
    expect(MockWS.instances).toHaveLength(1); // no new connection
    expect(wsBefore.closed).toBe(false);
  });

  it("snaps to last WS joints when entering Offline from Live", async () => {
    const { result } = renderHook(() => useSimulator("robot_01"));
    act(() => MockWS.instances[0].emit({ joints: [10, 20, 30, 40, 50, 60] }));
    await waitFor(() => expect(result.current.joints[0]).toBe(10));
    act(() => result.current.setMode("Offline"));
    expect(result.current.joints).toEqual([10, 20, 30, 40, 50, 60]);
    expect(MockWS.instances[0].closed).toBe(true);
  });
});

describe("useSimulator — setJoints", () => {
  it("setJoints in Sandbox updates local state without sending commands", () => {
    const { result } = renderHook(() => useSimulator("robot_01"));
    act(() => result.current.setMode("Sandbox"));
    act(() => result.current.setJoints([5, 0, 0, 0, 0, 0]));
    expect(result.current.joints).toEqual([5, 0, 0, 0, 0, 0]);
  });

  it("setJoints in Sync POSTs a debounced MOVE command", async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    (globalThis as any).fetch = fetchMock;

    const { result } = renderHook(() => useSimulator("robot_01"));
    act(() => result.current.setMode("Sync"));
    act(() => result.current.setJoints([1, 2, 3, 4, 5, 6]));
    act(() => result.current.setJoints([7, 8, 9, 10, 11, 12])); // coalesced

    expect(fetchMock).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(300);
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/robots/robot_01/command");
    expect(JSON.parse(init.body)).toEqual({
      cmd: "MOVE",
      params: { j1: 7, j2: 8, j3: 9, j4: 10, j5: 11, j6: 12 },
    });
    jest.useRealTimers();
  });

  it("setJoints in Live is a no-op (drag disabled)", () => {
    const { result } = renderHook(() => useSimulator("robot_01"));
    // Stays in Live (default)
    act(() => result.current.setJoints([1, 2, 3, 4, 5, 6]));
    expect(result.current.joints).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && npx jest src/pages/SimulationPage/__tests__/useSimulator.test.ts 2>&1 | tail -15
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `src/frontend/src/pages/SimulationPage/hooks/useSimulator.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type SimMode,
  isCommandEmitted,
  isDragEnabled,
  jointSourceFor,
  sideEffectsForTransition,
} from "./simModeFsm";

const COMMAND_DEBOUNCE_MS = 250;

export interface UseSimulator {
  mode: SimMode;
  setMode: (next: SimMode) => void;
  joints: number[];
  setJoints: (joints: number[]) => void;
  source: "ws" | "local";
  dragEnabled: boolean;
}

const ZEROS: number[] = [0, 0, 0, 0, 0, 0];

function makeWsUrl(robotId: string): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/api/v1/robots/ws/${robotId}`;
}

export function useSimulator(robotId: string): UseSimulator {
  const [mode, setModeState] = useState<SimMode>("Live");
  const [joints, setJointsState] = useState<number[]>(ZEROS);

  const wsRef = useRef<WebSocket | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingJointsRef = useRef<number[] | null>(null);

  // Open a WS for the current mode if it should have one. This is called from
  // both initial mount and from `setMode` (for `connect_ws` side effect).
  const openWs = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) return;
    const ws = new WebSocket(makeWsUrl(robotId));
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (Array.isArray(data.joints) && data.joints.length === 6) {
          setJointsState(data.joints.map(Number));
        }
      } catch {
        // ignore malformed
      }
    };
    wsRef.current = ws;
  }, [robotId]);

  const closeWs = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  // Mount: open WS if initial mode wants one.
  useEffect(() => {
    if (jointSourceFor(mode) === "ws") openWs();
    return () => {
      closeWs();
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [robotId]); // re-run only on robotId change

  const setMode = useCallback(
    (next: SimMode) => {
      setModeState((current) => {
        const effects = sideEffectsForTransition(current, next);
        for (const e of effects) {
          if (e === "connect_ws") openWs();
          else if (e === "disconnect_ws") {
            // For "snap_once" we want the joints from the last WS frame —
            // that's already in state, so the snap happens implicitly by
            // disconnecting AFTER state has been captured. Order: snap_once
            // is logically before disconnect; React state is already up to
            // date.
            closeWs();
          }
          // "snap_once" is a no-op in code: the latest WS frame is already
          // applied to `joints`, and we leave it there when disconnecting.
        }
        return next;
      });
    },
    [openWs, closeWs],
  );

  const sendMoveDebounced = useCallback(
    (target: number[]) => {
      pendingJointsRef.current = target;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const j = pendingJointsRef.current;
        pendingJointsRef.current = null;
        debounceRef.current = null;
        if (!j) return;
        fetch(`/api/v1/robots/${robotId}/command`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cmd: "MOVE",
            params: { j1: j[0], j2: j[1], j3: j[2], j4: j[3], j5: j[4], j6: j[5] },
          }),
        }).catch(() => {
          // Drag should not fail loudly on transient network issues.
        });
      }, COMMAND_DEBOUNCE_MS);
    },
    [robotId],
  );

  const setJoints = useCallback(
    (next: number[]) => {
      if (!isDragEnabled(mode)) return; // Live = read-only
      setJointsState(next);
      if (isCommandEmitted(mode)) sendMoveDebounced(next);
    },
    [mode, sendMoveDebounced],
  );

  return {
    mode,
    setMode,
    joints,
    setJoints,
    source: jointSourceFor(mode),
    dragEnabled: isDragEnabled(mode),
  };
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && npx jest src/pages/SimulationPage/__tests__/useSimulator.test.ts 2>&1 | tail -15
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi && \
  git add src/frontend/src/pages/SimulationPage/hooks/useSimulator.ts \
          src/frontend/src/pages/SimulationPage/__tests__/useSimulator.test.ts && \
  git commit -m "feat(robot-hmi): useSimulator hook — mode + joints + WS + debounced MOVE"
```

---

## Task B3: Refactor SimulationPage to use useSimulator

**Files:**
- Modify: `src/frontend/src/pages/SimulationPage/index.tsx`

**Goal:** Replace the inline WebSocket and joints state with a single `useSimulator(robotId)` call. No behaviour change visible yet — this is a pure refactor that prepares the page for ModeTabs and JointDragHandles.

- [ ] **Step 1: Read the current index.tsx so you know what to change**

```bash
cat /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend/src/pages/SimulationPage/index.tsx
```

You should see: a `useEffect` that opens a WebSocket and pushes frames into a `joints` state, plus a separate `useEffect` for the robot list. Both `joints` state and the WS effect get replaced by `useSimulator`.

- [ ] **Step 2: Rewrite index.tsx**

Replace the entire file with:

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
import { useSimulator } from "./hooks/useSimulator";

export default function SimulationPage() {
  const [robots, setRobots] = useState<string[]>([]);
  const [robotId, setRobotId] = useState<string>("");
  const { robot, status, error } = useUrdf(robotId || null);
  const { mode, joints } = useSimulator(robotId);

  useEffect(() => {
    fetch("/api/v1/robots")
      .then((r) => r.json())
      .then((list: { robot_id: string }[]) => {
        setRobots(list.map((r) => r.robot_id));
        if (list.length > 0 && !robotId) setRobotId(list[0].robot_id);
      })
      .catch(() => {});
  }, []);

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
              <SelectItem key={id} value={id}>
                {id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{mode} 模式</span>
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

Note: a small UX upgrade — the mode name now comes from `useSimulator` instead of being hard-coded as "Live".

- [ ] **Step 3: Type-check**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && npx tsc --noEmit --pretty false --project tsconfig.json 2>&1 | grep -iE "SimulationPage" | head -10
```
Expected: no errors mentioning SimulationPage.

- [ ] **Step 4: Smoke check (manual)**

The user already runs `npm start`. Open `/simulation`. You should see no behaviour change vs. Phase A — the arm still mirrors `/ws/{id}`. The label now reads "Live 模式" (instead of "Live 模式" hardcoded).

- [ ] **Step 5: Commit**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi && \
  git add src/frontend/src/pages/SimulationPage/index.tsx && \
  git commit -m "refactor(robot-hmi): SimulationPage — adopt useSimulator hook"
```

---

## Task B4: ModeTabs component (segmented control + Sync confirm)

**Files:**
- Create: `src/frontend/src/pages/SimulationPage/components/ModeTabs.tsx`
- Modify: `src/frontend/src/pages/SimulationPage/index.tsx`

**Goal:** A segmented control with the four mode buttons. Clicking a non-Sync mode switches immediately. Clicking Sync from another mode opens a confirm dialog ("同步模式會把 3D 操作直接發到真機。確定？") before switching.

- [ ] **Step 1: Build the ModeTabs component**

Create `src/frontend/src/pages/SimulationPage/components/ModeTabs.tsx`:

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type SimMode, needsConfirmation } from "../hooks/simModeFsm";

const MODES: SimMode[] = ["Live", "Offline", "Sync", "Sandbox"];

const LABELS: Record<SimMode, string> = {
  Live: "Live 鏡像",
  Offline: "Offline 離線",
  Sync: "Sync 雙向",
  Sandbox: "Sandbox 沙盒",
};

const DESCRIPTIONS: Record<SimMode, string> = {
  Live: "唯讀地鏡像真機關節",
  Offline: "離線編輯，按鈕送到真機",
  Sync: "拖拉直接控制真機",
  Sandbox: "完全脫線，自由操作",
};

interface Props {
  mode: SimMode;
  onModeChange: (next: SimMode) => void;
}

export function ModeTabs({ mode, onModeChange }: Props) {
  const [pendingMode, setPendingMode] = useState<SimMode | null>(null);

  const handleClick = (target: SimMode) => {
    if (target === mode) return;
    if (needsConfirmation(mode, target)) {
      setPendingMode(target);
    } else {
      onModeChange(target);
    }
  };

  const confirmSync = () => {
    if (pendingMode) onModeChange(pendingMode);
    setPendingMode(null);
  };

  return (
    <>
      <div className="inline-flex items-center gap-1 rounded-md border p-1">
        {MODES.map((m) => (
          <Button
            key={m}
            size="sm"
            variant={mode === m ? "default" : "ghost"}
            onClick={() => handleClick(m)}
            title={DESCRIPTIONS[m]}
            className="text-xs"
          >
            {LABELS[m]}
          </Button>
        ))}
      </div>
      <Dialog open={pendingMode !== null} onOpenChange={(open) => !open && setPendingMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>切到 Sync 雙向模式？</DialogTitle>
            <DialogDescription>
              在此模式下，你在 3D 場景拖拉的關節會直接發到真機。請確認真機處於安全狀態（無人靠近、緊急停止可達）後再繼續。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingMode(null)}>
              取消
            </Button>
            <Button onClick={confirmSync}>確定切換到 Sync</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 2: Wire it into SimulationPage**

Edit `src/frontend/src/pages/SimulationPage/index.tsx`:

Replace the `useSimulator` destructure to include `setMode`:

```tsx
const { mode, setMode, joints } = useSimulator(robotId);
```

Add the import:

```tsx
import { ModeTabs } from "./components/ModeTabs";
```

Replace the toolbar `<span className="text-xs text-muted-foreground">{mode} 模式</span>` with the ModeTabs component:

```tsx
<ModeTabs mode={mode} onModeChange={setMode} />
```

So the toolbar block becomes:

```tsx
<div className="mb-4 flex items-center gap-3">
  <h1 className="text-2xl font-semibold">3D 模擬</h1>
  <Select value={robotId} onValueChange={setRobotId}>
    <SelectTrigger className="w-48">
      <SelectValue placeholder="選擇機器人" />
    </SelectTrigger>
    <SelectContent>
      {robots.map((id) => (
        <SelectItem key={id} value={id}>
          {id}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
  <ModeTabs mode={mode} onModeChange={setMode} />
</div>
```

- [ ] **Step 3: Verify Dialog component exists in the shadcn UI directory**

```bash
ls /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend/src/components/ui/dialog.tsx
```

If the file is missing, the import path is wrong — check the actual path. (Existing `RobotConfigPage` uses `confirm(...)` — a native dialog. If shadcn dialog isn't available, swap the entire `<Dialog>...</Dialog>` block with a `confirm("同步模式...")` and a synchronous code path. The `pendingMode` state can stay; trigger the confirm directly inside `handleClick`.)

- [ ] **Step 4: Type-check**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && npx tsc --noEmit --pretty false --project tsconfig.json 2>&1 | grep -iE "ModeTabs|SimulationPage" | head -10
```
Expected: no errors mentioning these files.

- [ ] **Step 5: Smoke check (manual)**

Reload `/simulation`. Click each mode. Clicking Sync should pop a dialog (or native confirm). Confirming should switch; cancel should keep the previous mode.

- [ ] **Step 6: Commit**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi && \
  git add src/frontend/src/pages/SimulationPage/components/ModeTabs.tsx \
          src/frontend/src/pages/SimulationPage/index.tsx && \
  git commit -m "feat(robot-hmi): mode tabs (Live / Offline / Sync / Sandbox) with Sync confirm"
```

---

## Task B5: JointDragHandles component (FK joint drag)

**Files:**
- Create: `src/frontend/src/pages/SimulationPage/components/JointDragHandles.tsx`
- Modify: `src/frontend/src/pages/SimulationPage/index.tsx`

**Goal:** Render a small sphere at each joint origin in world space. Clicking and dragging the sphere rotates that joint within URDF limits. The dragged joint angles flow through `useSimulator.setJoints`, which decides what to do with them based on mode.

- [ ] **Step 1: Build JointDragHandles**

Create `src/frontend/src/pages/SimulationPage/components/JointDragHandles.tsx`:

```tsx
import { ThreeEvent } from "@react-three/fiber";
import { Sphere } from "@react-three/drei";
import { useRef } from "react";
import { Vector3 } from "three";
import type { URDFRobot } from "urdf-loader/src/URDFClasses";

const JOINT_NAMES = ["j1", "j2", "j3", "j4", "j5", "j6"] as const;

// Drag sensitivity: pixels per radian
const PIXELS_PER_RAD = 200;

interface Props {
  robot: URDFRobot;
  jointsDeg: number[];
  enabled: boolean;
  onJointsChange: (next: number[]) => void;
}

interface DragState {
  jointIndex: number;
  startX: number;
  startY: number;
  startValueRad: number;
  limitLowerRad: number;
  limitUpperRad: number;
}

export function JointDragHandles({ robot, jointsDeg, enabled, onJointsChange }: Props) {
  const dragRef = useRef<DragState | null>(null);

  if (!enabled) return null;

  const positions: { name: string; index: number; pos: Vector3; limits: [number, number] }[] = [];
  for (const [i, name] of JOINT_NAMES.entries()) {
    const j = (robot as any).joints?.[name];
    if (!j) continue;
    const pos = new Vector3();
    j.getWorldPosition(pos);
    const limits: [number, number] = [
      typeof j.limit?.lower === "number" ? j.limit.lower : -Math.PI,
      typeof j.limit?.upper === "number" ? j.limit.upper : Math.PI,
    ];
    positions.push({ name, index: i, pos, limits });
  }

  const onPointerDown = (e: ThreeEvent<PointerEvent>, index: number, limits: [number, number]) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      jointIndex: index,
      startX: e.nativeEvent.clientX,
      startY: e.nativeEvent.clientY,
      startValueRad: ((jointsDeg[index] ?? 0) * Math.PI) / 180,
      limitLowerRad: limits[0],
      limitUpperRad: limits[1],
    };
  };

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    const d = dragRef.current;
    // Use vertical drag — moving up = +angle. Feels natural for a vertical axis.
    const dy = d.startY - e.nativeEvent.clientY;
    const targetRad = d.startValueRad + dy / PIXELS_PER_RAD;
    const clamped = Math.max(d.limitLowerRad, Math.min(d.limitUpperRad, targetRad));
    const next = [...jointsDeg];
    next[d.jointIndex] = (clamped * 180) / Math.PI;
    onJointsChange(next);
  };

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
  };

  return (
    <>
      {positions.map(({ name, index, pos, limits }) => (
        <group key={name} position={[pos.x, pos.y, pos.z]}>
          <Sphere
            args={[0.025, 16, 16]}
            onPointerDown={(e) => onPointerDown(e, index, limits)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <meshStandardMaterial color="#ff9933" emissive="#552200" />
          </Sphere>
        </group>
      ))}
    </>
  );
}
```

Note: positions are derived from `joint.getWorldPosition(...)`. Three.js gives us this on each render, and React re-renders when `jointsDeg` changes (via `useSimulator`'s state), so positions stay synced.

- [ ] **Step 2: Wire JointDragHandles into the page**

Edit `src/frontend/src/pages/SimulationPage/index.tsx`:

Add import:

```tsx
import { JointDragHandles } from "./components/JointDragHandles";
```

Update the destructure to include `setJoints` and `dragEnabled`:

```tsx
const { mode, setMode, joints, setJoints, dragEnabled } = useSimulator(robotId);
```

Wrap the `<RobotModel>` in `<Scene>` with a sibling `<JointDragHandles>`:

```tsx
{status === "ready" && robot && (
  <Scene>
    <RobotModel robot={robot} jointsDeg={joints} />
    <JointDragHandles
      robot={robot}
      jointsDeg={joints}
      enabled={dragEnabled}
      onJointsChange={setJoints}
    />
  </Scene>
)}
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && npx tsc --noEmit --pretty false --project tsconfig.json 2>&1 | grep -iE "JointDragHandles|SimulationPage" | head -10
```
Expected: no errors. If three.js / drei type quirks come up, apply narrow `as any` casts (matching the pattern in `useUrdf.ts` and `RobotModel.tsx`).

- [ ] **Step 4: Smoke check (manual)**

Reload `/simulation`. Switch to Sandbox mode. Orange spheres should appear at each joint origin. Click and drag a sphere up/down — that joint rotates within its URDF limits. Switch back to Live — spheres disappear.

- [ ] **Step 5: Commit**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi && \
  git add src/frontend/src/pages/SimulationPage/components/JointDragHandles.tsx \
          src/frontend/src/pages/SimulationPage/index.tsx && \
  git commit -m "feat(robot-hmi): FK joint drag handles — orange spheres per joint"
```

---

## Task B6: Sync-mode end-to-end verification + visual polish

**Files:** No code changes expected unless smoke testing reveals bugs. Mostly a manual verification checkpoint.

**Goal:** Confirm Sync-mode debounced commands actually round-trip to the mock adapter.

- [ ] **Step 1: Start backend and frontend (in two terminals)**

```bash
# Terminal 1
cd /Users/kenhuang/Desktop/Dev/robot-hmi && \
  PYTHONPATH=src/backend/base:src/lfx/src .venv/bin/uvicorn \
    --factory langflow.main:create_app --host 0.0.0.0 --port 7860 --loop asyncio
```

```bash
# Terminal 2
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && npm start
```

- [ ] **Step 2: Per-mode smoke**

Open `/simulation` and verify each mode:

| Mode | Expected |
|---|---|
| Live | Default. Arm mirrors WS state. No drag handles. Send `curl -X POST http://localhost:7860/api/v1/robots/robot_01/command -H "Content-Type: application/json" -d '{"cmd":"MOVE","params":{"j1":45}}'` — arm rotates joint 1. |
| Offline | Switch from Live. Arm freezes at last WS value (snap_once). Drag handles appear. Drag a joint — local change, no command sent. |
| Sandbox | Switch from Offline. Same handles, no snap. Drag freely. |
| Sync | Confirm dialog appears. Confirm — joint handles return. Drag a joint. Wait ~300 ms. WS frame returns the new joint value (the mock backend honors the MOVE). |

- [ ] **Step 3: Quick console-network observation**

In browser devtools' Network tab:
- Switch to Sync, drag a joint slowly through ~10 small movements over 2 seconds.
- Expect ~8 POST requests to `/api/v1/robots/robot_01/command` (debounce coalesces some). NOT one per movement.
- Each POST body should be `{"cmd":"MOVE","params":{"j1":...,"j2":...,...,"j6":...}}`.

- [ ] **Step 4: If bugs surface, fix them inline**

Each fix is its own commit. Examples of likely issues:
- Drag axis feels backwards → flip sign of `dy` in `JointDragHandles.onPointerMove`.
- Sync POSTs not firing → check that `useSimulator.setJoints` is being called (add a `console.log` in dev).

If any new bug requires more than a 2-line fix, escalate via STATUS: NEEDS_CONTEXT to the controller.

- [ ] **Step 5: No commit unless code changed**

Phase B's code work is done at this point. Move to B7.

---

## Task B7: Update PROGRESS.md and push

**Files:**
- Modify: `/Users/kenhuang/Desktop/Dev/PROGRESS.md`

- [ ] **Step 1: Edit PROGRESS.md**

Update the `Status` block:

- `Phase` → `P5 Phase B 完成 — 4 模式 + FK joint drag`
- `Last updated` → today's date

Append a new `### P5 Phase B (date) — modes + FK drag` section under "What was just completed" listing:
- Pure mode FSM (`simModeFsm.ts`) with unit tests
- `useSimulator` hook (mode + joints + WS + debounced MOVE) with hook tests
- `<ModeTabs>` segmented control with Sync confirm dialog
- `<JointDragHandles>` FK joint drag
- All 4 modes verified end-to-end against the mock backend

Update `## Next actions` — replace the Phase B reference with: "Phase C: IK + 6DOF gizmo (re-run /writing-plans)".

- [ ] **Step 2: Commit and push**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi && git push origin main
```

If push is blocked, ask the user before retrying.

After successful push, update PROGRESS.md with the new commit hashes (`git log --oneline 5cfb8e5..HEAD`) and commit/push that update.

---

## Phase B Verification Checklist

When all of B1–B7 are done, verify:

- [ ] `cd src/frontend && npx jest src/pages/SimulationPage/__tests__` → all green
- [ ] `cd src/frontend && npx tsc --noEmit --pretty false --project tsconfig.json` — no errors in any `SimulationPage*` file
- [ ] Backend tests still pass: `cd src/backend && uv run pytest tests/unit/robot/ tests/unit/api/v1/test_robots_urdf.py -v`
- [ ] Live mode mirrors WS, no drag handles
- [ ] Offline mode snaps and disconnects WS, drag handles appear, drag is local-only
- [ ] Sandbox mode does not snap, drag is local-only
- [ ] Sync mode shows confirm dialog, accepts → drag emits debounced MOVE commands
- [ ] All four modes round-trip cleanly via the segmented control

---

## Self-Review (done)

- ✅ Spec coverage: every Phase B requirement in the spec maps to a task. Mode behaviour table → B1+B2; segmented control + Sync confirm → B4; FK drag → B5; debounced commit → B2 (logic) + B5 (UI hook-up); per-mode smoke → B6.
- ✅ No placeholders: every code-bearing step has complete code; all step counts and commands are concrete.
- ✅ Type consistency: `SimMode` is `"Offline"|"Live"|"Sync"|"Sandbox"` everywhere; `useSimulator` returns `{mode, setMode, joints, setJoints, source, dragEnabled}` consistently across B2/B3/B4/B5; `JOINT_NAMES = ["j1"..."j6"]` matches what RobotModel.tsx already uses.
- ✅ Test design: pure functions (B1) and hook lifecycle (B2) are unit-tested; UI components (B4/B5) rely on visual smoke since the underlying logic is already proven.
