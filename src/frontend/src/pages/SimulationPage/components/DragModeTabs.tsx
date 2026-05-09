import { Button } from "@/components/ui/button";

export type DragMode = "FK" | "IK";

interface Props {
  mode: DragMode;
  onModeChange: (next: DragMode) => void;
  ikAvailable: boolean;
}

export function DragModeTabs({ mode, onModeChange, ikAvailable }: Props) {
  return (
    <div className="inline-flex items-center gap-1 rounded-md border p-1">
      <Button
        size="sm"
        variant={mode === "FK" ? "default" : "ghost"}
        onClick={() => onModeChange("FK")}
        title="拖關節（FK）"
        className="text-xs"
      >
        FK 關節拖
      </Button>
      <Button
        size="sm"
        variant={mode === "IK" ? "default" : "ghost"}
        onClick={() => ikAvailable && onModeChange("IK")}
        disabled={!ikAvailable}
        title={
          ikAvailable
            ? "拖末端（IK）"
            : "此機器人不支援 IK（URDF 結構不符合 j1..j6 + tcp）"
        }
        className="text-xs"
      >
        IK 末端拖
      </Button>
    </div>
  );
}
