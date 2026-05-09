import { useEffect, useState } from "react";
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
import { useUrdf } from "./hooks/useUrdf";
import { useSimulator } from "./hooks/useSimulator";

export default function SimulationPage() {
  const [robots, setRobots] = useState<string[]>([]);
  const [robotId, setRobotId] = useState<string>("");
  const { robot, status, error } = useUrdf(robotId || null);
  const { mode, setMode, joints, setJoints, dragEnabled } = useSimulator(robotId);

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
      </div>

      <div className="relative flex-1 overflow-hidden rounded-md border">
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
            <JointDragHandles
              robot={robot}
              jointsDeg={joints}
              enabled={dragEnabled}
              onJointsChange={setJoints}
            />
          </Scene>
        )}
        {!robotId && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            請選擇機器人
          </div>
        )}
      </div>
    </div>
  );
}
