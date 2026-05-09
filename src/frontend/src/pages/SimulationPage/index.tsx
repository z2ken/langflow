import { useEffect, useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Scene } from "./components/Scene";
import { RobotModel } from "./components/RobotModel";
import { ModeTabs } from "./components/ModeTabs";
import { JointDragHandles } from "./components/JointDragHandles";
import { IKGizmo } from "./components/IKGizmo";
import { DragModeTabs, type DragMode } from "./components/DragModeTabs";
import { CollisionViz } from "./components/CollisionViz";
import { TrajectoryTrail } from "./components/TrajectoryTrail";
import { PlaybackPanel } from "./components/PlaybackPanel";
import { EmergencyStop } from "./components/EmergencyStop";
import { useUrdf } from "./hooks/useUrdf";
import { useSimulator } from "./hooks/useSimulator";
import { useIKSolver } from "./hooks/useIKSolver";
import { useCollision } from "./hooks/useCollision";
import { useScriptPlayback } from "./hooks/useScriptPlayback";

export default function SimulationPage() {
  const [robots, setRobots] = useState<string[]>([]);
  const [robotId, setRobotId] = useState<string>("");
  const [dragMode, setDragMode] = useState<DragMode>("FK");
  const { robot, status, error } = useUrdf(robotId || null);
  const { mode, setMode, joints, setJoints, dragEnabled } = useSimulator(robotId);
  const { solve, available: ikAvailable } = useIKSolver(robot);
  const { check: checkCollision, ready: collisionReady } = useCollision(robot);
  const [trailClearKey, setTrailClearKey] = useState(0);
  const playback = useScriptPlayback({
    onJoints: (jointsDeg) => setJoints(jointsDeg),
  });

  useEffect(() => {
    if (dragMode === "IK" && !ikAvailable) setDragMode("FK");
  }, [dragMode, ikAvailable]);

  const collidingLinkSet = useMemo(() => {
    if (!collisionReady) return new Set<string>();
    const jointsRad = joints.map((d) => (d * Math.PI) / 180);
    return checkCollision(jointsRad);
  }, [joints, checkCollision, collisionReady]);

  const wouldCollide = useMemo(
    () => (nextDeg: number[]): boolean => {
      if (!collisionReady) return false;
      const jointsRad = nextDeg.map((d) => (d * Math.PI) / 180);
      const next = checkCollision(jointsRad);
      // Allow leaving an existing collision; only block ENTERING a new one.
      const newCollisions = Array.from(next).filter(
        (link) => !collidingLinkSet.has(link),
      );
      return newCollisions.length > 0;
    },
    [checkCollision, collisionReady, collidingLinkSet],
  );

  useEffect(() => {
    fetch("/api/v1/robots")
      .then((r) => r.json())
      .then((list: { robot_id: string }[]) => {
        setRobots(list.map((r) => r.robot_id));
        if (list.length > 0 && !robotId) setRobotId(list[0].robot_id);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="flex h-full w-full flex-col p-6">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-2xl font-semibold">3D 模擬</h1>
        <Select value={robotId} onValueChange={setRobotId}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="選擇機器人" />
          </SelectTrigger>
          <SelectContent>
            {robots.map((id) => (
              <SelectItem key={id} value={id}>
                {id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ModeTabs mode={mode} onModeChange={setMode} />
        <DragModeTabs
          mode={dragMode}
          onModeChange={setDragMode}
          ikAvailable={ikAvailable}
        />
        <EmergencyStop mode={mode} robotId={robotId} onModeChange={setMode} />
      </div>

      <div className="flex flex-1 min-h-0 gap-3">
        <div
          className={
            "relative flex-1 overflow-hidden rounded-md border transition-shadow " +
            (mode === "Sync"
              ? "border-2 border-red-500 shadow-[0_0_24px_rgba(239,68,68,0.55)]"
              : "")
          }
          data-sync-active={mode === "Sync" ? "true" : "false"}
        >
          {mode === "Sync" && (
            <div
              className="pointer-events-none absolute left-2 top-2 z-10 rounded bg-red-500/90 px-2 py-1 text-xs font-semibold text-white shadow"
              data-testid="sync-indicator"
            >
              ● Sync 雙向控制中
            </div>
          )}
          {status === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
              載入 URDF...
            </div>
          )}
          {status === "error" && (
            <div className="absolute inset-0 flex items-center justify-center text-destructive">
              URDF 載入失敗：{error}
            </div>
          )}
          {status === "ready" && robot && (
            <Scene>
              <RobotModel robot={robot} jointsDeg={joints} />
              {dragMode === "FK" && (
                <JointDragHandles
                  robot={robot}
                  jointsDeg={joints}
                  enabled={dragEnabled}
                  onJointsChange={setJoints}
                  wouldCollide={wouldCollide}
                />
              )}
              {dragMode === "IK" && (
                <IKGizmo
                  robot={robot}
                  jointsDeg={joints}
                  enabled={dragEnabled}
                  onJointsChange={setJoints}
                  solve={solve}
                  wouldCollide={wouldCollide}
                />
              )}
              <CollisionViz robot={robot} colliding={collidingLinkSet} />
              <TrajectoryTrail
                robot={robot}
                recording={
                  mode === "Live" ||
                  mode === "Sync" ||
                  playback.status === "playing"
                }
                clearKey={trailClearKey}
              />
            </Scene>
          )}
          {!robotId && (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
              請選擇機器人
            </div>
          )}
        </div>
        {mode === "Offline" && robotId && (
          <PlaybackPanel
            robotId={robotId}
            status={playback.status}
            speed={playback.speed}
            log={playback.log}
            error={playback.error}
            onPlay={playback.play}
            onPause={playback.pause}
            onResume={playback.resume}
            onStop={playback.stop}
            onSpeedChange={playback.setSpeed}
            onClearTrail={() => setTrailClearKey((k) => k + 1)}
          />
        )}
      </div>
    </div>
  );
}
