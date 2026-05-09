from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path


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
    def __init__(
        self,
        robot_id: str,
        host: str,
        port: int,
        *,
        urdf_path: str | None = None,
        mesh_dir: str | None = None,
        **_kwargs,
    ):
        self.robot_id = robot_id
        self.host = host
        self.port = port
        self._connected = False
        self._urdf_path: Path | None = Path(urdf_path) if urdf_path else None
        self._mesh_dir: Path | None = Path(mesh_dir) if mesh_dir else None

    @property
    def urdf_path(self) -> Path | None:
        return self._urdf_path

    @property
    def mesh_dir(self) -> Path | None:
        return self._mesh_dir

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
