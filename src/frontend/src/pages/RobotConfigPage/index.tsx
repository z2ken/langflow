import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface RobotConfig {
  robot_id: string;
  adapter: string;
  host: string;
  port: number;
}

interface ConfigResponse {
  adapters: string[];
  robots: RobotConfig[];
}

const EMPTY_FORM: Omit<RobotConfig, "robot_id"> & { robot_id: string } = {
  robot_id: "",
  adapter: "",
  host: "",
  port: 8080,
};

export default function RobotConfigPage() {
  const [data, setData] = useState<ConfigResponse>({ adapters: [], robots: [] });
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = () => {
    fetch("/api/v1/robots/config")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setError("無法載入設定，請確認後端是否啟動。"));
  };

  useEffect(() => { load(); }, []);

  const patchForm = (key: keyof typeof form, value: string | number) =>
    setForm((f) => ({ ...f, [key]: value }));

  const startEdit = (robot: RobotConfig) => {
    setShowAdd(false);
    setEditingId(robot.robot_id);
    setForm({ robot_id: robot.robot_id, adapter: robot.adapter, host: robot.host, port: robot.port });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setShowAdd(false);
    setForm({ ...EMPTY_FORM });
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/robots/config/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adapter: form.adapter, host: form.host, port: Number(form.port) }),
      });
      if (!res.ok) throw new Error((await res.json()).detail);
      setEditingId(null);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const addRobot = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/robots/config/${form.robot_id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adapter: form.adapter, host: form.host, port: Number(form.port) }),
      });
      if (!res.ok) throw new Error((await res.json()).detail);
      setShowAdd(false);
      setForm({ ...EMPTY_FORM });
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteRobot = async (robotId: string) => {
    if (!confirm(`確定要刪除 ${robotId}？`)) return;
    try {
      await fetch(`/api/v1/robots/config/${robotId}`, { method: "DELETE" });
      load();
    } catch {
      setError("刪除失敗");
    }
  };

  const formValid =
    form.adapter.trim() !== "" &&
    form.host.trim() !== "" &&
    form.port > 0 &&
    (editingId !== null || form.robot_id.trim() !== "");

  return (
    <div className="flex h-full w-full flex-col overflow-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">機器人設定</h1>
        {!showAdd && editingId === null && (
          <Button
            size="sm"
            onClick={() => { setShowAdd(true); setForm({ ...EMPTY_FORM }); }}
          >
            + 新增機器人
          </Button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
          <button className="ml-2 underline" onClick={() => setError(null)}>關閉</button>
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <Card className="mb-6 border-dashed">
          <CardHeader>
            <CardTitle className="text-sm">新增機器人</CardTitle>
          </CardHeader>
          <CardContent>
            <RobotForm
              form={form}
              adapters={data.adapters}
              isNew
              onChange={patchForm}
              onSave={addRobot}
              onCancel={cancelEdit}
              saving={saving}
              valid={formValid}
            />
          </CardContent>
        </Card>
      )}

      {/* Robot list */}
      {data.robots.length === 0 && !showAdd ? (
        <p className="text-muted-foreground">尚無機器人設定。</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.robots.map((robot) =>
            editingId === robot.robot_id ? (
              <Card key={robot.robot_id}>
                <CardHeader>
                  <CardTitle className="text-sm">{robot.robot_id}</CardTitle>
                </CardHeader>
                <CardContent>
                  <RobotForm
                    form={form}
                    adapters={data.adapters}
                    isNew={false}
                    onChange={patchForm}
                    onSave={saveEdit}
                    onCancel={cancelEdit}
                    saving={saving}
                    valid={formValid}
                  />
                </CardContent>
              </Card>
            ) : (
              <Card key={robot.robot_id}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">{robot.robot_id}</CardTitle>
                  <Badge variant="outline">{robot.adapter}</Badge>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>主機</span>
                    <span className="font-mono">{robot.host}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>埠號</span>
                    <span className="font-mono">{robot.port}</span>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => startEdit(robot)}>
                      編輯
                    </Button>
                    <Button size="sm" variant="destructive" className="flex-1" onClick={() => deleteRobot(robot.robot_id)}>
                      刪除
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          )}
        </div>
      )}
    </div>
  );
}

interface FormProps {
  form: { robot_id: string; adapter: string; host: string; port: number };
  adapters: string[];
  isNew: boolean;
  onChange: (key: any, value: string | number) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  valid: boolean;
}

function RobotForm({ form, adapters, isNew, onChange, onSave, onCancel, saving, valid }: FormProps) {
  return (
    <div className="space-y-3">
      {isNew && (
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">機器人 ID</label>
          <Input
            placeholder="robot_01"
            value={form.robot_id}
            onChange={(e) => onChange("robot_id", e.target.value)}
          />
        </div>
      )}
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">Adapter</label>
        <Select value={form.adapter} onValueChange={(v) => onChange("adapter", v)}>
          <SelectTrigger>
            <SelectValue placeholder="選擇 Adapter" />
          </SelectTrigger>
          <SelectContent>
            {adapters.map((a) => (
              <SelectItem key={a} value={a}>{a}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">主機 / IP</label>
        <Input
          placeholder="192.168.1.10"
          value={form.host}
          onChange={(e) => onChange("host", e.target.value)}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">埠號</label>
        <Input
          type="number"
          placeholder="8080"
          value={form.port}
          onChange={(e) => onChange("port", parseInt(e.target.value, 10) || 0)}
        />
      </div>
      <div className="flex gap-2 pt-1">
        <Button size="sm" className="flex-1" onClick={onSave} disabled={saving || !valid}>
          {saving ? "儲存中..." : "儲存"}
        </Button>
        <Button size="sm" variant="outline" className="flex-1" onClick={onCancel} disabled={saving}>
          取消
        </Button>
      </div>
    </div>
  );
}
