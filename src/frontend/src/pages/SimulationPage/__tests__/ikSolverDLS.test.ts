import { Quaternion, Vector3 } from "three";
import type { KinematicChain } from "../hooks/kinematics";
import { forwardKinematics } from "../hooks/kinematics";
import { solveDLS } from "../hooks/ikSolverDLS";

// Synthetic 6-DOF chain modelled loosely on a generic articulated arm.
// All joints rotate about world-Z initially; the static rpy quaternion is
// identity, so this exercises the same code paths as forwardKinematics
// with `originRot` absent.
const chain6: KinematicChain = {
  joints: [
    { axis: new Vector3(0, 0, 1), origin: new Vector3(0, 0, 0), limit: { lower: -Math.PI, upper: Math.PI } },
    { axis: new Vector3(0, 1, 0), origin: new Vector3(0, 0, 0.3), limit: { lower: -2, upper: 2 } },
    { axis: new Vector3(0, 1, 0), origin: new Vector3(0, 0, 0.4), limit: { lower: -2, upper: 2 } },
    { axis: new Vector3(1, 0, 0), origin: new Vector3(0, 0, 0.3), limit: { lower: -Math.PI, upper: Math.PI } },
    { axis: new Vector3(0, 1, 0), origin: new Vector3(0, 0, 0), limit: { lower: -2, upper: 2 } },
    { axis: new Vector3(1, 0, 0), origin: new Vector3(0, 0, 0), limit: { lower: -Math.PI, upper: Math.PI } },
  ],
  tcpOffset: new Vector3(0, 0, 0.1),
};

describe("solveDLS", () => {
  it("recovers a known joint vector via FK round-trip", () => {
    const ground = [0.3, -0.5, 0.7, 0.1, -0.4, 0.2];
    const target = forwardKinematics(chain6, ground);
    const solved = solveDLS(chain6, [0, 0, 0, 0, 0, 0], target);
    expect(solved).not.toBeNull();
    const tcp = forwardKinematics(chain6, solved as number[]);
    expect(tcp.distanceTo(target)).toBeLessThan(1e-2);
  });

  it("returns null for clearly unreachable targets", () => {
    // far away beyond max reach (~1.0m)
    const target = new Vector3(5, 5, 5);
    const result = solveDLS(chain6, [0, 0, 0, 0, 0, 0], target, {
      maxIterations: 30,
    });
    expect(result).toBeNull();
  });

  it("respects joint limits", () => {
    const tight: KinematicChain = {
      ...chain6,
      joints: chain6.joints.map((j) => ({
        ...j,
        limit: { lower: -0.5, upper: 0.5 },
      })),
    };
    // Target chosen well beyond what tight limits can reach
    const target = new Vector3(0.9, 0.9, 0.9);
    const solved = solveDLS(tight, [0, 0, 0, 0, 0, 0], target, {
      maxIterations: 100,
    });
    if (solved) {
      for (const v of solved) {
        expect(v).toBeGreaterThanOrEqual(-0.5 - 1e-6);
        expect(v).toBeLessThanOrEqual(0.5 + 1e-6);
      }
    }
  });

  it("throws on length mismatch", () => {
    expect(() =>
      solveDLS(chain6, [0, 0, 0], new Vector3(0, 0, 0)),
    ).toThrow(/length/);
  });

  it("honours originRot when present (rotated chain)", () => {
    // Rotate the base joint's static frame by 90° about X — this changes
    // where every downstream joint sits in world coordinates. DLS should
    // still converge via numerical Jacobian.
    const rotChain: KinematicChain = {
      joints: chain6.joints.map((j, i) =>
        i === 0
          ? { ...j, originRot: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2) }
          : j,
      ),
      tcpOffset: chain6.tcpOffset,
    };
    const ground = [0.2, -0.4, 0.6, 0.0, -0.3, 0.1];
    const target = forwardKinematics(rotChain, ground);
    const solved = solveDLS(rotChain, [0, 0, 0, 0, 0, 0], target);
    expect(solved).not.toBeNull();
    expect(forwardKinematics(rotChain, solved as number[]).distanceTo(target)).toBeLessThan(1e-2);
  });
});
