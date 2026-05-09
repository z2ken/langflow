from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class RobotStatus:
    robot_id: str
    connected: bool
    joints: list[float] = field(default_factory=list)
    position: dict[str, float] = field(default_factory=dict)
    current_task: str | None = None
    last_error: str | None = None
    extra: dict = field(default_factory=dict)


@dataclass
class CommandResult:
    success: bool
    message: str
    data: dict = field(default_factory=dict)


class RobotAdapter(ABC):
    def __init__(self, robot_id: str, host: str, port: int, **kwargs):
        self.robot_id = robot_id
        self.host = host
        self.port = port
        self._connected = False

    @abstractmethod
    async def connect(self) -> None: ...

    @abstractmethod
    async def disconnect(self) -> None: ...

    @abstractmethod
    async def get_status(self) -> RobotStatus: ...

    @abstractmethod
    async def send_command(self, cmd: str, params: dict) -> CommandResult: ...

    @property
    def connected(self) -> bool:
        return self._connected
