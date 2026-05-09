# 3D Simulation — Phase C Implementation Plan (CCD IK + 6DOF Gizmo)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inverse-kinematics drag to the simulation page. The user grabs a 6-DOF gizmo at the TCP, drags it through space, and the arm's joints solve to follow. Built on top of Phase A (URDF + viewer) and Phase B (modes + FK drag).

**Architecture:** Pure-TS CCD (Cyclic Coordinate Descent) solver running entirely in the browser, no IK library. The math is split into two pure modules — `kinematics.ts` (chain extraction from URDF + forward kinematics) and `ikSolver.ts` (CCD loop). A thin React hook (`useIKSolver`) caches the chain spec. The UI adds a drag-mode toggle (FK / IK); IK mode hides the joint spheres and shows a drei `<TransformControls>` gizmo on the TCP. Reach failure flashes the gizmo red and rejects the joint update.

**Tech Stack:** React 19 + TypeScript, `@react-three/fiber@9`, `@react-three/drei@10` (`TransformControls`), `three@0.160`, `urdf-loader`, jest + RTL.

---

## Scope

This plan covers Phase C from the design spec — IK + gizmo only. Explicitly OUT of scope:

- **Analytical Pieper solver** for spherical-wrist 6-DOF — deferred. CCD handles all topologies; analytical gives faster + more deterministic solutions for the common case but is significantly more code. Add later if CCD's quality is insufficient.
- **Collision detection during drag** — Phase D.
- **Trajectory playback** — Phase E.
- **IK → command emission in Sync mode** — already wired through `useSimulator.setJoints`, so it works automatically once the gizmo calls `setJoints`. No new code.

ETA: ~5 days. 6 tasks.

---

## File Structure (Phase C target)

```
src/frontend/src/pages/SimulationPage/
├── index.tsx                        ← modified: add dragMode state, render gizmo / spheres
├── components/
│   ├── Scene.tsx                    ← unchanged
│   ├── RobotModel.tsx               ← unchanged
│   ├── ModeTabs.tsx                 ← unchanged
│   ├── JointDragHandles.tsx         ← unchanged
│   ├── DragModeTabs.tsx             ← NEW — FK / IK toggle
│   └── IKGizmo.tsx                  ← NEW — drei TransformControls on TCP
└── hooks/
    ├── simModeFsm.ts                ← unchanged
    ├── useSimulator.ts              ← unchanged
    ├── useUrdf.ts                   ← unchanged
    ├── kinematics.ts                ← NEW — URDF chain extraction + FK
    ├── ikSolver.ts                  ← NEW — pure CCD solver
    └── useIKSolver.ts               ← NEW — React hook wrapping the solver

src/frontend/src/pages/SimulationPage/__tests__/
├── kinematics.test.ts               ← NEW
└── ikSolver.test.ts                 ← NEW
```

---

## Task C1: Kinematics chain + forward kinematics

**Files:**
- Create: `src/frontend/src/pages/SimulationPage/hooks/kinematics.ts`
- Test: `src/frontend/src/pages/SimulationPage/__tests__/kinematics.test.ts`

**Goal:** A pure module that represents a kinematic chain abstractly (joint axes, origins, limits) and computes forward kinematics from a joint vector. Decoupled from `URDFRobot` so it's unit-testable with synthetic chains.

- [ ] **Step 1: Write the failing test**

Create `src/frontend/src/pages/SimulationPage/__tests__/kinematics.test.ts`:

