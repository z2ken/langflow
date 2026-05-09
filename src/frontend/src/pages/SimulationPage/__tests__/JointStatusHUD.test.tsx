import { render, screen } from "@testing-library/react";
import { JointStatusHUD } from "../components/JointStatusHUD";

function fakeRobot(jointNames: string[]): any {
  const joints: Record<string, any> = {};
  for (const n of jointNames) joints[n] = { jointType: "revolute" };
  return { joints };
}

describe("JointStatusHUD", () => {
  it("renders one row per actuated joint with the value in degrees", () => {
    const robot = fakeRobot(["j1", "j2", "j3", "j4", "j5", "j6"]);
    render(<JointStatusHUD robot={robot} jointsDeg={[10, -20.5, 45.111, 0, 90, -5]} />);
    expect(screen.getByText("j1")).toBeInTheDocument();
    expect(screen.getByText("10.0°")).toBeInTheDocument();
    expect(screen.getByText("-20.5°")).toBeInTheDocument();
    expect(screen.getByText("45.1°")).toBeInTheDocument();
    expect(screen.getByText("90.0°")).toBeInTheDocument();
  });

  it("ignores fixed joints and follows declaration order", () => {
    const robot = {
      joints: {
        base_to_shoulder: { jointType: "fixed" },
        shoulder_pan_joint: { jointType: "revolute" },
        wrist_3_joint: { jointType: "revolute" },
        flange_fixed: { jointType: "fixed" },
      },
    };
    const { container } = render(
      <JointStatusHUD robot={robot as any} jointsDeg={[15, -30]} />,
    );
    const rows = container.querySelectorAll("[data-joint-row]");
    expect(rows.length).toBe(2);
    expect(rows[0]).toHaveTextContent("shoulder_pan_joint");
    expect(rows[0]).toHaveTextContent("15.0°");
    expect(rows[1]).toHaveTextContent("wrist_3_joint");
    expect(rows[1]).toHaveTextContent("-30.0°");
  });

  it("returns null when robot has no actuated joints", () => {
    const robot = { joints: { fixed1: { jointType: "fixed" } } };
    const { container } = render(
      <JointStatusHUD robot={robot as any} jointsDeg={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows 0.0° for joint indices missing from jointsDeg", () => {
    const robot = fakeRobot(["a", "b", "c"]);
    render(<JointStatusHUD robot={robot} jointsDeg={[5]} />);
    expect(screen.getByText("5.0°")).toBeInTheDocument();
    expect(screen.getAllByText("0.0°").length).toBe(2);
  });
});
