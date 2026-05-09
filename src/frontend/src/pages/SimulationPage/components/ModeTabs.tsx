import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type SimMode, needsConfirmation } from "../hooks/simModeFsm";

const MODES: SimMode[] = ["Live", "Offline", "Sync", "Sandbox"];

const LABELS: Record<SimMode, string> = {
  Live: "Live 鏡像",
  Offline: "Offline 離線",
  Sync: "Sync 雙向",
  Sandbox: "Sandbox 沙盒",
};

const DESCRIPTIONS: Record<SimMode, string> = {
  Live: "唯讀地鏡像真機關節",
  Offline: "離線編輯，按鈕送到真機",
  Sync: "拖拉直接控制真機",
  Sandbox: "完全脫線，自由操作",
};

interface Props {
  mode: SimMode;
  onModeChange: (next: SimMode) => void;
}

export function ModeTabs({ mode, onModeChange }: Props) {
  const [pendingMode, setPendingMode] = useState<SimMode | null>(null);

  const handleClick = (target: SimMode) => {
    if (target === mode) return;
    if (needsConfirmation(mode, target)) {
      setPendingMode(target);
    } else {
      onModeChange(target);
    }
  };

  const confirmSync = () => {
    if (pendingMode) onModeChange(pendingMode);
    setPendingMode(null);
  };

  return (
    <>
      <div className="inline-flex items-center gap-1 rounded-md border p-1">
        {MODES.map((m) => (
          <Button
            key={m}
            size="sm"
            variant={mode === m ? "default" : "ghost"}
            onClick={() => handleClick(m)}
            title={DESCRIPTIONS[m]}
            className="text-xs"
          >
            {LABELS[m]}
          </Button>
        ))}
      </div>
      <Dialog open={pendingMode !== null} onOpenChange={(open) => !open && setPendingMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>切到 Sync 雙向模式？</DialogTitle>
            <DialogDescription>
              在此模式下，你在 3D 場景拖拉的關節會直接發到真機。請確認真機處於安全狀態（無人靠近、緊急停止可達）後再繼續。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingMode(null)}>
              取消
            </Button>
            <Button onClick={confirmSync}>確定切換到 Sync</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
