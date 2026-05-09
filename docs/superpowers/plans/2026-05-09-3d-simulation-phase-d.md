# 3D Simulation — Phase D Implementation Plan (Collision Detection)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect link-vs-link collisions in real time and reject drag updates that would put the arm in a colliding configuration. Built on top of Phases A–C.

**Architecture:** `three-mesh-bvh` per link, computed once at URDF load. A pure function `collidingLinks(bvhs, jointsRad) => Set<linkName>` updates link transforms in a temporary clone of the robot and runs pairwise intersection tests for non-adjacent link pairs. A React hook (`useCollision`) wraps it with memoization. Drag handlers (FK + IK) call the check before committing — if any new collision appears, the joint update is reverted and a toast is shown. A `<CollisionViz>` overlay tints colliding links red for visibility.

**Tech Stack:** React 19 + TypeScript, `three@0.160`, `three-mesh-bvh@0.7` (already installed in Phase A9), `urdf-loader@0.12`, jest.

---

## Scope

This plan covers Phase D from the spec. OUT of scope:
- Self-collision tolerance for adjacent links (always skipped — they touch by design)
- Collision **during script playback** (Phase E will revisit; per spec, playback shows but does not block)
- Workspace fixtures / external obstacles — Phase F+ work

5 tasks, ~2 days.

---

## File Structure

```
src/frontend/src/pages/SimulationPage/
├── hooks/
│   ├── collision.ts                     ← NEW — pure: build BVHs + check collisions
│   └── useCollision.ts                  ← NEW — React hook wrapping collision.ts
├── components/
│   ├── CollisionViz.tsx                 ← NEW — red tint overlay on colliding links
│   ├── JointDragHandles.tsx             ← modify: revert drag on new collision
│   └── IKGizmo.tsx                      ← modify: revert IK update on new collision
└── index.tsx                            ← modify: render CollisionViz inside Scene

src/frontend/src/pages/SimulationPage/__tests__/
└── collision.test.ts                    ← NEW — pure-function unit tests
```

---

## Task D1: Pure collision module — build BVHs + intersection check

**Files:**
- Create: `src/frontend/src/pages/SimulationPage/hooks/collision.ts`
- Test: `src/frontend/src/pages/SimulationPage/__tests__/collision.test.ts`

**Goal:** Two pure functions:
1. `buildLinkBVHs(robot) => LinkBVH[]` — walks the URDF, computes a `MeshBVH` per visual mesh, returns one entry per link.
2. `collidingLinks(bvhs, robot, jointsRad) => Set<string>` — applies the joint angles to the robot, computes pair transforms, returns the names of links that are intersecting (excluding adjacent pairs).

- [ ] **Step 1: Write the failing test**

Create `src/frontend/src/pages/SimulationPage/__tests__/collision.test.ts`:

```ts
import { BoxGeometry, Matrix4 } from "three";
import { computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";
import { intersectGeometryPair } from "../hooks/collision";

// Patch BufferGeometry once so .computeBoundsTree() / .boundsTree exist.
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (BoxGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (BoxGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
});

describe("intersectGeometryPair", () => {
  it("detects two overlapping unit cubes at the origin", () => {
    const a = new BoxGeometry(1, 1, 1);
    const b = new BoxGeometry(1, 1, 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (a as any).computeBoundsTree();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (b as any).computeBoundsTree();
    const identity = new Matrix4().identity();
    expect(intersectGeometryPair(a, identity, b, identity)).toBe(true);
  });

  it("returns false for two unit cubes 5 units apart", () => {
    const a = new BoxGeometry(1, 1, 1);
    const b = new BoxGeometry(1, 1, 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (a as any).computeBoundsTree();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (b as any).computeBoundsTree();
    const wA = new Matrix4().identity();
    const wB = new Matrix4().makeTranslation(5, 0, 0);
    expect(intersectGeometryPair(a, wA, b, wB)).toBe(false);
  });

  it("detects edge contact within tolerance", () => {
    const a = new BoxGeometry(1, 1, 1);
    const b = new BoxGeometry(1, 1, 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (a as any).computeBoundsTree();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (b as any).computeBoundsTree();
    const wA = new Matrix4().identity();
    // Just barely overlapping (centers 0.99 apart, edges of size 1 boxes touch at -0.5..0.5)
    const wB = new Matrix4().makeTranslation(0.99, 0, 0);
    expect(intersectGeometryPair(a, wA, b, wB)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && npx jest src/pages/SimulationPage/__tests__/collision.test.ts 2>&1 | tail -10
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `collision.ts`**

Create `src/frontend/src/pages/SimulationPage/hooks/collision.ts`:

```ts
import { BufferGeometry, Matrix4 } from "three";
import {
  MeshBVH,
  computeBoundsTree,
  disposeBoundsTree,
} from "three-mesh-bvh";
import type { URDFRobot } from "urdf-loader/src/URDFClasses";

