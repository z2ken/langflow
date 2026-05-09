import { Matrix4, Quaternion, Vector3 } from "three";
import type { KinematicChain } from "./kinematics";

export interface SolveOptions {
  /** Stop iterating when |TCP - target| < epsilon. Default 1e-3. */
  epsilon?: number;
  /** Hard upper bound on iterations. Default 100. */
  maxIterations?: number;
}

const DEFAULT_OPTS: Required<SolveOptions> = {
  epsilon: 1e-3,
  maxIterations: 100,
};

/**
 * Cyclic Coordinate Descent inverse kinematics. Iteratively rotates each
 * joint (last to first) to bring the TCP toward `target`. Pure function.
 *
 * Returns the new joint vector if converged within `epsilon`, else `null`.
 * Joint limits are honoured by clamping each step.
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
    const frames = computeJointFrames(chain, joints);
    const tcpWorld = applyTcpOffset(frames[frames.length - 1], chain.tcpOffset);

    if (tcpWorld.distanceTo(target) < epsilon) return joints;

    for (let i = chain.joints.length - 1; i >= 0; i--) {
      const jointFrame = frames[i];
      const jointPos = new Vector3().setFromMatrixPosition(jointFrame);
      const axisWorld = chain.joints[i].axis
        .clone()
        .transformDirection(jointFrame);

      const currentFrames = computeJointFrames(chain, joints);
      const currentTcp = applyTcpOffset(
        currentFrames[currentFrames.length - 1],
        chain.tcpOffset,
      );
      const toCurrent = new Vector3().subVectors(currentTcp, jointPos);
      const toTarget = new Vector3().subVectors(target, jointPos);

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
      if (lenCurr < 1e-9 || lenTarg < 1e-9) continue;
      projCurrent.divideScalar(lenCurr);
      projTarget.divideScalar(lenTarg);

      const cos = clamp(projCurrent.dot(projTarget), -1, 1);
      const cross = new Vector3().crossVectors(projCurrent, projTarget);
      const sign = Math.sign(cross.dot(axisWorld));
      const delta = sign * Math.acos(cos);

      const proposed = joints[i] + delta;
      joints[i] = clamp(
        proposed,
        chain.joints[i].limit.lower,
        chain.joints[i].limit.upper,
      );
    }
  }

  const finalFrames = computeJointFrames(chain, joints);
  const finalTcp = applyTcpOffset(
    finalFrames[finalFrames.length - 1],
    chain.tcpOffset,
  );
  if (finalTcp.distanceTo(target) < epsilon) return joints;
  return null;
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/** Compute cumulative world frames at each joint. */
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
