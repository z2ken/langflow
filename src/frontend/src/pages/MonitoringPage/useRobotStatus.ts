import { useEffect, useRef, useState } from "react";

export interface RobotStatus {
  robot_id: string;
  connected: boolean;
  joints: number[];
  position: Record<string, number>;
  current_task: string | null;
  last_error: string | null;
}

export function useRobotStatus(robotId: string | null) {
  const [status, setStatus] = useState<RobotStatus | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!robotId) return;

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${protocol}://${window.location.host}/api/v1/robots/ws/${robotId}`,
    );
    wsRef.current = ws;

    ws.onopen = () => setIsConnected(true);
    ws.onmessage = (e) => {
      try {
        setStatus(JSON.parse(e.data));
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = () => setIsConnected(false);
    ws.onerror = () => setIsConnected(false);

    return () => {
      ws.close();
    };
  }, [robotId]);

  return { status, isConnected };
}