// Attach BVH methods to all BufferGeometry instances exactly once.
let bvhPatched = false;
function ensureBvhPatched(): void {
  if (bvhPatched) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
  bvhPatched = true;
}

export interface LinkBVH {
  linkName: string;
  /** The BufferGeometry with .boundsTree attached. */
  geometry: BufferGeometry;
  /** The URDF link Object3D — read its matrixWorld after a forward-kinematics update. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  linkObject: any;
}

const JOINT_NAMES = ["j1", "j2", "j3", "j4", "j5", "j6"] as const;
const ADJACENT_THRESHOLD = 1; // |i - j| <= 1 means adjacent links — never test.

/**
 * Given two BufferGeometries with BVHs attached, decide whether they intersect
 * when placed at the given world transforms. Pure function — no side effects.
 */
export function intersectGeometryPair(
  a: BufferGeometry,
  worldA: Matrix4,
  b: BufferGeometry,
  worldB: Matrix4,
): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bvhA = (a as any).boundsTree as MeshBVH | undefined;
  if (!bvhA) {
    throw new Error("intersectGeometryPair: geometry A has no boundsTree");
  }
  // intersectsGeometry expects: (otherGeometry, matrixOtherToThis)
  const aInv = worldA.clone().invert();
  const transform = aInv.multiply(worldB);
  return bvhA.intersectsGeometry(b, transform);
}

/**
 * Walk the URDF and build a BVH per link visual geometry.
 * Returns an array in the order links appear in the kinematic chain (base → tcp).
 * Links without geometry (or with no triangle data) are skipped.
 */
export function buildLinkBVHs(robot: URDFRobot): LinkBVH[] {
  ensureBvhPatched();
  const out: LinkBVH[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const links = (robot as any).links;
  if (!links) return out;

  const ordered: string[] = ["base", "link1", "link2", "link3", "link4", "link5", "link6", "tcp"];
  for (const name of ordered) {
    const link = links[name];
    if (!link) continue;
    // Find the first child Mesh under this link
    let mesh: any = null;
    link.traverse((obj: any) => {
      if (!mesh && obj.isMesh && obj.geometry) mesh = obj;
    });
    if (!mesh) continue;
    const geom = mesh.geometry as BufferGeometry;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(geom as any).boundsTree) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (geom as any).computeBoundsTree();
    }
    out.push({ linkName: name, geometry: geom, linkObject: mesh });
  }
  return out;
}

/**
 * Return the set of link names that are currently intersecting (excluding
 * adjacent pairs in the chain). Caller is responsible for first applying
 * `jointsRad` to the robot via `robot.setJointValue(...)` and triggering a
 * world matrix update — this function reads the current `mesh.matrixWorld`.
 */
export function collidingLinks(
  bvhs: LinkBVH[],
  robot: URDFRobot,
): Set<string> {
  // Force a world-matrix refresh so all link transforms are up-to-date.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (robot as any).updateMatrixWorld?.(true);

  const colliding = new Set<string>();
  for (let i = 0; i < bvhs.length; i++) {
    for (let j = i + 1; j < bvhs.length; j++) {
      if (j - i <= ADJACENT_THRESHOLD) continue; // skip adjacent
      const a = bvhs[i];
      const b = bvhs[j];
      const wA = a.linkObject.matrixWorld as Matrix4;
      const wB = b.linkObject.matrixWorld as Matrix4;
      if (intersectGeometryPair(a.geometry, wA, b.geometry, wB)) {
        colliding.add(a.linkName);
        colliding.add(b.linkName);
      }
    }
  }
  return colliding;
}

/**
 * Helper that drives the full check: applies joints, refreshes transforms,
 * then runs collidingLinks. Mutates the robot's joint state — caller must
 * restore the previous joints if it wants to test hypothetically.
 */
