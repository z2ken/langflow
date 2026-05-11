import { useCallback, useMemo } from "react";
import { Vector3 } from "three";
import type { URDFRobot } from "urdf-loader/src/URDFClasses";
import { type KinematicChain, urdfToChain } from "./kinematics";
import { type DLSOptions, solveDLS } from "./ikSolverDLS";

export interface UseIKSolver {
  /** Solve for joint angles (radians) that move the TCP to the world-space target. */
  solve: (target: Vector3, current: number[]) => number[] | null;
  /** True if the URDF was successfully parsed into a kinematic chain. */
  available: boolean;
}

// DLS handles spherical-wrist singularities gracefully (CCD was prone to
// wobble near gimbal-lock poses on UR10). Damping was tuned for ~1 mm
// epsilon convergence within 50 iterations on the synthetic 6-DOF chain
// and on the real UR10 URDF.
const DEFAULT_OPTS: DLSOptions = {
  epsilon: 1e-3,
  maxIterations: 50,
  damping: 0.1,
};

export function useIKSolver(robot: URDFRobot | null): UseIKSolver {
  const chain: KinematicChain | null = useMemo(() => {
    if (!robot) return null;
    return urdfToChain(robot);
  }, [robot]);

  const solve = useCallback(
    (target: Vector3, current: number[]): number[] | null => {
      if (!chain) return null;
      return solveDLS(chain, current, target, DEFAULT_OPTS);
    },
    [chain],
  );

  return { solve, available: chain !== null };
}
