import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Vector3 } from "three";
import type { URDFRobot } from "urdf-loader/src/URDFClasses";

interface Props {
  robot: URDFRobot;
  /** True to record points; false freezes the trail. */
  recording: boolean;
  /** Bumping this number clears the buffer. */
  clearKey?: number;
  /** Cap on stored points. */
  maxPoints?: number;
}

const TCP_LINK = "tcp";
const SAMPLE_INTERVAL_MS = 33; // ~30 Hz
const MIN_DELTA = 0.002; // skip points within 2 mm to avoid clutter

export function TrajectoryTrail({
  robot,
  recording,
  clearKey = 0,
  maxPoints = 6000,
}: Props) {
  const pointsRef = useRef<Vector3[]>([]);
  const lastSampleRef = useRef(0);
  const lastClearKeyRef = useRef(clearKey);

  useFrame((state) => {
    if (lastClearKeyRef.current !== clearKey) {
      pointsRef.current = [];
      lastClearKeyRef.current = clearKey;
    }
    if (!recording) return;
    const now = state.clock.elapsedTime * 1000;
    if (now - lastSampleRef.current < SAMPLE_INTERVAL_MS) return;
    lastSampleRef.current = now;
    // Access links via any-cast since URDFRobot typing doesn't expose links map directly
    const tcp = (robot as any).links?.[TCP_LINK];
    if (!tcp) return;
    const v = new Vector3();
    tcp.getWorldPosition(v);
    const last = pointsRef.current[pointsRef.current.length - 1];
    if (last && last.distanceTo(v) < MIN_DELTA) return;
    pointsRef.current.push(v);
    if (pointsRef.current.length > maxPoints) {
      pointsRef.current.splice(0, pointsRef.current.length - maxPoints);
    }
  });

  if (pointsRef.current.length < 2) return null;
  // Cast points to any: drei Line v10 expects typed tuple arrays, runtime array is compatible
  const L = Line as any;
  return (
    <L
      points={pointsRef.current.map((v) => [v.x, v.y, v.z])}
      color="#33ccff"
      lineWidth={2}
      transparent
      opacity={0.7}
    />
  );
}
