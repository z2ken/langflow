import { ThreeEvent } from "@react-three/fiber";
import { Sphere } from "@react-three/drei";
import { useMemo, useRef } from "react";
import { Vector3 } from "three";
import type { URDFRobot } from "urdf-loader/src/URDFClasses";
import { getActuatedJointNames } from "../hooks/urdfChain";

// Drag sensitivity: pixels per radian
const PIXELS_PER_RAD = 200;

interface Props {
  robot: URDFRobot;
  jointsDeg: number[];
  enabled: boolean;
  onJointsChange: (next: number[]) => void;
  /** Optional gate — return true to reject this update (e.g. collision). */
  wouldCollide?: (jointsDeg: number[]) => boolean;
}

interface DragState {
  jointIndex: number;
  startX: number;
  startY: number;
  startValueRad: number;
  limitLowerRad: number;
  limitUpperRad: number;
}

export function JointDragHandles({
  robot,
  jointsDeg,
  enabled,
  onJointsChange,
  wouldCollide,
}: Props) {
  const dragRef = useRef<DragState | null>(null);
  const jointNames = useMemo(() => getActuatedJointNames(robot), [robot]);

  if (!enabled) return null;

  const positions: { name: string; index: number; pos: Vector3; limits: [number, number] }[] = [];
  for (let i = 0; i < jointNames.length; i++) {
    const name = jointNames[i];
    const j = (robot as any).joints?.[name];
    if (!j) continue;
    const pos = new Vector3();
    j.getWorldPosition(pos);
    const limits: [number, number] = [
      typeof j.limit?.lower === "number" ? j.limit.lower : -Math.PI,
      typeof j.limit?.upper === "number" ? j.limit.upper : Math.PI,
    ];
    positions.push({ name, index: i, pos, limits });
  }

  const onPointerDown = (e: ThreeEvent<PointerEvent>, index: number, limits: [number, number]) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      jointIndex: index,
      startX: e.nativeEvent.clientX,
      startY: e.nativeEvent.clientY,
      startValueRad: ((jointsDeg[index] ?? 0) * Math.PI) / 180,
      limitLowerRad: limits[0],
      limitUpperRad: limits[1],
    };
  };

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    const d = dragRef.current;
    // Use vertical drag — moving up = +angle. Feels natural for a vertical axis.
    const dy = d.startY - e.nativeEvent.clientY;
    const targetRad = d.startValueRad + dy / PIXELS_PER_RAD;
    const clamped = Math.max(d.limitLowerRad, Math.min(d.limitUpperRad, targetRad));
    const next = [...jointsDeg];
    next[d.jointIndex] = (clamped * 180) / Math.PI;
    if (wouldCollide?.(next)) return; // collision gate
    onJointsChange(next);
  };

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
  };

  return (
    <>
      {positions.map(({ name, index, pos, limits }) => (
        <group key={name} position={[pos.x, pos.y, pos.z]}>
          <Sphere
            args={[0.025, 16, 16]}
            onPointerDown={(e) => onPointerDown(e, index, limits)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <meshStandardMaterial color="#ff9933" emissive="#552200" />
          </Sphere>
        </group>
      ))}
    </>
  );
}
