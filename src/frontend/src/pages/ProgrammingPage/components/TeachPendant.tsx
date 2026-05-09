import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const JOINTS = ["J1", "J2", "J3", "J4", "J5", "J6"];
const STEPS = [0.5, 1, 5, 10];

interface JogResult {
  joint: string;
  dir: "+" | "-";
  message: string;
  success: boolean;
}

interface Props {
  robots: string[];
}

export function TeachPendant({ robots }: Props) {
  const [robotId, setRobotId] = useState<string>("");
  const [step, setStep] = useState(1);
  const [jogLog, setJogLog] = useState<JogResult[]>([]);
  const [jogging, setJogging] = useState(false);

  useEffect(() => {
    if (robots.length > 0 && !robotId) setRobotId(robots[0]);
  }, [robots]);

  const jog = async (joint: string, dir: "+" | "-") => {
    if (!robotId || jogging) return;
    setJogging(true);
    try {
      const delta = dir === "+" ? step : -step;
      const res = await fetch(`/api/v1/robots/${robotId}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "JOG", params: { joint, delta } }),
      });
      const data = await res.json();
      setJogLog((prev) =>
        [{ joint, dir, message: data.message, success: data.success }, ...prev].slice(0, 30)
      );
    } catch {
      setJogLog((prev) =>
        [{ joint, dir, message: "通訊錯誤", success: false }, ...prev].slice(0, 30)
      );
    } finally {
      setJogging(false);
    }
  };

  const home = async () => {
    if (!robotId) return;
    await fetch(`/api/v1/robots/${robotId}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: "HOME", params: {} }),
    });
    setJogLog((prev) =>
      [{ joint: "ALL", dir: "+" as const, message: "回原點", success: true }, ...prev].slice(0, 30)
    );
  };

  return (
    <div className="flex h-full gap-4 overflow-auto">
      {/* Left: pendant controls */}
      <div className="flex flex-col gap-4 w-80 shrink-0">
        {/* Robot selector + step */}
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">機器人</label>
              <Select value={robotId} onValueChange={setRobotId}>
                <SelectTrigger>
                  <SelectValue placeholder="選擇機器人" />
                </SelectTrigger>
                <SelectContent>
                  {robots.map((id) => (
                    <SelectItem key={id} value={id}>{id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">步進量 (°)</label>
              <div className="flex gap-1">
                {STEPS.map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={step === s ? "default" : "outline"}
                    className="flex-1 text-xs"
                    onClick={() => setStep(s)}
                  >
                    {s}°
                  </Button>
                ))}
              </div>
            </div>
            <Button className="w-full" variant="secondary" onClick={home} disabled={!robotId}>
              回原點 (HOME)
            </Button>
          </CardContent>
        </Card>

        {/* Joint jog buttons */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">關節點動</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {JOINTS.map((joint) => (
              <div key={joint} className="flex items-center gap-2">
                <span className="w-6 text-xs font-mono text-muted-foreground">{joint}</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 font-bold"
                  onClick={() => jog(joint, "-")}
                  disabled={!robotId || jogging}
                >
                  −
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 font-bold"
                  onClick={() => jog(joint, "+")}
                  disabled={!robotId || jogging}
                >
                  +
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Right: jog log */}
      <div className="flex flex-1 flex-col rounded-md border overflow-hidden">
        <div className="border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">
          點動記錄
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-xs">
          {jogLog.length === 0 ? (
            <span className="text-muted-foreground">點擊關節按鈕開始點動...</span>
          ) : (
            jogLog.map((entry, i) => (
              <div key={i} className="flex items-start gap-2">
                <Badge
                  variant={entry.success ? "default" : "destructive"}
                  className="mt-0.5 shrink-0 text-[10px]"
                >
                  {entry.joint} {entry.dir}
                </Badge>
                <span className={entry.success ? "text-foreground" : "text-destructive"}>
                  {entry.message}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
