from langflow.custom import Component
from langflow.io import DataInput, MessageTextInput, Output
from langflow.schema import Data
from langflow.robot.registry import robot_registry


class RobotGetStatusComponent(Component):
    display_name = "Robot Get Status"
    description = "Fetches the current status of a robot."
    icon = "activity"
    name = "RobotGetStatus"

    inputs = [
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
        Output(display_name="Status", name="status", method="run"),
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
        status = await adapter.get_status()
        from dataclasses import asdict
        return Data(data=asdict(status))
