import Editor from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STARTER = `# Robot Script
# Commands: MOVE, GRIPPER, WAIT, HOME
# Params:   key=value pairs
#
# Example:
HOME
WAIT duration=1
MOVE j1=45 j2=-30 j3=60 j4=0 j5=90 j6=0
GRIPPER state=open
MOVE j1=0 j2=0 j3=0 j4=0 j5=0 j6=0
GRIPPER state=close
`;

interface LogEntry {
  line: string;
  success: boolean;
  message: string;
}

interface Props {
  robots: string[];
}

export function CodeEditor({ robots }: Props) {
  const [code, setCode] = useState(STARTER);
  const [robotId, setRobotId] = useState<string>("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (robots.length > 0 && !robotId) setRobotId(robots[0]);
  }, [robots]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  const run = async () => {
    if (!robotId) return;
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
              <SelectItem key={id} value={id}>{id}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={run} disabled={running || !robotId}>
          {running ? "執行中..." : "▶ 執行"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setLog([])}>
          清除輸出
        </Button>
      </div>

      {/* Editor + Output split */}
      <div className="flex min-h-0 flex-1 gap-3">
        {/* Monaco Editor */}
        <div className="flex-1 overflow-hidden rounded-md border">
          <Editor
            height="100%"
            defaultLanguage="plaintext"
            value={code}
            onChange={(v) => setCode(v ?? "")}
            theme="vs-dark"
            options={{
              fontSize: 13,
              minimap: { enabled: false },
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              wordWrap: "on",
            }}
          />
        </div>

        {/* Output console */}
        <div className="flex w-80 shrink-0 flex-col rounded-md border">
          <div className="border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">
            輸出
          </div>
          <div
            ref={logRef}
            className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-1"
          >
            {error && (
              <div className="text-destructive">錯誤: {error}</div>
            )}
            {log.length === 0 && !error && (
              <div className="text-muted-foreground">按下「執行」開始...</div>
            )}
            {log.map((entry, i) => (
              <div key={i} className={entry.success ? "text-green-400" : "text-destructive"}>
                <span className="text-muted-foreground mr-2">{`>`}</span>
                <span className="font-semibold">{entry.line}</span>
                <br />
                <span className="ml-4 text-muted-foreground">{entry.message}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
