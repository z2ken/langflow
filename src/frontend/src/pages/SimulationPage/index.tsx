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
import { useUrdf } from "./hooks/useUrdf";

export default function SimulationPage() {
  const [robots, setRobots] = useState<string[]>([]);
  const [robotId, setRobotId] = useState<string>("");
  const { robot, status, error } = useUrdf(robotId || null);
  const [joints, setJoints] = useState<number[]>([0, 0, 0, 0, 0, 0]);

  // Robot list
  useEffect(() => {
    fetch("/api/v1/robots")
      .then((r) => r.json())
      .then((list: { robot_id: string }[]) => {
        setRobots(list.map((r) => r.robot_id));
        if (list.length > 0 && !robotId) setRobotId(list[0].robot_id);
      })
      .catch(() => {});
  }, []);

  // Live joint state via WebSocket
  useEffect(() => {
    if (!robotId) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${proto}://${window.location.host}/api/v1/robots/ws/${robotId}`,
    );
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (Array.isArray(d.joints) && d.joints.length === 6) {
          setJoints(d.joints);
        }
      } catch {
        // ignore malformed frames
      }
    };
    return () => ws.close();
  }, [robotId]);

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
        <span className="text-xs text-muted-foreground">Live 模式</span>
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
