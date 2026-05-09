import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import type {
  PlaybackLogEntry,
  PlaybackStatus,
} from "../hooks/useScriptPlayback";

const STARTER = `# Script: HOME, MOVE joints, GRIPPER state, WAIT seconds, JOG one joint
HOME
WAIT duration=0.5
MOVE j1=45 j2=-30 j3=60 j4=0 j5=90 j6=0
GRIPPER state=close
MOVE j1=-45 j2=-30 j3=60 j4=0 j5=90 j6=0
GRIPPER state=open
HOME
`;

const SPEEDS = [0.25, 0.5, 1, 2, 4];

interface Props {
  robotId: string;
  status: PlaybackStatus;
  speed: number;
  log: PlaybackLogEntry[];
  error: string | null;
  onPlay: (robotId: string, code: string) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSpeedChange: (s: number) => void;
  onClearTrail: () => void;
}

export function PlaybackPanel({
  robotId,
  status,
  speed,
  log,
  error,
  onPlay,
  onPause,
  onResume,
  onStop,
  onSpeedChange,
  onClearTrail,
}: Props) {
  const [code, setCode] = useState(STARTER);

  const isPlaying = status === "playing";
  const isPaused = status === "paused";
  const canStart = status === "idle" || status === "done" || status === "error";

  return (
    <div className="flex h-full w-72 shrink-0 flex-col gap-2 rounded-md border p-3">
      <div className="text-sm font-semibold">軌跡回放（離線）</div>

      <Textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="flex-1 resize-none font-mono text-xs"
        placeholder="輸入腳本..."
      />

      <div className="flex items-center gap-1">
        {canStart && (
          <Button
            size="sm"
            onClick={() => onPlay(robotId, code)}
            disabled={!robotId || !code.trim()}
            className="flex-1"
          >
            ▶ 播放
          </Button>
        )}
        {isPlaying && (
          <Button size="sm" variant="outline" onClick={onPause} className="flex-1">
            ⏸ 暫停
          </Button>
        )}
        {isPaused && (
          <Button size="sm" onClick={onResume} className="flex-1">
            ▶ 繼續
          </Button>
        )}
        {(isPlaying || isPaused) && (
          <Button size="sm" variant="outline" onClick={onStop}>
            停止
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">速度</span>
        <Select
          value={String(speed)}
          onValueChange={(v) => onSpeedChange(Number(v))}
        >
          <SelectTrigger className="h-8 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SPEEDS.map((s) => (
              <SelectItem key={s} value={String(s)}>
                {s}×
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={onClearTrail}>
          清除軌跡
        </Button>
      </div>

      <div className="rounded border p-2">
        <div className="mb-1 text-xs font-medium text-muted-foreground">輸出</div>
        <div className="max-h-40 overflow-y-auto font-mono text-xs space-y-1">
          {error && <div className="text-destructive">錯誤: {error}</div>}
          {log.length === 0 && !error && (
            <div className="text-muted-foreground">尚未播放</div>
          )}
          {log.map((entry, i) => (
            <div
              key={i}
              className={entry.success ? "text-green-400" : "text-destructive"}
            >
              {entry.success ? "✓" : "✗"} {entry.line}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
