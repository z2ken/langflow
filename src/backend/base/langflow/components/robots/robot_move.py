from langflow.custom import Component
from langflow.io import DataInput, MessageTextInput, Output
from langflow.schema import Data
from langflow.robot.registry import robot_registry


class RobotMoveComponent(Component):
    display_name = "Robot Move"
    description = "Sends a move command to a robot. Connect RobotContext to set the target robot."
    icon = "move"
    name = "RobotMove"

    inputs = [
        MessageTextInput(
            name="target",
            display_name="Target",
            info="Waypoint name or coordinates (e.g. 'home' or '100,200,300')",
        ),
        MessageTextInput(
            name="robot_id",
            display_name="Robot ID",
            info="Override robot ID. Leave empty to use upstream RobotContext.",
            advanced=True,
            value="",
        ),
        DataInput(
            name="context",
            display_name="Robot Context",
            info="Connect a RobotContext node to inherit the robot ID.",
            required=False,
        ),
    ]

    outputs = [
        Output(display_name="Result", name="result", method="run"),
    ]

    def _resolve_robot_id(self) -> str:
        if self.robot_id:
            return self.robot_id
        if self.context and isinstance(self.context, Data):
            return self.context.data.get("robot_id", "")
        raise ValueError("robot_id is required. Set it directly or connect a RobotContext node.")

    async def run(self) -> Data:
        robot_id = self._resolve_robot_id()
        adapter = robot_registry.get(robot_id)
        result = await adapter.send_command("move", {"target": self.target})
        from dataclasses import asdict
        return Data(data=asdict(result))
