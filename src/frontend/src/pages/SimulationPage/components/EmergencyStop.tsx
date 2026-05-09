import { Button } from "@/components/ui/button";
import { type SimMode } from "../hooks/simModeFsm";

interface Props {
  mode: SimMode;
  robotId: string;
  onModeChange: (next: SimMode) => void;
}

export function EmergencyStop({ mode, robotId, onModeChange }: Props) {
  if (mode !== "Sync") return null;

  const onClick = async () => {
    try {
      await fetch(`/api/v1/robots/${robotId}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "HOME", params: {} }),
      });
    } catch {
      // Best-effort: even if the HOME request fails (e.g. network down) we
      // still drop out of Sync to stop sending further drag-induced motion.
    }
    onModeChange("Live");
  };

  return (
    <Button
      variant="destructive"
      onClick={onClick}
      className="ml-2 font-semibold"
      data-testid="emergency-stop"
    >
      緊急停止
    </Button>
  );
}
