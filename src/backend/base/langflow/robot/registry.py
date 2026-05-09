from pathlib import Path

import yaml

from langflow.robot.adapters.base import RobotAdapter
from langflow.robot.adapters.my_robot import MyRobotAdapter

_ADAPTER_MAP: dict[str, type[RobotAdapter]] = {
    "MyRobotAdapter": MyRobotAdapter,
}

AVAILABLE_ADAPTERS = list(_ADAPTER_MAP.keys())


class RobotRegistry:
    def __init__(self):
        self._adapters: dict[str, RobotAdapter] = {}
        self._config: dict[str, dict] = {}
        self._config_path: Path | None = None

    def load(self, config_path: Path) -> None:
        self._config_path = config_path
        if not config_path.exists():
            return
        data = yaml.safe_load(config_path.read_text()) or {}
        self._config = data.get("robots") or {}
        for robot_id, cfg in self._config.items():
            self._instantiate(robot_id, cfg)

    def _instantiate(self, robot_id: str, cfg: dict) -> None:
        adapter_cls = _ADAPTER_MAP.get(cfg["adapter"])
        if adapter_cls is None:
            raise ValueError(f"Unknown adapter '{cfg['adapter']}' for robot '{robot_id}'")

        base_dir = self._config_path.parent.resolve() if self._config_path else None

        def _resolve(rel: str | None) -> str | None:
            if not rel:
                return None
            p = Path(rel)
            if p.is_absolute() or base_dir is None:
                return str(p.resolve())
            return str((base_dir / p).resolve())

        self._adapters[robot_id] = adapter_cls(
            robot_id=robot_id,
            host=cfg["host"],
            port=int(cfg["port"]),
            urdf_path=_resolve(cfg.get("urdf_path")),
            mesh_dir=_resolve(cfg.get("mesh_dir")),
        )

    def _save(self) -> None:
        if self._config_path is None:
            return
        self._config_path.write_text(yaml.dump({"robots": self._config}, default_flow_style=False))

    # ---- read ----

    def get(self, robot_id: str) -> RobotAdapter:
        if robot_id not in self._adapters:
            raise KeyError(f"Robot '{robot_id}' not found in registry")
        return self._adapters[robot_id]

    def all(self) -> dict[str, RobotAdapter]:
        return dict(self._adapters)

    def get_config(self) -> dict[str, dict]:
        return dict(self._config)

    # ---- write ----

    def add(self, robot_id: str, adapter: str, host: str, port: int) -> None:
        if robot_id in self._config:
            raise ValueError(f"Robot '{robot_id}' already exists")
        cfg = {"adapter": adapter, "host": host, "port": port}
        self._config[robot_id] = cfg
        self._instantiate(robot_id, cfg)
        self._save()

    def update(self, robot_id: str, adapter: str, host: str, port: int) -> None:
        if robot_id not in self._config:
            raise KeyError(f"Robot '{robot_id}' not found")
        cfg = {"adapter": adapter, "host": host, "port": port}
        self._config[robot_id] = cfg
        self._instantiate(robot_id, cfg)
        self._save()

    def remove(self, robot_id: str) -> None:
        if robot_id not in self._config:
            raise KeyError(f"Robot '{robot_id}' not found")
        del self._config[robot_id]
        del self._adapters[robot_id]
        self._save()

    # ---- lifecycle ----

    async def connect_all(self) -> None:
        for adapter in self._adapters.values():
            await adapter.connect()

    async def disconnect_all(self) -> None:
        for adapter in self._adapters.values():
            await adapter.disconnect()


robot_registry = RobotRegistry()
