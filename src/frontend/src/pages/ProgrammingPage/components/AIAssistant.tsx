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
import { Textarea } from "@/components/ui/textarea";

interface LogEntry {
  line: string;
  success: boolean;
  message: string;
}

interface Props {
  robots: string[];
}

const SAMPLES = [
  "從原點抓取左前方的物件，移動到右前方放下",
  "繞著工作區做四個角點巡迴，每個角停 1 秒",
  "回原點後夾爪開合三次，最後回原點",
];

export function AIAssistant({ robots }: Props) {
  const [robotId, setRobotId] = useState<string>("");
  const [instruction, setInstruction] = useState("");
  const [code, setCode] = useState("");
  const [generating, setGenerating] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (robots.length > 0 && !robotId) setRobotId(robots[0]);
  }, [robots]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  const generate = async () => {
    if (!robotId || !instruction.trim()) return;
    setGenerating(true);
    setError(null);
    setCode("");
    try {
      const res = await fetch("/api/v1/robots/nl-program/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ robot_id: robotId, instruction }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? `生成失敗 (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are delimited by blank lines
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const eventLine = frame.split("\n").find((l) => l.startsWith("event:"));
          const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!eventLine || !dataLine) continue;
          const event = eventLine.slice("event:".length).trim();
          const payload = JSON.parse(dataLine.slice("data:".length).trim());
          if (event === "delta") {
            acc += payload.text ?? "";
            setCode(acc);
          } else if (event === "done") {
            // Final canonical text (trimmed server-side); use if present
            if (typeof payload.text === "string" && payload.text) {
              setCode(payload.text);
            }
          } else if (event === "error") {
            throw new Error(payload.detail ?? "生成失敗");
          }
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const run = async () => {
    if (!robotId || !code.trim()) return;
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
              <SelectItem key={id} value={id}>
                {id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          onClick={generate}
          disabled={generating || !robotId || !instruction.trim()}
        >
          {generating ? "生成中..." : "✨ 生成腳本"}
        </Button>
        <Button
          size="sm"
          variant="default"
          onClick={run}
          disabled={running || !robotId || !code.trim()}
        >
          {running ? "執行中..." : "▶ 執行"}
        </Button>
      </div>

      {/* Body: NL input | Generated script | Output */}
      <div className="flex min-h-0 flex-1 gap-3">
        {/* Left: instruction */}
        <div className="flex w-96 shrink-0 flex-col gap-2">
          <label className="text-xs font-medium text-muted-foreground">
            自然語言指令
          </label>
          <Textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="例如：從原點抓取左前方的物件，移動到右前方放下"
            className="flex-1 resize-none font-sans text-sm"
          />
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">範例</span>
            {SAMPLES.map((s) => (
              <button
                key={s}
                onClick={() => setInstruction(s)}
                className="rounded border px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Middle: generated script */}
        <div className="flex-1 overflow-hidden rounded-md border">
          <div className="border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">
            生成的腳本（可直接編輯）
          </div>
          <Editor
            height="calc(100% - 30px)"
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

        {/* Right: output console */}
        <div className="flex w-72 shrink-0 flex-col rounded-md border">
          <div className="border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">
            輸出
          </div>
          <div
            ref={logRef}
            className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-1"
          >
            {error && <div className="text-destructive">錯誤: {error}</div>}
            {log.length === 0 && !error && (
              <div className="text-muted-foreground">
                輸入指令 → 生成腳本 → 執行
              </div>
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
  );
}
