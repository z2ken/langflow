from pathlib import Path

from langflow.robot.adapters.my_robot import MyRobotAdapter


def test_adapter_accepts_urdf_path_and_mesh_dir(tmp_path):
    urdf = tmp_path / "robot.urdf"
    urdf.write_text("<robot/>")
    meshes = tmp_path / "meshes"
    meshes.mkdir()

    adapter = MyRobotAdapter(
        robot_id="r",
        host="h",
        port=1,
        urdf_path=str(urdf),
        mesh_dir=str(meshes),
    )
    assert adapter.urdf_path == urdf
    assert adapter.mesh_dir == meshes


def test_adapter_paths_default_to_none():
    adapter = MyRobotAdapter(robot_id="r", host="h", port=1)
    assert adapter.urdf_path is None
    assert adapter.mesh_dir is None
