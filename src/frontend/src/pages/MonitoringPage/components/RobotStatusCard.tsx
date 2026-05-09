import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRobotStatus } from "../useRobotStatus";

interface Props {
  robotId: string;
}

export function RobotStatusCard({ robotId }: Props) {
  const { status, isConnected } = useRobotStatus(robotId);

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">{robotId}</CardTitle>
        <Badge variant={isConnected ? "default" : "secondary"}>
          {isConnected ? "連線中" : "未連線"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {status ? (
          <>
            <div>
              <p className="text-xs text-muted-foreground mb-1">關節角度</p>
              <div className="flex flex-wrap gap-1">
                {status.joints.map((val, i) => (
                  <Badge key={i} variant="outline" className="text-xs">
                    J{i + 1}: {val.toFixed(1)}°
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">末端位置</p>
              <div className="flex flex-wrap gap-1">
                {Object.entries(status.position).map(([k, v]) => (
                  <Badge key={k} variant="outline" className="text-xs">
                    {k}: {v.toFixed(2)}
                  </Badge>
                ))}
              </div>
            </div>
            {status.current_task && (
              <div>
                <p className="text-xs text-muted-foreground">目前任務</p>
                <p className="text-sm">{status.current_task}</p>
              </div>
            )}
            {status.last_error && (
              <div>
                <p className="text-xs text-destructive">錯誤</p>
                <p className="text-sm text-destructive">{status.last_error}</p>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">等待資料...</p>
        )}
      </CardContent>
    </Card>
  );
}