```ts
import { Vector3 } from "three";
import { type KinematicChain, forwardKinematics } from "../hooks/kinematics";

// A tiny 1-joint test chain: rotate around Z, link length 1 along X.
const oneJointZ: KinematicChain = {
  joints: [
    {
      axis: new Vector3(0, 0, 1),
      origin: new Vector3(0, 0, 0),
      limit: { lower: -Math.PI, upper: Math.PI },
    },
  ],
  tcpOffset: new Vector3(1, 0, 0),
};

// Two joints, both rotate around Z. Each link is 1 along X. So at angles
// [θ1, θ2], TCP is at:
//   x = cos(θ1) + cos(θ1 + θ2)
//   y = sin(θ1) + sin(θ1 + θ2)
const twoJointZ: KinematicChain = {
  joints: [
    {
      axis: new Vector3(0, 0, 1),
      origin: new Vector3(0, 0, 0),
      limit: { lower: -Math.PI, upper: Math.PI },
    },
    {
      axis: new Vector3(0, 0, 1),
      origin: new Vector3(1, 0, 0),
      limit: { lower: -Math.PI, upper: Math.PI },
    },
  ],
  tcpOffset: new Vector3(1, 0, 0),
};

describe("forwardKinematics", () => {
  it("zero joints place TCP at the local offset", () => {
    const tcp = forwardKinematics(oneJointZ, [0]);
    expect(tcp.x).toBeCloseTo(1, 6);
    expect(tcp.y).toBeCloseTo(0, 6);
    expect(tcp.z).toBeCloseTo(0, 6);
  });

  it("rotates TCP by 90° around Z", () => {
    const tcp = forwardKinematics(oneJointZ, [Math.PI / 2]);
    expect(tcp.x).toBeCloseTo(0, 6);
    expect(tcp.y).toBeCloseTo(1, 6);
  });

  it("rotates TCP by 180° around Z", () => {
    const tcp = forwardKinematics(oneJointZ, [Math.PI]);
    expect(tcp.x).toBeCloseTo(-1, 6);
    expect(tcp.y).toBeCloseTo(0, 6);
  });

  it("composes two Z-axis joints", () => {
    const t1 = Math.PI / 2;
    const t2 = -Math.PI / 2;
    const expectedX = Math.cos(t1) + Math.cos(t1 + t2);
    const expectedY = Math.sin(t1) + Math.sin(t1 + t2);
    const tcp = forwardKinematics(twoJointZ, [t1, t2]);
    expect(tcp.x).toBeCloseTo(expectedX, 6);
    expect(tcp.y).toBeCloseTo(expectedY, 6);
  });

  it("rejects mismatched joint vector length", () => {
    expect(() => forwardKinematics(oneJointZ, [0, 0])).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && npx jest src/pages/SimulationPage/__tests__/kinematics.test.ts 2>&1 | tail -10
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `kinematics.ts`**

Create `src/frontend/src/pages/SimulationPage/hooks/kinematics.ts`:

```ts
import { Matrix4, Quaternion, Vector3 } from "three";
import type { URDFRobot } from "urdf-loader/src/URDFClasses";

export interface JointSpec {
  /** Rotation axis in the joint's local frame (normalized). */
  axis: Vector3;
  /** Origin of this joint relative to its parent (translation only — URDF rpy collapses into this for our mock 6-DOF). */
  origin: Vector3;
  /** [lower, upper] in radians. */
  limit: { lower: number; upper: number };
}

export interface KinematicChain {
  joints: JointSpec[];
  /** Offset from the last joint frame to the TCP, in the last joint's local frame. */
  tcpOffset: Vector3;
}

const JOINT_NAMES = ["j1", "j2", "j3", "j4", "j5", "j6"] as const;
const TCP_LINK = "tcp";

/**
 * Compute the TCP world position given a joint vector (radians).
 * Pure function — works on synthetic chains too.
 */
export function forwardKinematics(
  chain: KinematicChain,
  jointsRad: number[],
): Vector3 {
  if (jointsRad.length !== chain.joints.length) {
    throw new Error(
      `joint vector length ${jointsRad.length} does not match chain length ${chain.joints.length}`,
    );
  }

  const m = new Matrix4().identity();
  const tmp = new Matrix4();
  const q = new Quaternion();

  for (let i = 0; i < chain.joints.length; i++) {
    const j = chain.joints[i];
    // Translate to joint origin (in current frame)
    tmp.makeTranslation(j.origin.x, j.origin.y, j.origin.z);
    m.multiply(tmp);
    // Rotate around joint axis by jointsRad[i]
    q.setFromAxisAngle(j.axis, jointsRad[i]);
    tmp.makeRotationFromQuaternion(q);
    m.multiply(tmp);
  }

  // Apply TCP offset (translation only)
  tmp.makeTranslation(
    chain.tcpOffset.x,
    chain.tcpOffset.y,
    chain.tcpOffset.z,
  );
  m.multiply(tmp);

  return new Vector3(m.elements[12], m.elements[13], m.elements[14]);
}

