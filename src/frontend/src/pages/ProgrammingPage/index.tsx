import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeEditor } from "./components/CodeEditor";
import { TeachPendant } from "./components/TeachPendant";
import { BlocklyEditor } from "./components/BlocklyEditor";

export default function ProgrammingPage() {
  const [robots, setRobots] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/v1/robots")
      .then((r) => r.json())
      .then((list: { robot_id: string }[]) => setRobots(list.map((r) => r.robot_id)))
      .catch(() => {});
  }, []);

  return (
    <div className="flex h-full w-full flex-col p-6">
      <h1 className="mb-4 text-2xl font-semibold">程式編寫</h1>
      <Tabs defaultValue="code" className="flex flex-1 flex-col min-h-0">
        <TabsList className="mb-3 border-b">
          <TabsTrigger value="code">文字編程</TabsTrigger>
          <TabsTrigger value="blocks">積木編程</TabsTrigger>
          <TabsTrigger value="pendant">示教器</TabsTrigger>
        </TabsList>
        <TabsContent value="code" className="flex-1 min-h-0">
          <CodeEditor robots={robots} />
        </TabsContent>
        <TabsContent value="blocks" className="flex-1 min-h-0">
          <BlocklyEditor robots={robots} />
        </TabsContent>
        <TabsContent value="pendant" className="flex-1 min-h-0">
          <TeachPendant robots={robots} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
