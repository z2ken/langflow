// src/frontend/src/pages/SimulationPage/components/RobotModel.tsx
import { useEffect, useRef } from "react";
import type { URDFRobot } from "urdf-loader/src/URDFClasses";

interface Props {
  robot: URDFRobot;
  jointsDeg: number[];
}

const JOINT_NAMES = ["j1", "j2", "j3", "j4", "j5", "j6"];

export function RobotModel({ robot, jointsDeg }: Props) {
  const ref = useRef<URDFRobot | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    JOINT_NAMES.forEach((name, i) => {
      const value = (jointsDeg[i] ?? 0) * (Math.PI / 180);
      // setJointValue accepts (name, value) for single-DOF joints
      (ref.current as any).setJointValue(name, value);
    });
  }, [jointsDeg]);

  return (
    <primitive
      object={robot}
      ref={(o: any) => { ref.current = o; }}
      // URDF Z-up → R3F Y-up
      rotation={[-Math.PI / 2, 0, 0]}
    />
  );
}
