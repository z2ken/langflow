import { Vector3 } from "three";
import { type KinematicChain, forwardKinematics } from "../hooks/kinematics";
import { solveCCD } from "../hooks/ikSolver";

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
          limit: { lower: 0, upper: 0.1 },
        },
        planar2.joints[1],
      ],
      tcpOffset: planar2.tcpOffset,
    };
    const target = new Vector3(0, 2, 0);
    const result = solveCCD(limited, [0, 0], target, { maxIterations: 50 });
    if (result !== null) {
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
