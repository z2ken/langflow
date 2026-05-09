import pytest
from langflow.robot.adapters.my_robot import MyRobotAdapter


@pytest.mark.asyncio
async def test_move_updates_reported_joints():
    a = MyRobotAdapter(robot_id="r", host="h", port=1)
    await a.connect()
    s0 = await a.get_status()
    assert s0.joints == [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]

    await a.send_command("MOVE", {"j1": 30, "j2": -45, "j3": 10})
    s1 = await a.get_status()
    assert s1.joints[0] == 30.0
    assert s1.joints[1] == -45.0
    assert s1.joints[2] == 10.0
    # Untouched joints unchanged
    assert s1.joints[3] == 0.0


@pytest.mark.asyncio
async def test_home_resets_joints():
    a = MyRobotAdapter(robot_id="r", host="h", port=1)
    await a.connect()
    await a.send_command("MOVE", {"j1": 30, "j2": -45})
    await a.send_command("HOME", {})
    s = await a.get_status()
    assert s.joints == [0.0] * 6


@pytest.mark.asyncio
async def test_jog_increments_single_joint():
    a = MyRobotAdapter(robot_id="r", host="h", port=1)
    await a.connect()
    await a.send_command("JOG", {"joint": "J2", "delta": 5})
    await a.send_command("JOG", {"joint": "J2", "delta": 5})
    s = await a.get_status()
    assert s.joints[1] == 10.0


@pytest.mark.asyncio
async def test_gripper_state_recorded():
    a = MyRobotAdapter(robot_id="r", host="h", port=1)
    await a.connect()
    await a.send_command("GRIPPER", {"state": "close"})
    s = await a.get_status()
    assert s.extra.get("gripper") == "close"


@pytest.mark.asyncio
async def test_unknown_command_fails():
    a = MyRobotAdapter(robot_id="r", host="h", port=1)
    await a.connect()
    r = await a.send_command("FOO", {})
    assert r.success is False
    assert "unknown" in r.message.lower()


@pytest.mark.asyncio
@pytest.mark.parametrize("joint", ["X1", "J", "J0", "J7", ""])
async def test_jog_rejects_bad_joint_name(joint):
    a = MyRobotAdapter(robot_id="r", host="h", port=1)
    await a.connect()
    r = await a.send_command("JOG", {"joint": joint, "delta": 1})
    assert r.success is False


@pytest.mark.asyncio
async def test_gripper_rejects_bad_state():
    a = MyRobotAdapter(robot_id="r", host="h", port=1)
    await a.connect()
    r = await a.send_command("GRIPPER", {"state": "half"})
    assert r.success is False
    # Gripper state should be unchanged from default "open"
    s = await a.get_status()
    assert s.extra.get("gripper") == "open"
