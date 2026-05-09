import { Matrix4, Quaternion, Vector3 } from "three";
import type { URDFRobot } from "urdf-loader/src/URDFClasses";
import {
  getActuatedJointNames,
  getEndEffectorLinkName,
} from "./urdfChain";

export interface JointSpec {
  /** Rotation axis in the joint's local frame (normalized). */
  axis: Vector3;
  /** Translation of this joint's frame relative to its parent. */
  origin: Vector3;
  /** Static rotation of this joint's frame relative to its parent (URDF rpy). Identity if absent. */
  originRot?: Quaternion;
  /** [lower, upper] in radians. */
  limit: { lower: number; upper: number };
}

export interface KinematicChain {
  joints: JointSpec[];
  /** Offset from the last joint frame to the TCP, in the last joint's local frame. */
  tcpOffset: Vector3;
}

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
    if (j.originRot) {
      tmp.makeRotationFromQuaternion(j.originRot);
      m.multiply(tmp);
    }
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

export function urdfToChain(robot: URDFRobot): KinematicChain | null {
  const names = getActuatedJointNames(robot);
  if (names.length === 0) return null;

  const joints: JointSpec[] = [];
  for (const name of names) {
    const j = (robot as any).joints?.[name];
    if (!j) return null;
    const axis = (j.axis as Vector3).clone().normalize();
    const origin = (j.position as Vector3).clone();
    const originRot = (j.quaternion as Quaternion).clone();
    const lower = typeof j.limit?.lower === "number" ? j.limit.lower : -Math.PI;
    const upper = typeof j.limit?.upper === "number" ? j.limit.upper : Math.PI;
    joints.push({ axis, origin, originRot, limit: { lower, upper } });
  }

  const tcpName = getEndEffectorLinkName(robot);
  if (!tcpName) return null;
  const tcp = (robot as any).links?.[tcpName];
  if (!tcp) return null;
  const tcpOffset = (tcp.position as Vector3).clone();

  return { joints, tcpOffset };
}
