import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EmergencyStop } from "../components/EmergencyStop";

describe("EmergencyStop", () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    );
  });

  it("renders nothing when mode is not Sync", () => {
    const { container } = render(
      <EmergencyStop
        mode="Live"
        robotId="robot_01"
        onModeChange={jest.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when mode is Offline or Sandbox", () => {
    const { rerender, container } = render(
      <EmergencyStop
        mode="Offline"
        robotId="robot_01"
        onModeChange={jest.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
    rerender(
      <EmergencyStop
        mode="Sandbox"
        robotId="robot_01"
        onModeChange={jest.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a button when mode is Sync", () => {
    render(
      <EmergencyStop
        mode="Sync"
        robotId="robot_01"
        onModeChange={jest.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /緊急停止/ }),
    ).toBeInTheDocument();
  });

  it("posts HOME and reverts to Live when clicked", async () => {
    const onModeChange = jest.fn();
    render(
      <EmergencyStop
        mode="Sync"
        robotId="robot_42"
        onModeChange={onModeChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /緊急停止/ }));
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (global as any).fetch.mock.calls[0];
    expect(url).toBe("/api/v1/robots/robot_42/command");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ cmd: "HOME", params: {} });
    await waitFor(() => expect(onModeChange).toHaveBeenCalledWith("Live"));
  });

  it("still reverts to Live even if the HOME request fails", async () => {
    (global as any).fetch = jest.fn(() => Promise.reject(new Error("network")));
    const onModeChange = jest.fn();
    render(
      <EmergencyStop
        mode="Sync"
        robotId="robot_01"
        onModeChange={onModeChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /緊急停止/ }));
    await waitFor(() => expect(onModeChange).toHaveBeenCalledWith("Live"));
  });
});
