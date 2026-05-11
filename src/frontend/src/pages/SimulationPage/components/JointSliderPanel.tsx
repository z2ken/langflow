import type { URDFRobot } from "urdf-loader/src/URDFClasses";
import { useMemo } from "react";
import { getActuatedJointNames } from "../hooks/urdfChain";

interface Props {
  robot: URDFRobot;
  jointsDeg: number[];
  enabled: boolean;
  onJointsChange: (next: number[]) => void;
}

const RAD2DEG = 180 / Math.PI;
const FALLBACK_MIN = -180;
const FALLBACK_MAX = 180;

interface JointBound {
  name: string;
  minDeg: number;
  maxDeg: number;
}

export function JointSliderPanel({
  robot,
  jointsDeg,
  enabled,
  onJointsChange,
}: Props) {
  const bounds: JointBound[] = useMemo(() => {
    const names = getActuatedJointNames(robot);
    const out: JointBound[] = [];
    for (const name of names) {
      const j = (robot as any).joints?.[name];
      const lower = j?.limit?.lower;
      const upper = j?.limit?.upper;
      const minDeg =
        typeof lower === "number" ? lower * RAD2DEG : FALLBACK_MIN;
      const maxDeg =
        typeof upper === "number" ? upper * RAD2DEG : FALLBACK_MAX;
      out.push({ name, minDeg, maxDeg });
    }
    return out;
  }, [robot]);

  if (!enabled || bounds.length === 0) return null;

  const update = (index: number, valueDeg: number) => {
    const next = [...jointsDeg];
    next[index] = valueDeg;
    onJointsChange(next);
  };

  const resetAll = () => onJointsChange(bounds.map(() => 0));

  const copyAsMove = () => {
    // The runtime script interpreter keys joints by index (j1..jN) regardless
    // of the URDF joint names, so this script is portable across robots.
    const parts = bounds.map((_, i) => {
      const v = jointsDeg[i] ?? 0;
      const rounded = Math.round(v * 10) / 10;
      return `j${i + 1}=${rounded}`;
    });
    void navigator.clipboard?.writeText("MOVE " + parts.join(" "));
  };

  return (
    <div
      className="rounded-md border bg-background p-3 text-xs"
      data-testid="joint-slider-panel"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold">關節控制</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={copyAsMove}
            className="rounded border px-2 py-0.5 text-[10px] hover:bg-muted"
            title="把目前 6 軸值複製成 MOVE 指令到剪貼簿"
          >
            複製為 MOVE
          </button>
          <button
            type="button"
            onClick={resetAll}
            className="rounded border px-2 py-0.5 text-[10px] hover:bg-muted"
          >
            重設為 0
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {bounds.map(({ name, minDeg, maxDeg }, i) => {
          const value = jointsDeg[i] ?? 0;
          return (
            <label
              key={name}
              className="flex items-center gap-2"
              data-joint-row
            >
              <span className="w-32 truncate font-mono opacity-80" title={name}>
                {name}
              </span>
              <input
                type="range"
                min={minDeg}
                max={maxDeg}
                step={0.5}
                value={value}
                onChange={(e) => update(i, Number(e.target.value))}
                className="flex-1"
              />
              <span className="w-14 text-right font-mono tabular-nums">
                {value.toFixed(1)}°
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
