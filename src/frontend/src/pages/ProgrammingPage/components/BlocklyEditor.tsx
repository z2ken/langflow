import * as Blockly from "blockly";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Robot block colour palette (Blockly hue 0–360)
const HUE_MOTION = 200;
const HUE_IO = 30;
const HUE_FLOW = 290;

interface LogEntry {
  line: string;
  success: boolean;
  message: string;
}

interface Props {
  robots: string[];
}

// ---- Block definitions (idempotent) ----
function defineBlocks() {
  if (Blockly.Blocks["robot_home"]) return;

  Blockly.Blocks["robot_home"] = {
    init() {
      this.appendDummyInput().appendField("回原點 HOME");
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour(HUE_MOTION);
      this.setTooltip("讓機器人回到原點");
    },
  };

  Blockly.Blocks["robot_wait"] = {
    init() {
      this.appendDummyInput()
        .appendField("等待")
        .appendField(new Blockly.FieldNumber(1, 0, 60, 0.1), "DURATION")
        .appendField("秒");
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour(HUE_FLOW);
    },
  };

  Blockly.Blocks["robot_move"] = {
    init() {
      this.appendDummyInput().appendField("移動到關節角度");
      const fields: Array<[string, string]> = [
        ["J1", "J1"],
        ["J2", "J2"],
        ["J3", "J3"],
        ["J4", "J4"],
        ["J5", "J5"],
        ["J6", "J6"],
      ];
      for (const [label, name] of fields) {
        this.appendDummyInput()
          .appendField(label)
          .appendField(new Blockly.FieldNumber(0, -180, 180, 0.1), name);
      }
      this.setInputsInline(false);
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour(HUE_MOTION);
    },
  };

  Blockly.Blocks["robot_gripper"] = {
    init() {
      this.appendDummyInput()
        .appendField("夾爪")
        .appendField(
          new Blockly.FieldDropdown([
            ["開", "open"],
            ["關", "close"],
          ]),
          "STATE",
        );
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour(HUE_IO);
    },
  };

  Blockly.Blocks["robot_jog"] = {
    init() {
      this.appendDummyInput()
        .appendField("點動")
        .appendField(
          new Blockly.FieldDropdown([
            ["J1", "J1"],
            ["J2", "J2"],
            ["J3", "J3"],
            ["J4", "J4"],
            ["J5", "J5"],
            ["J6", "J6"],
          ]),
          "JOINT",
        )
        .appendField("Δ")
        .appendField(new Blockly.FieldNumber(1, -45, 45, 0.1), "DELTA")
        .appendField("°");
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour(HUE_MOTION);
    },
  };
}

const TOOLBOX = {
  kind: "categoryToolbox",
  contents: [
    {
      kind: "category",
      name: "動作",
      colour: String(HUE_MOTION),
      contents: [
        { kind: "block", type: "robot_home" },
        { kind: "block", type: "robot_move" },
        { kind: "block", type: "robot_jog" },
      ],
    },
    {
      kind: "category",
      name: "工具",
      colour: String(HUE_IO),
      contents: [{ kind: "block", type: "robot_gripper" }],
    },
    {
      kind: "category",
      name: "流程",
      colour: String(HUE_FLOW),
      contents: [{ kind: "block", type: "robot_wait" }],
    },
  ],
};

// ---- Block → script line ----
function blockToLine(block: Blockly.Block): string | null {
  switch (block.type) {
    case "robot_home":
      return "HOME";
    case "robot_wait":
      return `WAIT duration=${block.getFieldValue("DURATION")}`;
    case "robot_move": {
      const parts = ["J1", "J2", "J3", "J4", "J5", "J6"].map(
        (j, i) => `j${i + 1}=${block.getFieldValue(j)}`,
      );
      return `MOVE ${parts.join(" ")}`;
    }
    case "robot_gripper":
      return `GRIPPER state=${block.getFieldValue("STATE")}`;
    case "robot_jog":
      return `JOG joint=${block.getFieldValue("JOINT")} delta=${block.getFieldValue("DELTA")}`;
    default:
      return null;
  }
}

function workspaceToScript(workspace: Blockly.WorkspaceSvg): string {
  const lines: string[] = [];
  for (const top of workspace.getTopBlocks(true)) {
    let cur: Blockly.Block | null = top;
    while (cur) {
      const line = blockToLine(cur);
      if (line) lines.push(line);
      cur = cur.getNextBlock();
    }
  }
  return lines.join("\n");
}

export function BlocklyEditor({ robots }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const [robotId, setRobotId] = useState<string>("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState("");

  useEffect(() => {
    if (robots.length > 0 && !robotId) setRobotId(robots[0]);
  }, [robots]);

  useEffect(() => {
    if (!containerRef.current) return;

    defineBlocks();
    const ws = Blockly.inject(containerRef.current, {
      toolbox: TOOLBOX,
      grid: { spacing: 20, length: 3, colour: "#2a2a2a", snap: true },
      trashcan: true,
      zoom: { controls: true, wheel: true, startScale: 0.9 },
      theme: Blockly.Themes.Classic,
    });
    workspaceRef.current = ws;

    const updatePreview = () => setPreview(workspaceToScript(ws));
    ws.addChangeListener(updatePreview);

    const ro = new ResizeObserver(() => Blockly.svgResize(ws));
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      ws.dispose();
      workspaceRef.current = null;
    };
  }, []);

  const run = async () => {
    if (!robotId || !workspaceRef.current) return;
    const code = workspaceToScript(workspaceRef.current);
    if (!code.trim()) {
      setError("沒有積木可執行");
      return;
    }
    setRunning(true);
    setError(null);
    setLog([]);
    try {
      const res = await fetch("/api/v1/robots/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ robot_id: robotId, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "執行失敗");
      setLog(data.log);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const clear = () => {
    workspaceRef.current?.clear();
    setLog([]);
    setError(null);
  };

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
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
        <Button size="sm" onClick={run} disabled={running || !robotId}>
          {running ? "執行中..." : "▶ 執行"}
        </Button>
        <Button size="sm" variant="outline" onClick={clear}>
          清除積木
        </Button>
      </div>

      {/* Workspace + Preview/Output */}
      <div className="flex min-h-0 flex-1 gap-3">
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden rounded-md border bg-background"
        />
        <div className="flex w-80 shrink-0 flex-col gap-3">
          <div className="flex flex-1 min-h-0 flex-col rounded-md border">
            <div className="border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">
              產生的腳本
            </div>
            <pre className="flex-1 overflow-y-auto p-3 font-mono text-xs whitespace-pre-wrap">
              {preview || <span className="text-muted-foreground">拖曳積木以產生腳本...</span>}
            </pre>
          </div>
          <div className="flex flex-1 min-h-0 flex-col rounded-md border">
            <div className="border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">
              輸出
            </div>
            <div className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-1">
              {error && <div className="text-destructive">錯誤: {error}</div>}
              {log.length === 0 && !error && (
                <div className="text-muted-foreground">按下「執行」開始...</div>
              )}
              {log.map((entry, i) => (
                <div
                  key={i}
                  className={entry.success ? "text-green-400" : "text-destructive"}
                >
                  <span className="text-muted-foreground mr-2">{">"}</span>
                  <span className="font-semibold">{entry.line}</span>
                  <br />
                  <span className="ml-4 text-muted-foreground">{entry.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
