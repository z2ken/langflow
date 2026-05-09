import type { URDFRobot } from "urdf-loader/src/URDFClasses";
import { useMemo } from "react";
import { getActuatedJointNames } from "../hooks/urdfChain";

interface Props {
  robot: URDFRobot;
  jointsDeg: number[];
}

export function JointStatusHUD({ robot, jointsDeg }: Props) {
  const names = useMemo(() => getActuatedJointNames(robot), [robot]);
  if (names.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute right-2 top-2 z-10 rounded bg-black/65 px-3 py-2 font-mono text-xs text-white shadow"
      data-testid="joint-status-hud"
    >
      {names.map((name, i) => (
        <div
          key={name}
          data-joint-row
          className="flex items-center justify-between gap-3"
        >
          <span className="opacity-80">{name}</span>
          <span className="tabular-nums">{(jointsDeg[i] ?? 0).toFixed(1)}°</span>
        </div>
      ))}
    </div>
  );
}
