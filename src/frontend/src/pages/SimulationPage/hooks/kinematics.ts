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
    tmp.makeTranslation(j.origin.x, j.origin.y, j.origin.z);
    m.multiply(tmp);
    q.setFromAxisAngle(j.axis, jointsRad[i]);
    tmp.makeRotationFromQuaternion(q);
    m.multiply(tmp);
  }

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
 * Assumes the robot has joints named j1..j6 (the mock_6dof URDF). Returns
 * null if the robot's structure doesn't match expectations.
 */
export function urdfToChain(robot: URDFRobot): KinematicChain | null {
  const joints: JointSpec[] = [];
  for (const name of JOINT_NAMES) {
    const j = (robot as any).joints?.[name];
    if (!j) return null;
    const axis = (j.axis as Vector3).clone().normalize();
    const origin = (j.position as Vector3).clone();
    const lower = typeof j.limit?.lower === "number" ? j.limit.lower : -Math.PI;
    const upper = typeof j.limit?.upper === "number" ? j.limit.upper : Math.PI;
    joints.push({ axis, origin, limit: { lower, upper } });
  }

  const tcp = (robot as any).links?.[TCP_LINK];
  if (!tcp) return null;
  const tcpOffset = (tcp.position as Vector3).clone();

  return { joints, tcpOffset };
}
