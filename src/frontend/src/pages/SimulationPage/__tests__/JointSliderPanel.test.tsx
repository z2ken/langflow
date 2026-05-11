import { fireEvent, render, screen } from "@testing-library/react";
import { JointSliderPanel } from "../components/JointSliderPanel";

function fakeRobot(
  jointNames: string[],
  limits: Record<string, [number, number]> = {},
): any {
  const joints: Record<string, any> = {};
  for (const n of jointNames) {
    joints[n] = {
      jointType: "revolute",
      limit: limits[n]
        ? { lower: limits[n][0], upper: limits[n][1] }
        : { lower: -Math.PI, upper: Math.PI },
    };
  }
  return { joints };
}

describe("JointSliderPanel", () => {
  it("returns null when not enabled", () => {
    const robot = fakeRobot(["j1"]);
    const { container } = render(
      <JointSliderPanel
        robot={robot}
        jointsDeg={[0]}
        enabled={false}
        onJointsChange={jest.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders one slider per actuated joint", () => {
    const robot = fakeRobot(["j1", "j2", "j3"]);
    render(
      <JointSliderPanel
        robot={robot}
        jointsDeg={[10, -20, 30]}
        enabled
        onJointsChange={jest.fn()}
      />,
    );
    expect(screen.getAllByRole("slider")).toHaveLength(3);
  });

  it("converts URDF limits (radians) into the slider's degree min/max", () => {
    const robot = fakeRobot(["j1"], { j1: [-Math.PI / 2, Math.PI / 2] });
    render(
      <JointSliderPanel
        robot={robot}
        jointsDeg={[0]}
        enabled
        onJointsChange={jest.fn()}
      />,
    );
    const slider = screen.getByRole("slider") as HTMLInputElement;
    expect(Number(slider.min)).toBeCloseTo(-90, 0);
    expect(Number(slider.max)).toBeCloseTo(90, 0);
  });

  it("calls onJointsChange with the updated index when a slider moves", () => {
    const onJointsChange = jest.fn();
    const robot = fakeRobot(["j1", "j2"]);
    render(
      <JointSliderPanel
        robot={robot}
        jointsDeg={[5, -15]}
        enabled
        onJointsChange={onJointsChange}
      />,
    );
    const sliders = screen.getAllByRole("slider") as HTMLInputElement[];
    fireEvent.change(sliders[1], { target: { value: "42" } });
    expect(onJointsChange).toHaveBeenCalledWith([5, 42]);
  });

  it("writes a MOVE command for the current pose to the clipboard", async () => {
    const writeText = jest.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    const robot = fakeRobot(["j1", "j2", "j3", "j4", "j5", "j6"]);
    render(
      <JointSliderPanel
        robot={robot}
        jointsDeg={[10, -20, 30.5, 0, 45, -90]}
        enabled
        onJointsChange={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /複製為 MOVE/ }));
    expect(writeText).toHaveBeenCalledWith(
      "MOVE j1=10 j2=-20 j3=30.5 j4=0 j5=45 j6=-90",
    );
  });

  it("zeros every joint when 重設 is clicked", () => {
    const onJointsChange = jest.fn();
    const robot = fakeRobot(["j1", "j2", "j3"]);
    render(
      <JointSliderPanel
        robot={robot}
        jointsDeg={[10, -20, 30]}
        enabled
        onJointsChange={onJointsChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /重設/ }));
    expect(onJointsChange).toHaveBeenCalledWith([0, 0, 0]);
  });

  it("falls back to ±180° when joint limits are missing", () => {
    const robot = {
      joints: { j1: { jointType: "revolute" } },
    };
    render(
      <JointSliderPanel
        robot={robot as any}
        jointsDeg={[0]}
        enabled
        onJointsChange={jest.fn()}
      />,
    );
    const slider = screen.getByRole("slider") as HTMLInputElement;
    expect(Number(slider.min)).toBe(-180);
    expect(Number(slider.max)).toBe(180);
  });
});
