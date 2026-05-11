import { Vector3 } from "three";
import type { KinematicChain } from "./kinematics";
import { forwardKinematics } from "./kinematics";

export interface DLSOptions {
  /** Stop iterating when |TCP - target| < epsilon. Default 1e-3 (1 mm). */
  epsilon?: number;
  /** Hard upper bound on iterations. Default 50. */
  maxIterations?: number;
  /** Damping factor λ — larger = more stable near singularities, smaller = faster. Default 0.1. */
  damping?: number;
  /** Finite-difference step for the numerical Jacobian (radians). Default 1e-5. */
  jacobianStep?: number;
}

const DEFAULT_OPTS: Required<DLSOptions> = {
  epsilon: 1e-3,
  maxIterations: 50,
  damping: 0.1,
  jacobianStep: 1e-5,
};

/**
 * Damped Least Squares inverse kinematics — Δq = J^T (J J^T + λ²I)^-1 e.
 *
 * Compared with CCD, DLS handles singularities (e.g. a spherical wrist's
 * gimbal lock) gracefully because the damping term keeps J J^T invertible
 * even when the Jacobian becomes rank-deficient. Trade-off: ~6× more FK
 * evaluations per iteration (numerical Jacobian), so for well-conditioned
 * chains it's slower than CCD per step but typically needs fewer steps.
 *
 * Pure function. Joint limits are enforced by clamping each step.
 * Returns the new joint vector if converged within `epsilon`, else `null`.
 */
export function solveDLS(
  chain: KinematicChain,
  current: number[],
  target: Vector3,
  opts: DLSOptions = {},
): number[] | null {
  if (current.length !== chain.joints.length) {
    throw new Error(
      `joint vector length ${current.length} does not match chain length ${chain.joints.length}`,
    );
  }
  const { epsilon, maxIterations, damping, jacobianStep } = {
    ...DEFAULT_OPTS,
    ...opts,
  };
  const n = chain.joints.length;
  const joints = current.slice();
  const lambdaSq = damping * damping;

  for (let iter = 0; iter < maxIterations; iter++) {
    const tcp = forwardKinematics(chain, joints);
    const err = new Vector3().subVectors(target, tcp);
    if (err.length() < epsilon) return joints;

    // Numerical Jacobian: J[i] is the 3-vector dTCP/dq_i.
    const J: number[][] = [];
    for (let i = 0; i < n; i++) {
      const perturbed = joints.slice();
      perturbed[i] += jacobianStep;
      const tcpPert = forwardKinematics(chain, perturbed);
      J.push([
        (tcpPert.x - tcp.x) / jacobianStep,
        (tcpPert.y - tcp.y) / jacobianStep,
        (tcpPert.z - tcp.z) / jacobianStep,
      ]);
    }

    // J J^T + λ²I (3×3).
    const A: number[][] = [
      [lambdaSq, 0, 0],
      [0, lambdaSq, 0],
      [0, 0, lambdaSq],
    ];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += J[k][r] * J[k][c];
        A[r][c] += s;
      }
    }

    const inv = invert3x3(A);
    if (!inv) return null;

    // u = A^-1 · err
    const u = [
      inv[0][0] * err.x + inv[0][1] * err.y + inv[0][2] * err.z,
      inv[1][0] * err.x + inv[1][1] * err.y + inv[1][2] * err.z,
      inv[2][0] * err.x + inv[2][1] * err.y + inv[2][2] * err.z,
    ];

    // Δq = J^T · u; clamp to limits.
    for (let i = 0; i < n; i++) {
      const dq = J[i][0] * u[0] + J[i][1] * u[1] + J[i][2] * u[2];
      const next = joints[i] + dq;
      const { lower, upper } = chain.joints[i].limit;
      joints[i] = Math.max(lower, Math.min(upper, next));
    }
  }

  const finalTcp = forwardKinematics(chain, joints);
  return finalTcp.distanceTo(target) < epsilon ? joints : null;
}

function invert3x3(m: number[][]): number[][] | null {
  const a = m[0][0], b = m[0][1], c = m[0][2];
  const d = m[1][0], e = m[1][1], f = m[1][2];
  const g = m[2][0], h = m[2][1], i = m[2][2];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  return [
    [(e * i - f * h) * inv, -(b * i - c * h) * inv, (b * f - c * e) * inv],
    [-(d * i - f * g) * inv, (a * i - c * g) * inv, -(a * f - c * d) * inv],
    [(d * h - e * g) * inv, -(a * h - b * g) * inv, (a * e - b * d) * inv],
  ];
}
