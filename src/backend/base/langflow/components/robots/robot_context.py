from langflow.custom import Component
from langflow.io import MessageTextInput, Output
from langflow.schema import Data


class RobotContextComponent(Component):
    display_name = "Robot Context"
    description = "Sets the target robot for downstream nodes. Connect this to RobotMove or RobotGetStatus."
    icon = "cpu"
    name = "RobotContext"

    inputs = [
        MessageTextInput(
            name="robot_id",
            display_name="Robot ID",
            info="The robot ID as defined in robots.yaml (e.g. robot_01)",
        ),
    ]

    outputs = [
        Output(display_name="Robot ID", name="robot_id", method="get_robot_id"),
    ]

    def get_robot_id(self) -> Data:
        return Data(data={"robot_id": self.robot_id})
