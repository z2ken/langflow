import { useCallback, useMemo } from "react";
import { Vector3 } from "three";
import type { URDFRobot } from "urdf-loader/src/URDFClasses";
import { type KinematicChain, urdfToChain } from "./kinematics";
import { type SolveOptions, solveCCD } from "./ikSolver";

export interface UseIKSolver {
  /** Solve for joint angles (radians) that move the TCP to the world-space target. */
  solve: (target: Vector3, current: number[]) => number[] | null;
  /** True if the URDF was successfully parsed into a kinematic chain. */
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
