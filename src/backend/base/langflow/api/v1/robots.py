import asyncio
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