export function checkCollisionsAt(
  robot: URDFRobot,
  bvhs: LinkBVH[],
  jointsRad: number[],
): Set<string> {
  for (let i = 0; i < JOINT_NAMES.length && i < jointsRad.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (robot as any).setJointValue?.(JOINT_NAMES[i], jointsRad[i]);
  }
  return collidingLinks(bvhs, robot);
}
```

`JOINT_NAMES` reference is unused inside `collidingLinks` itself — it's declared at module scope so `checkCollisionsAt` can use it without re-declaring.

- [ ] **Step 4: Run tests**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && npx jest src/pages/SimulationPage/__tests__/collision.test.ts 2>&1 | tail -10
```
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi && \
  git add src/frontend/src/pages/SimulationPage/hooks/collision.ts \
          src/frontend/src/pages/SimulationPage/__tests__/collision.test.ts && \
  git commit -m "feat(robot-hmi): collision detection — BVH per link + pair intersection"
```

---

## Task D2: useCollision hook

**Files:**
- Create: `src/frontend/src/pages/SimulationPage/hooks/useCollision.ts`

**Goal:** A React hook that builds the BVHs once when the URDF is ready and exposes a stable `check(jointsRad) => Set<string>` callback.

- [ ] **Step 1: Implement the hook**

Create `src/frontend/src/pages/SimulationPage/hooks/useCollision.ts`:

```ts
import { useCallback, useMemo } from "react";
import type { URDFRobot } from "urdf-loader/src/URDFClasses";
import {
  type LinkBVH,
  buildLinkBVHs,
  checkCollisionsAt,
} from "./collision";

export interface UseCollision {
  /**
   * Apply the joint vector and return the set of currently colliding link
   * names. Mutates the robot's joint state — call with the joints you want
   * to test.
   */
  check: (jointsRad: number[]) => Set<string>;
  /** True once BVHs are built and ready. */
  ready: boolean;
}

const EMPTY: Set<string> = new Set();

