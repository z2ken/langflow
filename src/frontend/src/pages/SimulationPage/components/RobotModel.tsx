// src/frontend/src/pages/SimulationPage/components/RobotModel.tsx
import { useEffect, useMemo, useRef } from "react";
import type { URDFRobot } from "urdf-loader/src/URDFClasses";
import { getActuatedJointNames } from "../hooks/urdfChain";

interface Props {
  robot: URDFRobot;
  jointsDeg: number[];
}

export function RobotModel({ robot, jointsDeg }: Props) {
  const ref = useRef<URDFRobot | null>(null);
  const jointNames = useMemo(() => getActuatedJointNames(robot), [robot]);

  useEffect(() => {
    if (!ref.current) return;
    jointNames.forEach((name, i) => {
      const value = (jointsDeg[i] ?? 0) * (Math.PI / 180);
      (ref.current as any).setJointValue(name, value);
    });
  }, [jointsDeg, jointNames]);

  return (
    <primitive
      object={robot}
      ref={(o: any) => { ref.current = o; }}
      // URDF Z-up → R3F Y-up
      rotation={[-Math.PI / 2, 0, 0]}
    />
  );
}
