import math
import time

from langflow.robot.adapters.base import CommandResult, RobotAdapter, RobotStatus

_TASKS = [None, None, None, "移動至 waypoint_A", "執行抓取", "移動至 home"]


class MyRobotAdapter(RobotAdapter):
    """
    Stub adapter with simulated dynamic data.
    Replace the TODO sections with real private API calls when ready.
    """

    def __init__(self, robot_id: str, host: str, port: int, **kwargs):
        super().__init__(robot_id, host, port, **kwargs)
        self._base_url = f"http://{host}:{port}"
        self._start_time = time.time()

    async def connect(self) -> None:
        # TODO: replace with real handshake/auth call
        # async with httpx.AsyncClient() as c:
        #     await c.post(f"{self._base_url}/connect", json={"token": "..."})
        self._connected = True

    async def disconnect(self) -> None:
        # TODO: replace with real disconnect call
        self._connected = False

    async def get_status(self) -> RobotStatus:
        # TODO: replace with real status endpoint
        # async with httpx.AsyncClient() as c:
        #     r = await c.get(f"{self._base_url}/status")
        #     d = r.json()
        #     return RobotStatus(robot_id=self.robot_id, connected=True,
        #                        joints=d["joints"], position=d["position"], ...)

        # Simulated: joints oscillate sinusoidally to look like a moving robot
        t = time.time() - self._start_time
        joints = [
            round(30 * math.sin(t * 0.3 + i * 1.0), 2)
            for i in range(6)
        ]
        position = {
            "x": round(200 + 50 * math.sin(t * 0.2), 2),
            "y": round(150 + 50 * math.cos(t * 0.15), 2),
            "z": round(300 + 30 * math.sin(t * 0.25), 2),
            "rx": round(10 * math.sin(t * 0.1), 2),
            "ry": round(10 * math.cos(t * 0.1), 2),
            "rz": round(joints[0], 2),
        }
        task_index = int(t / 4) % len(_TASKS)
        return RobotStatus(
            robot_id=self.robot_id,
            connected=self._connected,
            joints=joints,
            position=position,
            current_task=_TASKS[task_index],
            last_error=None,
        )

    async def send_command(self, cmd: str, params: dict) -> CommandResult:
        # TODO: replace with real command endpoint
        # async with httpx.AsyncClient() as c:
        #     r = await c.post(f"{self._base_url}/command", json={"cmd": cmd, **params})
        #     d = r.json()
        #     return CommandResult(success=d["ok"], message=d["msg"])

        return CommandResult(
            success=True,
            message=f"[mock] '{cmd}' executed with {params}",
        )