export function useCollision(robot: URDFRobot | null): UseCollision {
  const bvhs: LinkBVH[] = useMemo(() => {
    if (!robot) return [];
    return buildLinkBVHs(robot);
  }, [robot]);

  const check = useCallback(
    (jointsRad: number[]): Set<string> => {
      if (!robot || bvhs.length === 0) return EMPTY;
      return checkCollisionsAt(robot, bvhs, jointsRad);
    },
    [robot, bvhs],
  );

  return { check, ready: bvhs.length > 0 };
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && npx tsc --noEmit --pretty false --project tsconfig.json 2>&1 | grep -iE "useCollision|collision" | head -10
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi && \
  git add src/frontend/src/pages/SimulationPage/hooks/useCollision.ts && \
  git commit -m "feat(robot-hmi): useCollision hook — BVH cache + check callback"
```

---

## Task D3: CollisionViz component

**Files:**
- Create: `src/frontend/src/pages/SimulationPage/components/CollisionViz.tsx`

**Goal:** Visually highlight colliding links by overlaying a translucent red mesh on each colliding link's geometry. Lives inside `<Scene>`.

- [ ] **Step 1: Build the component**

Create `src/frontend/src/pages/SimulationPage/components/CollisionViz.tsx`:

```tsx
import { useMemo } from "react";
import type { URDFRobot } from "urdf-loader/src/URDFClasses";

interface Props {
  robot: URDFRobot;
  /** Set of colliding link names, from useCollision().check(...) */
  colliding: Set<string>;
}

/**
 * For each colliding link, emit a translucent red mesh that shares the
 * link's geometry. The robot's existing visuals stay; we just overlay.
 */
export function CollisionViz({ robot, colliding }: Props) {
  const linkMeshes = useMemo(() => {
    if (colliding.size === 0) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const links = (robot as any).links;
    if (!links) return [];
    const out: { name: string; geom: any; obj: any }[] = [];
    for (const name of colliding) {
      const link = links[name];
      if (!link) continue;
      let firstMesh: any = null;
      link.traverse((o: any) => {
        if (!firstMesh && o.isMesh && o.geometry) firstMesh = o;
      });
      if (firstMesh) out.push({ name, geom: firstMesh.geometry, obj: firstMesh });
    }
    return out;
  }, [robot, colliding]);

  if (linkMeshes.length === 0) return null;

  return (
    <>
      {linkMeshes.map(({ name, geom, obj }) => (
        <mesh
          key={name}
          geometry={geom}
          position={obj.getWorldPosition(new (obj.position.constructor)())}
          quaternion={obj.getWorldQuaternion(new (obj.quaternion.constructor)())}
        >
          <meshBasicMaterial color="#ff3333" transparent opacity={0.4} depthTest={false} />
        </mesh>
      ))}
    </>
  );
}
```

If the dynamic-constructor pattern (`new (obj.position.constructor)()`) is awkward, replace with explicit imports from `three`:

```tsx
import { Vector3, Quaternion } from "three";
// ...
position={obj.getWorldPosition(new Vector3())}
quaternion={obj.getWorldQuaternion(new Quaternion())}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && npx tsc --noEmit --pretty false --project tsconfig.json 2>&1 | grep -iE "CollisionViz" | head -5
```
Expected: 0 errors. If the geometry type complains (R3F may want `BufferGeometry` typed):
- Cast: `geometry={geom as any}`
- Or wrap as `<primitive object={...}>` rendering an existing mesh clone.

- [ ] **Step 3: Commit**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi && \
  git add src/frontend/src/pages/SimulationPage/components/CollisionViz.tsx && \
  git commit -m "feat(robot-hmi): CollisionViz — translucent red overlay on colliding links"
```

---

## Task D4: Drag-revert in JointDragHandles + IKGizmo

**Files:**
- Modify: `src/frontend/src/pages/SimulationPage/components/JointDragHandles.tsx`
- Modify: `src/frontend/src/pages/SimulationPage/components/IKGizmo.tsx`

**Goal:** Both drag handlers accept a new optional `onWouldCollide(joints) => boolean` callback. Before calling `onJointsChange`, they check this; if it returns `true`, the update is dropped.

- [ ] **Step 1: Add the prop to JointDragHandles**

Edit `src/frontend/src/pages/SimulationPage/components/JointDragHandles.tsx`. Add to the `Props` interface:

```tsx
interface Props {
  robot: URDFRobot;
  jointsDeg: number[];
  enabled: boolean;
  onJointsChange: (next: number[]) => void;
  /** Optional gate — return true to reject this update (e.g. collision). */
  wouldCollide?: (jointsDeg: number[]) => boolean;
}
```

In the function signature:

```tsx
export function JointDragHandles({ robot, jointsDeg, enabled, onJointsChange, wouldCollide }: Props) {
```

In `onPointerMove`, replace the final `onJointsChange(next);` with:

```tsx
if (wouldCollide?.(next)) return; // collision gate
onJointsChange(next);
```

- [ ] **Step 2: Same wiring in IKGizmo**

Edit `src/frontend/src/pages/SimulationPage/components/IKGizmo.tsx`. Add to `Props`:

```tsx
interface Props {
  robot: URDFRobot;
  jointsDeg: number[];
  enabled: boolean;
  onJointsChange: (next: number[]) => void;
  onUnreachable?: () => void;
  solve: (target: Vector3, currentRad: number[]) => number[] | null;
  wouldCollide?: (jointsDeg: number[]) => boolean;
}
```

Function signature:

```tsx
export function IKGizmo({
  robot,
  jointsDeg,
  enabled,
  onJointsChange,
  onUnreachable,
  solve,
  wouldCollide,
}: Props) {
```

Inside `handleObjectChange`, just before `onJointsChange(...)`:

```tsx
const nextDeg = result.map((r) => (r * 180) / Math.PI);
if (wouldCollide?.(nextDeg)) return; // collision gate
onJointsChange(nextDeg);
```

(Replace the existing `onJointsChange(result.map(...))` line with these two lines.)

- [ ] **Step 3: Type-check**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && npx tsc --noEmit --pretty false --project tsconfig.json 2>&1 | grep -iE "JointDragHandles|IKGizmo" | head -10
```
Expected: 0 errors.

- [ ] **Step 4: Run jest**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && npx jest src/pages/SimulationPage/__tests__ 2>&1 | tail -5
```
Expected: 35 passed (32 prior + 3 D1 collision tests). No regressions.

- [ ] **Step 5: Commit**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi && \
  git add src/frontend/src/pages/SimulationPage/components/JointDragHandles.tsx \
          src/frontend/src/pages/SimulationPage/components/IKGizmo.tsx && \
  git commit -m "feat(robot-hmi): drag handlers gain wouldCollide gate"
```

---

## Task D5: Wire collision into SimulationPage + PROGRESS + push

**Files:**
- Modify: `src/frontend/src/pages/SimulationPage/index.tsx`
- Modify: `/Users/kenhuang/Desktop/Dev/PROGRESS.md`

**Goal:** Use `useCollision` to keep a live `colliding: Set<string>` updated from the current joints. Pass `wouldCollide` to both drag components. Render `<CollisionViz>` inside the Scene. Update PROGRESS and push.

- [ ] **Step 1: Edit index.tsx**

Add imports near the existing ones:

```tsx
import { useMemo } from "react";  // already imported as part of "react" — check
import { CollisionViz } from "./components/CollisionViz";
import { useCollision } from "./hooks/useCollision";
```

Add a `useCollision` hook call alongside the existing hook destructures:

```tsx
const { check: checkCollision, ready: collisionReady } = useCollision(robot);
```

Compute `colliding` from current joints (memoized):

```tsx
const collidingLinkSet = useMemo(() => {
  if (!collisionReady) return new Set<string>();
  const jointsRad = joints.map((d) => (d * Math.PI) / 180);
  return checkCollision(jointsRad);
}, [joints, checkCollision, collisionReady]);
```

Build the `wouldCollide` predicate (returns true if a NEW collision would appear that wasn't already there):

```tsx
const wouldCollide = useMemo(
  () => (nextDeg: number[]): boolean => {
    if (!collisionReady) return false;
    const jointsRad = nextDeg.map((d) => (d * Math.PI) / 180);
    const next = checkCollision(jointsRad);
    // Allow leaving an existing collision; only block ENTERING a new one.
    for (const link of next) {
      if (!collidingLinkSet.has(link)) return true;
    }
    return false;
  },
  [checkCollision, collisionReady, collidingLinkSet],
);
```

Pass `wouldCollide` to both drag components inside `<Scene>`:

```tsx
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
```

- [ ] **Step 2: Type-check + jest**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && \
  npx tsc --noEmit --pretty false --project tsconfig.json 2>&1 | grep -iE "SimulationPage|CollisionViz" | head -10 && \
  npx jest src/pages/SimulationPage/__tests__ 2>&1 | tail -5
```
Expected: 0 errors, 35 tests passed.

- [ ] **Step 3: Edit PROGRESS.md**

Update Status:
- Phase: `P5 Phase D 完成 — 碰撞偵測`
- Last updated: today

Append under "What was just completed":

```markdown
### P5 Phase D（2026-05-09）— 碰撞偵測（three-mesh-bvh）
- 純 TS `collision.ts` — `buildLinkBVHs(robot)` 每 link 一個 BVH，`intersectGeometryPair()` 兩兩 BufferGeometry 求交，`collidingLinks(...)`/`checkCollisionsAt(...)`，3 unit tests
- `useCollision(robot)` — memoized BVH cache + 穩定 check callback
- `<CollisionViz>` — colliding link 上覆半透紅色 overlay
- `JointDragHandles` 與 `IKGizmo` 都新增 `wouldCollide?` prop；偵測到新碰撞就 revert（已在碰撞中的 link 允許脫離）
- SimulationPage 串起來：每幀依當前 joints 算 colliding，傳 wouldCollide 給拖拉，渲染 CollisionViz
- **35 frontend tests 全綠**
```

Update "Next actions" — Phase E next; Phase D is now done.

- [ ] **Step 4: Commit and push**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi && \
  git add src/frontend/src/pages/SimulationPage/index.tsx /Users/kenhuang/Desktop/Dev/PROGRESS.md && \
  git commit -m "feat(robot-hmi): wire collision detection into SimulationPage" && \
  git push origin main
```

If push to main is blocked, ask the user before retrying.

---

## Phase D Verification Checklist

- [ ] `cd src/frontend && npx jest src/pages/SimulationPage/__tests__` → 35 passed
- [ ] `cd src/frontend && npx tsc --noEmit ...` → no errors in any new file
- [ ] Visual: open `/simulation`, switch to Sandbox + FK; drag a joint until two links visibly overlap → red overlay appears, but the joint may still move (since you started inside collision)
- [ ] From a clean home pose, drag toward a collision configuration → joint stops just before the overlap (drag-revert), red overlay does NOT appear
- [ ] Switch to IK; drag the gizmo so the wrist would crash into the base → IK update is rejected, joints unchanged

---

## Self-Review (done)

- ✅ Spec coverage: D1 covers BVH build + intersection (spec §6 step 1+2); D2 wraps as React hook; D3 is the viz; D4 is drag-revert (spec §6 "FK / IK drag: revert"); D5 wires it all + Sync mode automatically benefits because `setJoints` won't be called when `wouldCollide` triggers, so no debounced MOVE either.
- ✅ No placeholders: every code-bearing step contains complete code.
- ✅ Type consistency: `LinkBVH` shape, `useCollision` return type `{check, ready}`, `wouldCollide` signature `(jointsDeg: number[]) => boolean` — all stable across files.
- ✅ Tests: pure intersection logic gets unit tests (synthetic BoxGeometry pairs); the URDF-walking + React glue rely on visual smoke since the underlying logic is verified.
