import { useCallback, useMemo } from "react";
import type { URDFRobot } from "urdf-loader/src/URDFClasses";
import {
  type LinkBVH,
  buildLinkBVHs,
  checkCollisionsAt,
} from "./collision";

export interface UseCollision {
  /**
   * Apply the joint vector and return the set of currently colliding link
   * names. Mutates the robot's joint state — call with the joints you want
   * to test.
   */
  check: (jointsRad: number[]) => Set<string>;
  /** True once BVHs are built and ready. */
  ready: boolean;
}

const EMPTY: Set<string> = new Set();

export function useCollision(robot: URDFRobot | null): UseCollision {
  const bvhs: LinkBVH[] = useMemo(() => {
    if (!robot) return [];
    return buildLinkBVHs(robot);
  }, [robot]);

  const check = useCallback(
    (jointsRad: number[]): Set<string> => {
      if (!robot || bvhs.length === 0) return EMPTY;
      return checkCollisionsAt(robot, bvhs, jointsRad);
    },
    [robot, bvhs],
  );

  return { check, ready: bvhs.length > 0 };
}
