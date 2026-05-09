import { act, renderHook, waitFor } from "@testing-library/react";
import { useSimulator } from "../hooks/useSimulator";

// Minimal in-test WebSocket mock that lets us push frames at will.
class MockWS {
  static instances: MockWS[] = [];
  url: string;
  onopen: ((this: WebSocket, ev: Event) => any) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null = null;
  onclose: ((this: WebSocket, ev: CloseEvent) => any) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    MockWS.instances.push(this);
  }
  send(_data: any) {}
  close() {
    this.closed = true;
    this.onclose?.call(this as any, {} as CloseEvent);
  }
  emit(payload: any) {
    this.onmessage?.call(this as any, { data: JSON.stringify(payload) } as MessageEvent);
  }
}

beforeEach(() => {
  MockWS.instances = [];
  (globalThis as any).WebSocket = MockWS as any;
  // Stub fetch (used by a "snap once" path); default to error so missing stubs
  // are obvious.
  (globalThis as any).fetch = jest.fn().mockRejectedValue(new Error("no fetch stub"));
});

describe("useSimulator — initial state", () => {
  it("starts in Live mode with zero joints and idle status", () => {
    const { result } = renderHook(() => useSimulator("robot_01"));
    expect(result.current.mode).toBe("Live");
    expect(result.current.joints).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe("useSimulator — Live mode", () => {
  it("opens a WebSocket on mount", () => {
    renderHook(() => useSimulator("robot_01"));
    expect(MockWS.instances).toHaveLength(1);
    expect(MockWS.instances[0].url).toMatch(/\/api\/v1\/robots\/ws\/robot_01$/);
  });

  it("updates joints when WS pushes a frame", async () => {
    const { result } = renderHook(() => useSimulator("robot_01"));
    act(() => {
      MockWS.instances[0].emit({ joints: [1, 2, 3, 4, 5, 6] });
    });
    await waitFor(() => expect(result.current.joints).toEqual([1, 2, 3, 4, 5, 6]));
  });

  it("ignores malformed frames", () => {
    const { result } = renderHook(() => useSimulator("robot_01"));
    act(() => {
      MockWS.instances[0].emit({ joints: "not-an-array" });
      MockWS.instances[0].emit({ joints: [1, 2] });  // wrong length
    });
    expect(result.current.joints).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe("useSimulator — mode transitions", () => {
  it("disconnects the WS when switching Live -> Sandbox", async () => {
    const { result } = renderHook(() => useSimulator("robot_01"));
    const ws = MockWS.instances[0];
    act(() => result.current.setMode("Sandbox"));
    await waitFor(() => expect(ws.closed).toBe(true));
    expect(result.current.mode).toBe("Sandbox");
  });

  it("does NOT reconnect when going Live -> Sync (both are WS modes)", async () => {
    const { result } = renderHook(() => useSimulator("robot_01"));
    const wsBefore = MockWS.instances[0];
    act(() => result.current.setMode("Sync"));
    expect(MockWS.instances).toHaveLength(1); // no new connection
    expect(wsBefore.closed).toBe(false);
  });

  it("snaps to last WS joints when entering Offline from Live", async () => {
    const { result } = renderHook(() => useSimulator("robot_01"));
    act(() => MockWS.instances[0].emit({ joints: [10, 20, 30, 40, 50, 60] }));
    await waitFor(() => expect(result.current.joints[0]).toBe(10));
    act(() => result.current.setMode("Offline"));
    expect(result.current.joints).toEqual([10, 20, 30, 40, 50, 60]);
    expect(MockWS.instances[0].closed).toBe(true);
  });
});

describe("useSimulator — setJoints", () => {
  it("setJoints in Sandbox updates local state without sending commands", () => {
    const { result } = renderHook(() => useSimulator("robot_01"));
    act(() => result.current.setMode("Sandbox"));
    act(() => result.current.setJoints([5, 0, 0, 0, 0, 0]));
    expect(result.current.joints).toEqual([5, 0, 0, 0, 0, 0]);
  });

  it("setJoints in Sync POSTs a debounced MOVE command", async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    (globalThis as any).fetch = fetchMock;

    const { result } = renderHook(() => useSimulator("robot_01"));
    act(() => result.current.setMode("Sync"));
    act(() => result.current.setJoints([1, 2, 3, 4, 5, 6]));
    act(() => result.current.setJoints([7, 8, 9, 10, 11, 12])); // coalesced

    expect(fetchMock).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(300);
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/robots/robot_01/command");
    expect(JSON.parse(init.body)).toEqual({
      cmd: "MOVE",
      params: { j1: 7, j2: 8, j3: 9, j4: 10, j5: 11, j6: 12 },
    });
    jest.useRealTimers();
  });

  it("setJoints in Live is a no-op (drag disabled)", () => {
    const { result } = renderHook(() => useSimulator("robot_01"));
    // Stays in Live (default)
    act(() => result.current.setJoints([1, 2, 3, 4, 5, 6]));
    expect(result.current.joints).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