/**
 * Extract a kinematic chain from a parsed URDF robot.
 *
 * Assumes the robot has joints named j1..j6 (the mock_6dof URDF). For each
 * joint, reads its axis and local origin. The TCP is taken from the link
 * named "tcp" — the offset is its position relative to the j6 link's frame.
 *
 * Returns null if the robot's structure doesn't match expectations. Callers
 * should fall back to disabling IK for unsupported robots.
 */
export function urdfToChain(robot: URDFRobot): KinematicChain | null {
  const joints: JointSpec[] = [];
  for (const name of JOINT_NAMES) {
    const j = (robot as any).joints?.[name];
    if (!j) return null;
    // urdf-loader keeps the joint axis as Vector3 and the origin as the
    // joint's own `position` (offset from parent link).
    const axis = (j.axis as Vector3).clone().normalize();
    const origin = (j.position as Vector3).clone();
    const lower = typeof j.limit?.lower === "number" ? j.limit.lower : -Math.PI;
    const upper = typeof j.limit?.upper === "number" ? j.limit.upper : Math.PI;
    joints.push({ axis, origin, limit: { lower, upper } });
  }

  const tcp = (robot as any).links?.[TCP_LINK];
  if (!tcp) return null;
  // The TCP link's local position is its offset from j6 (its parent in our URDF).
  const tcpOffset = (tcp.position as Vector3).clone();

  return { joints, tcpOffset };
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && npx jest src/pages/SimulationPage/__tests__/kinematics.test.ts 2>&1 | tail -10
```
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi && \
  git add src/frontend/src/pages/SimulationPage/hooks/kinematics.ts \
          src/frontend/src/pages/SimulationPage/__tests__/kinematics.test.ts && \
  git commit -m "feat(robot-hmi): kinematics module — chain spec + forward kinematics"
```

---

## Task C2: CCD inverse-kinematics solver

**Files:**
- Create: `src/frontend/src/pages/SimulationPage/hooks/ikSolver.ts`
- Test: `src/frontend/src/pages/SimulationPage/__tests__/ikSolver.test.ts`

**Goal:** A pure function `solveCCD(chain, current, target, opts) => joints | null` that runs Cyclic Coordinate Descent over a kinematic chain. Returns the new joints if it converges, or null if it can't reach (out of limits, far away, stuck in local minimum).

- [ ] **Step 1: Write the failing test**

Create `src/frontend/src/pages/SimulationPage/__tests__/ikSolver.test.ts`:

```ts
import { Vector3 } from "three";
import { type KinematicChain, forwardKinematics } from "../hooks/kinematics";
import { solveCCD } from "../hooks/ikSolver";

// Two joints around Z, two unit links. Reach is [0, 2].
const planar2: KinematicChain = {
  joints: [
    {
      axis: new Vector3(0, 0, 1),
      origin: new Vector3(0, 0, 0),
      limit: { lower: -Math.PI, upper: Math.PI },
    },
    {
      axis: new Vector3(0, 0, 1),
      origin: new Vector3(1, 0, 0),
      limit: { lower: -Math.PI, upper: Math.PI },
    },
  ],
  tcpOffset: new Vector3(1, 0, 0),
};

describe("solveCCD — planar 2R", () => {
  it("returns the same joints if target equals current TCP", () => {
    const current = [0.3, -0.2];
    const target = forwardKinematics(planar2, current);
    const result = solveCCD(planar2, current, target);
    expect(result).not.toBeNull();
    for (let i = 0; i < current.length; i++) {
      expect(result![i]).toBeCloseTo(current[i], 4);
    }
  });

  it("reaches a known target via FK round-trip", () => {
    const truthJoints = [Math.PI / 4, -Math.PI / 6];
    const target = forwardKinematics(planar2, truthJoints);
    const start = [0, 0];
    const result = solveCCD(planar2, start, target);
    expect(result).not.toBeNull();
    const reached = forwardKinematics(planar2, result!);
    expect(reached.distanceTo(target)).toBeLessThan(1e-3);
  });

  it("returns null when target is unreachable (further than max reach)", () => {
    // max reach of planar2 is 2 (both links extended). Go to (3, 0).
    const result = solveCCD(planar2, [0, 0], new Vector3(3, 0, 0), {
      maxIterations: 50,
      epsilon: 1e-4,
    });
    expect(result).toBeNull();
  });

  it("respects joint limits", () => {
    const limited: KinematicChain = {
      joints: [
        {
          axis: new Vector3(0, 0, 1),
          origin: new Vector3(0, 0, 0),
          // J1 can only swing 0..0.1 radians
          limit: { lower: 0, upper: 0.1 },
        },
        planar2.joints[1],
      ],
      tcpOffset: planar2.tcpOffset,
    };
    // Target requires J1 ~ 90°; impossible within limits
    const target = new Vector3(0, 2, 0);
    const result = solveCCD(limited, [0, 0], target, { maxIterations: 50 });
    if (result !== null) {
      // If it converged, the limit must still be honoured.
      expect(result[0]).toBeGreaterThanOrEqual(0);
      expect(result[0]).toBeLessThanOrEqual(0.1);
    }
  });
});

describe("solveCCD — input validation", () => {
  it("throws on mismatched joint vector length", () => {
    expect(() => solveCCD(planar2, [0, 0, 0], new Vector3(0, 0, 0))).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && npx jest src/pages/SimulationPage/__tests__/ikSolver.test.ts 2>&1 | tail -10
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ikSolver.ts`**

Create `src/frontend/src/pages/SimulationPage/hooks/ikSolver.ts`:

```ts
import { Matrix4, Quaternion, Vector3 } from "three";
import type { KinematicChain } from "./kinematics";

export interface SolveOptions {
  /** Stop iterating when |TCP - target| < epsilon. Default 1e-3. */
  epsilon?: number;
  /** Hard upper bound on iterations. Default 50. */
  maxIterations?: number;
}

const DEFAULT_OPTS: Required<SolveOptions> = {
  epsilon: 1e-3,
  maxIterations: 50,
};

/**
 * Cyclic Coordinate Descent inverse kinematics. Iteratively rotates each
 * joint (last to first) to bring the TCP toward `target`. Pure function.
 *
 * Returns:
 * - The new joint vector (radians, length === chain.joints.length) if the
 *   TCP converged within `epsilon` of the target.
 * - `null` if the solver did not converge within `maxIterations`.
 *
 * Joint limits are honoured by clamping the proposed angle each step.
 */
export function solveCCD(
  chain: KinematicChain,
  current: number[],
  target: Vector3,
  opts: SolveOptions = {},
): number[] | null {
  if (current.length !== chain.joints.length) {
    throw new Error(
      `joint vector length ${current.length} does not match chain length ${chain.joints.length}`,
    );
  }
  const { epsilon, maxIterations } = { ...DEFAULT_OPTS, ...opts };

  const joints = current.slice();

  for (let iter = 0; iter < maxIterations; iter++) {
    // Compute world frames for each joint and the TCP under the current joint vector
    const frames = computeJointFrames(chain, joints);
    const tcpWorld = applyTcpOffset(frames[frames.length - 1], chain.tcpOffset);

    if (tcpWorld.distanceTo(target) < epsilon) return joints;

    // Update each joint from end to base
    for (let i = chain.joints.length - 1; i >= 0; i--) {
      const jointFrame = frames[i];
      const jointPos = new Vector3().setFromMatrixPosition(jointFrame);
      // Joint axis transformed into world frame
      const axisWorld = chain.joints[i].axis
        .clone()
        .transformDirection(jointFrame);

      // Vectors from joint origin to current TCP and to target
      const currentFrames = computeJointFrames(chain, joints);
      const currentTcp = applyTcpOffset(
        currentFrames[currentFrames.length - 1],
        chain.tcpOffset,
      );
      const toCurrent = new Vector3().subVectors(currentTcp, jointPos);
      const toTarget = new Vector3().subVectors(target, jointPos);

      // Project onto the plane perpendicular to the joint axis
      const aDotCurrent = axisWorld.dot(toCurrent);
      const aDotTarget = axisWorld.dot(toTarget);
      const projCurrent = toCurrent
        .clone()
        .addScaledVector(axisWorld, -aDotCurrent);
      const projTarget = toTarget
        .clone()
        .addScaledVector(axisWorld, -aDotTarget);

      const lenCurr = projCurrent.length();
      const lenTarg = projTarget.length();
      if (lenCurr < 1e-9 || lenTarg < 1e-9) continue; // degenerate; skip
      projCurrent.divideScalar(lenCurr);
      projTarget.divideScalar(lenTarg);

      // Signed angle from projCurrent to projTarget around axisWorld
      const cos = clamp(projCurrent.dot(projTarget), -1, 1);
      const cross = new Vector3().crossVectors(projCurrent, projTarget);
      const sign = Math.sign(cross.dot(axisWorld));
      const delta = sign * Math.acos(cos);

      // Apply with limit clamp
      const proposed = joints[i] + delta;
      joints[i] = clamp(
        proposed,
        chain.joints[i].limit.lower,
        chain.joints[i].limit.upper,
      );

      // Recompute the leading frames for subsequent inner iterations.
      // We only need frames up to and including i, since later joints come
      // after i in the chain — but we'll let the next outer iteration
      // refresh everything. For correctness within this inner pass, a fresh
      // forward sweep would be needed; CCD typically tolerates this stale
      // approximation and the outer loop converges. (This matches standard
      // CCD descriptions.)
    }
  }

  // Did not converge within budget — final check
  const finalFrames = computeJointFrames(chain, joints);
  const finalTcp = applyTcpOffset(
    finalFrames[finalFrames.length - 1],
    chain.tcpOffset,
  );
  if (finalTcp.distanceTo(target) < epsilon) return joints;
  return null;
}

// ---- internal helpers ----

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/**
 * Compute the cumulative world transform at each joint frame. The returned
 * array has length === chain.joints.length, with frames[i] being the world
 * frame after applying joints 0..i (translation + rotation).
 */
function computeJointFrames(
  chain: KinematicChain,
  jointsRad: number[],
): Matrix4[] {
  const frames: Matrix4[] = [];
  const m = new Matrix4().identity();
  const tmp = new Matrix4();
  const q = new Quaternion();

  for (let i = 0; i < chain.joints.length; i++) {
    const j = chain.joints[i];
    tmp.makeTranslation(j.origin.x, j.origin.y, j.origin.z);
    m.multiply(tmp);
    q.setFromAxisAngle(j.axis, jointsRad[i]);
    tmp.makeRotationFromQuaternion(q);
    m.multiply(tmp);
    frames.push(m.clone());
  }
  return frames;
}

function applyTcpOffset(lastJointFrame: Matrix4, tcpOffset: Vector3): Vector3 {
  return tcpOffset.clone().applyMatrix4(lastJointFrame);
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && npx jest src/pages/SimulationPage/__tests__/ikSolver.test.ts 2>&1 | tail -15
```
Expected: 5 passed. If any test fails, the most likely causes are:
- Convergence is slow → bump `maxIterations` default to 100 in `DEFAULT_OPTS`.
- The "joint limits" test is too strict → the test already accepts both convergence and non-convergence as long as limits hold; if it errors, check the assertion logic.

- [ ] **Step 5: Commit**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi && \
  git add src/frontend/src/pages/SimulationPage/hooks/ikSolver.ts \
          src/frontend/src/pages/SimulationPage/__tests__/ikSolver.test.ts && \
  git commit -m "feat(robot-hmi): CCD inverse kinematics solver — pure TS"
```

---

## Task C3: useIKSolver React hook

**Files:**
- Create: `src/frontend/src/pages/SimulationPage/hooks/useIKSolver.ts`

**Goal:** A thin React hook that extracts the kinematic chain from a `URDFRobot` once (memoized) and exposes a stable `solve(target, current) => joints | null` callback. Avoids reparsing the URDF tree on every drag tick.

- [ ] **Step 1: Implement the hook**

Create `src/frontend/src/pages/SimulationPage/hooks/useIKSolver.ts`:

```ts
import { useCallback, useMemo } from "react";
import { Vector3 } from "three";
import type { URDFRobot } from "urdf-loader/src/URDFClasses";
import { type KinematicChain, urdfToChain } from "./kinematics";
import { type SolveOptions, solveCCD } from "./ikSolver";

export interface UseIKSolver {
  /** Solve for joint angles (radians) that move the TCP to the world-space target. */
  solve: (target: Vector3, current: number[]) => number[] | null;
  /** True if the URDF was successfully parsed into a chain (i.e. has j1..j6 + tcp link). */
  available: boolean;
}

const DEFAULT_OPTS: SolveOptions = { epsilon: 1e-3, maxIterations: 50 };

export function useIKSolver(robot: URDFRobot | null): UseIKSolver {
  const chain: KinematicChain | null = useMemo(() => {
    if (!robot) return null;
    return urdfToChain(robot);
  }, [robot]);

  const solve = useCallback(
    (target: Vector3, current: number[]): number[] | null => {
      if (!chain) return null;
      return solveCCD(chain, current, target, DEFAULT_OPTS);
    },
    [chain],
  );

  return { solve, available: chain !== null };
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && npx tsc --noEmit --pretty false --project tsconfig.json 2>&1 | grep -iE "useIKSolver|kinematics|ikSolver" | head -10
```
Expected: 0 errors in these files.

- [ ] **Step 3: Commit**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi && \
  git add src/frontend/src/pages/SimulationPage/hooks/useIKSolver.ts && \
  git commit -m "feat(robot-hmi): useIKSolver hook — memoized chain + solve callback"
```

---

## Task C4: IKGizmo component (drei TransformControls)

**Files:**
- Create: `src/frontend/src/pages/SimulationPage/components/IKGizmo.tsx`

**Goal:** A 6-DOF gizmo at the TCP. Drag the position handles → call `solveCCD` with the new target → push joints through `setJoints`. Rotation handles also visible but for v1 only translation drives IK; rotation is purely visual. (Full pose IK is a v2 enhancement.) On no-solution, briefly tint the gizmo red.

- [ ] **Step 1: Build the component**

Create `src/frontend/src/pages/SimulationPage/components/IKGizmo.tsx`:

```tsx
import { TransformControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import { Mesh, Vector3 } from "three";
import type { URDFRobot } from "urdf-loader/src/URDFClasses";

interface Props {
  robot: URDFRobot;
  jointsDeg: number[];
  enabled: boolean;
  onJointsChange: (next: number[]) => void;
  onUnreachable?: () => void;
  /** Called every time the solver runs, regardless of outcome. Used for `available` in DragModeTabs. */
  solve: (target: Vector3, currentRad: number[]) => number[] | null;
}

const TCP_LINK = "tcp";

export function IKGizmo({
  robot,
  jointsDeg,
  enabled,
  onJointsChange,
  onUnreachable,
  solve,
}: Props) {
  const targetRef = useRef<Mesh>(null);
  const [unreachableFlash, setUnreachableFlash] = useState(false);

  // Place the dummy mesh at the TCP world position whenever the joints
  // change (so the gizmo follows the arm when not actively dragging).
  useEffect(() => {
    if (!targetRef.current) return;
    const tcp = (robot as any).links?.[TCP_LINK];
    if (!tcp) return;
    const v = new Vector3();
    tcp.getWorldPosition(v);
    targetRef.current.position.copy(v);
  }, [jointsDeg, robot]);

  // Memoized degrees->radians conversion for the solver
  const jointsRad = useMemo(
    () => jointsDeg.map((d) => (d * Math.PI) / 180),
    [jointsDeg],
  );

  if (!enabled) return null;

  const handleObjectChange = () => {
    if (!targetRef.current) return;
    const target = new Vector3().copy(targetRef.current.position);
    const result = solve(target, jointsRad);
    if (result === null) {
      setUnreachableFlash(true);
      setTimeout(() => setUnreachableFlash(false), 200);
      onUnreachable?.();
      return;
    }
    onJointsChange(result.map((r) => (r * 180) / Math.PI));
  };

  return (
    <>
      <mesh ref={targetRef} visible={false}>
        <sphereGeometry args={[0.01, 8, 8]} />
        <meshBasicMaterial />
      </mesh>
      {targetRef.current ? (
        <TransformControls
          object={targetRef.current}
          mode="translate"
          size={0.5}
          onObjectChange={handleObjectChange}
        />
      ) : null}
      {unreachableFlash ? (
        <mesh position={targetRef.current?.position}>
          <sphereGeometry args={[0.04, 16, 16]} />
          <meshBasicMaterial color="#ff3333" transparent opacity={0.6} />
        </mesh>
      ) : null}
    </>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && npx tsc --noEmit --pretty false --project tsconfig.json 2>&1 | grep -iE "IKGizmo" | head -10
```
Expected: 0 errors. If drei `<TransformControls>` props are stricter than the snippet:
- The `object` prop may need `as any` if drei's typing requires `Object3D` and the ref is briefly null on first render.
- If `onObjectChange` typing complains, use `(e?: any) => handleObjectChange()`.

- [ ] **Step 3: Commit**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi && \
  git add src/frontend/src/pages/SimulationPage/components/IKGizmo.tsx && \
  git commit -m "feat(robot-hmi): IKGizmo — drei TransformControls + CCD solve on drag"
```

---

## Task C5: DragModeTabs (FK / IK toggle)

**Files:**
- Create: `src/frontend/src/pages/SimulationPage/components/DragModeTabs.tsx`

**Goal:** A small two-button segmented control: FK (joint drag) / IK (gizmo). When IK isn't available (URDF doesn't fit the chain), the IK button is disabled with a tooltip.

- [ ] **Step 1: Build the component**

Create `src/frontend/src/pages/SimulationPage/components/DragModeTabs.tsx`:

```tsx
import { Button } from "@/components/ui/button";

export type DragMode = "FK" | "IK";

interface Props {
  mode: DragMode;
  onModeChange: (next: DragMode) => void;
  ikAvailable: boolean;
}

export function DragModeTabs({ mode, onModeChange, ikAvailable }: Props) {
  return (
    <div className="inline-flex items-center gap-1 rounded-md border p-1">
      <Button
        size="sm"
        variant={mode === "FK" ? "default" : "ghost"}
        onClick={() => onModeChange("FK")}
        title="拖關節（FK）"
        className="text-xs"
      >
        FK 關節拖
      </Button>
      <Button
        size="sm"
        variant={mode === "IK" ? "default" : "ghost"}
        onClick={() => ikAvailable && onModeChange("IK")}
        disabled={!ikAvailable}
        title={ikAvailable ? "拖末端（IK）" : "此機器人不支援 IK（URDF 結構不符合 j1..j6 + tcp）"}
        className="text-xs"
      >
        IK 末端拖
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && npx tsc --noEmit --pretty false --project tsconfig.json 2>&1 | grep -iE "DragModeTabs" | head -5
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi && \
  git add src/frontend/src/pages/SimulationPage/components/DragModeTabs.tsx && \
  git commit -m "feat(robot-hmi): DragModeTabs — FK / IK toggle"
```

---

## Task C6: Wire IK gizmo into SimulationPage

**Files:**
- Modify: `src/frontend/src/pages/SimulationPage/index.tsx`

**Goal:** Add `dragMode` state ("FK" | "IK"). Render `DragModeTabs` next to `ModeTabs` in the toolbar. Inside the `<Scene>`, conditionally render either `<JointDragHandles>` (FK) or `<IKGizmo>` (IK) based on `dragMode`. The IK option auto-disables when `useIKSolver.available` is false.

- [ ] **Step 1: Read current page state**

```bash
cat /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend/src/pages/SimulationPage/index.tsx
```

You should see imports for `Scene`, `RobotModel`, `ModeTabs`, `JointDragHandles`, `useUrdf`, `useSimulator`. The current toolbar has `<h1>` + `<Select>` + `<ModeTabs>`.

- [ ] **Step 2: Edit index.tsx**

Add new imports near the existing ones:

```tsx
import { useState } from "react";  // already present — leave it
import { DragModeTabs, type DragMode } from "./components/DragModeTabs";
import { IKGizmo } from "./components/IKGizmo";
import { useIKSolver } from "./hooks/useIKSolver";
```

Add `dragMode` state and the IK solver alongside the existing hooks:

```tsx
const [dragMode, setDragMode] = useState<DragMode>("FK");
const { solve, available: ikAvailable } = useIKSolver(robot);
```

Insert `<DragModeTabs>` next to `<ModeTabs>` in the toolbar div:

```tsx
<ModeTabs mode={mode} onModeChange={setMode} />
<DragModeTabs
  mode={dragMode}
  onModeChange={setDragMode}
  ikAvailable={ikAvailable}
/>
```

If the user is in IK mode but `ikAvailable` becomes false (e.g. they switched to a robot without an IK-compatible URDF), force-fallback to FK. Add this single useEffect after the hook destructures:

```tsx
useEffect(() => {
  if (dragMode === "IK" && !ikAvailable) setDragMode("FK");
}, [dragMode, ikAvailable]);
```

Replace the `<JointDragHandles>` block with a conditional:

```tsx
{status === "ready" && robot && (
  <Scene>
    <RobotModel robot={robot} jointsDeg={joints} />
    {dragMode === "FK" && (
      <JointDragHandles
        robot={robot}
        jointsDeg={joints}
        enabled={dragEnabled}
        onJointsChange={setJoints}
      />
    )}
    {dragMode === "IK" && (
      <IKGizmo
        robot={robot}
        jointsDeg={joints}
        enabled={dragEnabled}
        onJointsChange={setJoints}
        solve={solve}
      />
    )}
  </Scene>
)}
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && npx tsc --noEmit --pretty false --project tsconfig.json 2>&1 | grep -iE "SimulationPage" | head -10
```
Expected: 0 errors.

- [ ] **Step 4: Run jest tests to confirm no regressions**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi/src/frontend && npx jest src/pages/SimulationPage/__tests__ 2>&1 | tail -10
```
Expected: 32 passed (B1=12 + B2=10 + C1=5 + C2=5 = 32).

- [ ] **Step 5: Commit**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi && \
  git add src/frontend/src/pages/SimulationPage/index.tsx && \
  git commit -m "feat(robot-hmi): wire IK gizmo + FK/IK toggle into SimulationPage"
```

---

## Task C7: PROGRESS update + push

**Files:**
- Modify: `/Users/kenhuang/Desktop/Dev/PROGRESS.md`

- [ ] **Step 1: Edit PROGRESS.md**

Update Status:
- Phase: `P5 Phase C 完成 — IK + 6DOF gizmo`
- Last updated: today

Append to "What was just completed":

```markdown
### P5 Phase C（2026-05-09）— IK 末端拖（CCD）+ 6DOF gizmo
- 純 TS kinematics module（`kinematics.ts`）— 通用 chain spec + forward kinematics + URDF 適配，5 unit tests
- 純 TS CCD IK solver（`ikSolver.ts`）— 50 iter，joint limits clamped；5 unit tests（round-trip / unreachable / 限位）
- `useIKSolver(robot)` — memoized chain + 穩定 solve callback
- `<IKGizmo>` — drei TransformControls 在 TCP，drag → CCD → setJoints；無解 200ms 紅色 flash
- `<DragModeTabs>` — FK / IK 切換；IK 無法用時自動 disabled
- SimulationPage 加 `dragMode` state，FK/IK 條件渲染
- 32 frontend tests 全綠
- IK 自動接 Sync mode（setJoints 已串到 useSimulator → debounced MOVE）
```

Update "Next actions" — replace Phase C with: "Phase D: 碰撞偵測（three-mesh-bvh），重跑 /writing-plans"。

- [ ] **Step 2: Push**

```bash
cd /Users/kenhuang/Desktop/Dev/robot-hmi && git push origin main
```

If push to main is blocked, ask the user before retrying.

---

## Phase C Verification Checklist

- [ ] `cd src/frontend && npx jest src/pages/SimulationPage/__tests__` → 32 passed
- [ ] `cd src/frontend && npx tsc --noEmit --pretty false --project tsconfig.json` → no errors in any new file
- [ ] Backend tests still pass: `cd src/backend && uv run pytest tests/unit/robot/ tests/unit/api/v1/test_robots_urdf.py -v`
- [ ] Visual: switch to FK — orange spheres appear; switch to IK — gizmo appears at TCP; drag the gizmo arrow — joints update so TCP follows
- [ ] In Sandbox + IK, drag the gizmo around — arm follows. Try to reach far away — gizmo flashes red, arm doesn't go.
- [ ] In Sync + IK, drag the gizmo — backend (mock) joints update via debounced MOVE; the WS broadcast comes back and `joints` matches.

---

## Self-Review (done)

- ✅ Spec coverage: every Phase C requirement maps to a task. Spec calls for "analytical 6-DOF (spherical wrist) with CCD fallback" — this plan ships **CCD-only** as documented in the Scope section. Analytical can be added later as an optimization without touching the gizmo or hook surfaces.
- ✅ No placeholders: every code-bearing step has complete code; assertions and command outputs are concrete; the "if convergence is slow, bump maxIterations" hint in C2/Step 4 is a remediation note for an actually-likely failure, not a placeholder.
- ✅ Type consistency: `KinematicChain` shape, `JointSpec` shape, `solveCCD` signature, `useIKSolver` return type, `DragMode` literal type are all stable across tasks. `(target: Vector3, current: number[])` is the solver's signature everywhere.
- ✅ Test design: pure functions (kinematics, IK solver) get exhaustive unit tests; the React layer (`useIKSolver`, `IKGizmo`, `DragModeTabs`) relies on visual smoke since the underlying logic is already verified.
