import { useEffect, useState } from "react";
import { RobotStatusCard } from "./components/RobotStatusCard";

interface RobotEntry {
  robot_id: string;
  connected: boolean;
}

export default function MonitoringPage() {
  const [robots, setRobots] = useState<RobotEntry[]>([]);

  useEffect(() => {
    fetch("/api/v1/robots")
      .then((r) => r.json())
      .then(setRobots)
      .catch(() => {});
  }, []);

  return (
    <div className="flex h-full w-full flex-col overflow-auto p-6">
      <h1 className="mb-6 text-2xl font-semibold">機器人監控</h1>
      {robots.length === 0 ? (
        <p className="text-muted-foreground">
          未找到機器人，請確認 robots.yaml 設定。
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {robots.map((r) => (
            <RobotStatusCard key={r.robot_id} robotId={r.robot_id} />
          ))}
        </div>
      )}
    </div>
  );
}
