import asyncio
import os
from dataclasses import asdict

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from langflow.robot.registry import AVAILABLE_ADAPTERS, robot_registry

router = APIRouter(prefix="/robots", tags=["robots"])


class CommandRequest(BaseModel):
    cmd: str
    params: dict = {}


class RobotConfigBody(BaseModel):
    adapter: str
    host: str
    port: int


class RunProgramRequest(BaseModel):
    robot_id: str
    code: str


class NLProgramRequest(BaseModel):
    robot_id: str
    instruction: str


@router.get("")
async def list_robots():
    return [
        {"robot_id": rid, "connected": adapter.connected}
        for rid, adapter in robot_registry.all().items()
    ]


@router.get("/{robot_id}/status")
async def get_robot_status(robot_id: str):
    try:
        adapter = robot_registry.get(robot_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Robot '{robot_id}' not found")
    status = await adapter.get_status()
    return asdict(status)


@router.post("/{robot_id}/command")
async def send_robot_command(robot_id: str, body: CommandRequest):
    try:
        adapter = robot_registry.get(robot_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Robot '{robot_id}' not found")
    result = await adapter.send_command(body.cmd, body.params)
    return asdict(result)


@router.websocket("/ws/{robot_id}")
async def robot_status_ws(websocket: WebSocket, robot_id: str):
    try:
        adapter = robot_registry.get(robot_id)
    except KeyError:
        await websocket.close(code=4004, reason=f"Robot '{robot_id}' not found")
        return

    await websocket.accept()
    try:
        while True:
            status = await adapter.get_status()
            await websocket.send_json(asdict(status))
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        pass


# ---- program runner ----

@router.post("/run")
async def run_program(body: RunProgramRequest):
    """
    Execute a simple line-by-line robot program on the specified robot.
    Each non-empty, non-comment line is parsed as: COMMAND [key=value ...]
    Returns a log of results per line.
    """
    try:
        adapter = robot_registry.get(body.robot_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Robot '{body.robot_id}' not found")

    log: list[dict] = []
    for raw_line in body.code.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        cmd = parts[0].upper()
        params: dict = {}
        for token in parts[1:]:
            if "=" in token:
                k, _, v = token.partition("=")
                try:
                    params[k] = float(v)
                except ValueError:
                    params[k] = v
        result = await adapter.send_command(cmd, params)
        log.append({"line": line, "success": result.success, "message": result.message})
        if not result.success:
            break

    return {"robot_id": body.robot_id, "log": log}


# ---- config CRUD ----

@router.get("/config")
async def list_robot_configs():
    cfg = robot_registry.get_config()
    return {
        "adapters": AVAILABLE_ADAPTERS,
        "robots": [
            {"robot_id": rid, **v} for rid, v in cfg.items()
        ],
    }


@router.post("/config/{robot_id}", status_code=201)
async def add_robot_config(robot_id: str, body: RobotConfigBody):
    try:
        robot_registry.add(robot_id, body.adapter, body.host, body.port)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"robot_id": robot_id, **body.model_dump()}


@router.put("/config/{robot_id}")
async def update_robot_config(robot_id: str, body: RobotConfigBody):
    try:
        robot_registry.update(robot_id, body.adapter, body.host, body.port)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"robot_id": robot_id, **body.model_dump()}


@router.delete("/config/{robot_id}", status_code=204)
async def delete_robot_config(robot_id: str):
    try:
        robot_registry.remove(robot_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ---- AI assistant: natural language -> robot script ----

_NL_SYSTEM_PROMPT = """You are a robot programming assistant. Translate natural language instructions into a robot script.

The script grammar (one command per line):
- HOME -- return to origin
- WAIT duration=N -- wait N seconds
- MOVE j1=N j2=N j3=N j4=N j5=N j6=N -- move to joint angles in degrees (-180 to 180)
- GRIPPER state=open|close -- open or close the gripper
- JOG joint=Jx delta=N -- incrementally move joint Jx by N degrees (Jx in J1..J6)
- Lines starting with # are comments

Rules:
- Output ONLY the script. No markdown, no explanation, no code fences.
- Use joint angles in degrees, between -180 and 180.
- Default to safe sequences: HOME at start, GRIPPER open before pick, GRIPPER close after pick, HOME at end.
- If the instruction is ambiguous, choose reasonable defaults and add a leading # comment explaining the assumption.

Example:
User: pick up an item on the left and move it to the right
Output:
HOME
GRIPPER state=open
MOVE j1=-45 j2=-30 j3=60 j4=0 j5=90 j6=0
GRIPPER state=close
WAIT duration=0.5
MOVE j1=45 j2=-30 j3=60 j4=0 j5=90 j6=0
GRIPPER state=open
HOME"""


_anthropic_client = None


def _get_anthropic_client():
    global _anthropic_client
    if _anthropic_client is not None:
        return _anthropic_client

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY 未設定，無法使用 AI 助理。請在後端環境變數中設定後重啟。",
        )
    try:
        import anthropic
    except ImportError as e:
        raise HTTPException(status_code=503, detail=f"anthropic SDK 未安裝: {e}")

    _anthropic_client = anthropic.AsyncAnthropic(api_key=api_key)
    return _anthropic_client


@router.post("/nl-program")
async def generate_program_from_nl(body: NLProgramRequest):
    """Use Claude to translate a natural language instruction into a robot script."""
    try:
        robot_registry.get(body.robot_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Robot '{body.robot_id}' not found")
    if not body.instruction.strip():
        raise HTTPException(status_code=400, detail="instruction 不可為空")

    client = _get_anthropic_client()

    import anthropic

    try:
        message = await client.messages.create(
            model="claude-opus-4-7",
            max_tokens=2048,
            system=[
                {
                    "type": "text",
                    "text": _NL_SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": body.instruction}],
        )
    except anthropic.APIStatusError as e:
        raise HTTPException(status_code=e.status_code or 502, detail=str(e))
    except anthropic.APIConnectionError as e:
        raise HTTPException(status_code=502, detail=f"Anthropic API 連線失敗: {e}")

    text = "".join(b.text for b in message.content if b.type == "text").strip()
    return {
        "robot_id": body.robot_id,
        "instruction": body.instruction,
        "generated_code": text,
    }
