from pathlib import Path
import yaml
from langflow.robot.registry import RobotRegistry


def test_registry_passes_urdf_and_mesh_dir(tmp_path):
    cfg = tmp_path / "robots.yaml"
    cfg.write_text(yaml.dump({
        "robots": {
            "test_bot": {
                "adapter": "MyRobotAdapter",
                "host": "127.0.0.1",
                "port": 8080,
                "urdf_path": "models/test.urdf",
                "mesh_dir": "models/meshes",
            }
        }
    }))
    (tmp_path / "models").mkdir()
    (tmp_path / "models" / "test.urdf").write_text("<robot/>")
    (tmp_path / "models" / "meshes").mkdir()

    reg = RobotRegistry()
    reg.load(cfg)
    adapter = reg.get("test_bot")
    assert adapter.urdf_path == (tmp_path / "models" / "test.urdf").resolve()
    assert adapter.mesh_dir == (tmp_path / "models" / "meshes").resolve()


def test_registry_handles_robots_without_paths(tmp_path):
    cfg = tmp_path / "robots.yaml"
    cfg.write_text(yaml.dump({
        "robots": {
            "plain_bot": {"adapter": "MyRobotAdapter", "host": "h", "port": 1}
        }
    }))
    reg = RobotRegistry()
    reg.load(cfg)
    a = reg.get("plain_bot")
    assert a.urdf_path is None
    assert a.mesh_dir is None
