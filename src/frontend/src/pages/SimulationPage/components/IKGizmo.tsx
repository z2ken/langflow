import { TransformControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import { Mesh, Vector3 } from "three";
import type { URDFRobot } from "urdf-loader/src/URDFClasses";
import { getEndEffectorLinkName } from "../hooks/urdfChain";

interface Props {
  robot: URDFRobot;
  jointsDeg: number[];
  enabled: boolean;
  onJointsChange: (next: number[]) => void;
  onUnreachable?: () => void;
  /** From useIKSolver(robot).solve. */
  solve: (target: Vector3, currentRad: number[]) => number[] | null;
  /** Optional gate — return true to reject this update (e.g. collision). */
  wouldCollide?: (jointsDeg: number[]) => boolean;
}

// TC cast: drei TransformControls `object` prop type is strict about THREE.Object3D
// subtypes; using `as any` avoids the variance mismatch without losing runtime safety.
const TC = TransformControls as any;

export function IKGizmo({
  robot,
  jointsDeg,
  enabled,
  onJointsChange,
  onUnreachable,
  solve,
  wouldCollide,
}: Props) {
  const targetRef = useRef<Mesh>(null);
  const [unreachableFlash, setUnreachableFlash] = useState(false);
  const tcpLinkName = useMemo(() => getEndEffectorLinkName(robot), [robot]);

  // Place the dummy mesh at the TCP world position whenever the joints
  // change, so the gizmo follows the arm when not actively dragging.
  useEffect(() => {
    if (!targetRef.current || !tcpLinkName) return;
    const tcp = (robot as any).links?.[tcpLinkName];
    if (!tcp) return;
    const v = new Vector3();
    tcp.getWorldPosition(v);
    targetRef.current.position.copy(v);
  }, [jointsDeg, robot, tcpLinkName]);

  const jointsRad = useMemo(
    () => jointsDeg.map((d) => (d * Math.PI) / 180),
    [jointsDeg],
  );

  if (!enabled) return null;

  const handleObjectChange = () => {
    if (!targetRef.current) return;
    const target = new Vector3().copy(targetRef.current.position);
    const result = solve(target, jointsRad);
    if (result === null) {
      setUnreachableFlash(true);
      setTimeout(() => setUnreachableFlash(false), 200);
      onUnreachable?.();
      return;
    }
    const nextDeg = result.map((r) => (r * 180) / Math.PI);
    if (wouldCollide?.(nextDeg)) return; // collision gate
    onJointsChange(nextDeg);
  };

  return (
    <>
      <mesh ref={targetRef} visible={false}>
        <sphereGeometry args={[0.01, 8, 8]} />
        <meshBasicMaterial />
      </mesh>
      {targetRef.current ? (
        <TC
          object={targetRef.current}
          mode="translate"
          size={0.5}
          onObjectChange={handleObjectChange}
        />
      ) : null}
      {unreachableFlash && targetRef.current ? (
        <mesh position={targetRef.current.position.toArray()}>
          <sphereGeometry args={[0.04, 16, 16]} />
          <meshBasicMaterial color="#ff3333" transparent opacity={0.6} />
        </mesh>
      ) : null}
    </>
  );
}
