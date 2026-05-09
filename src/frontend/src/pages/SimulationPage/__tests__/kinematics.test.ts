import { Vector3 } from "three";
import { type KinematicChain, forwardKinematics } from "../hooks/kinematics";

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
