"""Mock adapter — target-tracking for deterministic 3D simulation."""

from langflow.robot.adapters.base import CommandResult, RobotAdapter, RobotStatus


class MyRobotAdapter(RobotAdapter):
    """
    Mock adapter that reports the last commanded target state.
    Joints are 6 floats in degrees; gripper is "open" | "close".
    Replace TODOs with real protocol calls when integrating a physical robot.
    """

    def __init__(self, robot_id: str, host: str, port: int, **kwargs):
        super().__init__(robot_id, host, port, **kwargs)
        self._joints: list[float] = [0.0] * 6
        self._gripper: str = "open"
        self._last_cmd: str | None = None

    async def connect(self) -> None:
        # TODO: real handshake
        self._connected = True

    async def disconnect(self) -> None:
        # TODO: real disconnect
        self._connected = False

    async def get_status(self) -> RobotStatus:
        # TODO: real status endpoint
        return RobotStatus(
            robot_id=self.robot_id,
            connected=self._connected,
            joints=list(self._joints),
            position={},  # forward kinematics is computed client-side from joints
            current_task=self._last_cmd,
            last_error=None,
            extra={"gripper": self._gripper},
        )

    async def send_command(self, cmd: str, params: dict) -> CommandResult:
        # TODO: real command endpoint
        self._last_cmd = cmd
        cmd_upper = cmd.upper()

        if cmd_upper == "HOME":
            self._joints = [0.0] * 6
            return CommandResult(success=True, message="homed")

        if cmd_upper == "MOVE":
            for i in range(6):
                key = f"j{i + 1}"
                if key in params:
                    self._joints[i] = float(params[key])
            return CommandResult(success=True, message=f"moved to {self._joints}")

        if cmd_upper == "JOG":
            joint = str(params.get("joint", "")).upper()
            if not joint.startswith("J") or not joint[1:].isdigit():
                return CommandResult(success=False, message=f"bad joint '{joint}'")
            idx = int(joint[1:]) - 1
            if not 0 <= idx < 6:
                return CommandResult(success=False, message=f"joint index out of range: {joint}")
            self._joints[idx] += float(params.get("delta", 0))
            return CommandResult(success=True, message=f"jogged {joint} to {self._joints[idx]}")

        if cmd_upper == "GRIPPER":
            state = str(params.get("state", "")).lower()
            if state not in ("open", "close"):
                return CommandResult(success=False, message=f"bad gripper state '{state}'")
            self._gripper = state
            return CommandResult(success=True, message=f"gripper {state}")

        if cmd_upper == "WAIT":
            return CommandResult(success=True, message=f"waited {params.get('duration', 0)}s")

        return CommandResult(success=False, message=f"unknown command '{cmd}'")
