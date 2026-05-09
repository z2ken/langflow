import {
  isCommandEmitted,
  isDragEnabled,
  jointSourceFor,
  needsConfirmation,
  type SimMode,
  sideEffectsForTransition,
} from "../hooks/simModeFsm";

describe("jointSourceFor", () => {
  it("returns 'ws' for Live and Sync", () => {
    expect(jointSourceFor("Live")).toBe("ws");
    expect(jointSourceFor("Sync")).toBe("ws");
  });
  it("returns 'local' for Offline and Sandbox", () => {
    expect(jointSourceFor("Offline")).toBe("local");
    expect(jointSourceFor("Sandbox")).toBe("local");
  });
});

describe("isDragEnabled", () => {
  it("disables drag in Live", () => {
    expect(isDragEnabled("Live")).toBe(false);
  });
  it("enables drag in Offline / Sync / Sandbox", () => {
    expect(isDragEnabled("Offline")).toBe(true);
    expect(isDragEnabled("Sync")).toBe(true);
    expect(isDragEnabled("Sandbox")).toBe(true);
  });
});

describe("isCommandEmitted", () => {
  it("emits commands ONLY in Sync", () => {
    expect(isCommandEmitted("Sync")).toBe(true);
    expect(isCommandEmitted("Live")).toBe(false);
    expect(isCommandEmitted("Offline")).toBe(false);
    expect(isCommandEmitted("Sandbox")).toBe(false);
  });
});

describe("needsConfirmation", () => {
  it("requires confirm only when entering Sync", () => {
    expect(needsConfirmation("Live", "Sync")).toBe(true);
    expect(needsConfirmation("Offline", "Sync")).toBe(true);
    expect(needsConfirmation("Sandbox", "Sync")).toBe(true);
    expect(needsConfirmation("Sync", "Sync")).toBe(false);
    expect(needsConfirmation("Live", "Live")).toBe(false);
    expect(needsConfirmation("Live", "Offline")).toBe(false);
  });
});

describe("sideEffectsForTransition", () => {
  const all: SimMode[] = ["Live", "Sync", "Offline", "Sandbox"];

  it("connects WS when entering Live or Sync from off-WS modes", () => {
    expect(sideEffectsForTransition("Offline", "Live")).toEqual(
      expect.arrayContaining(["connect_ws"]),
    );
    expect(sideEffectsForTransition("Sandbox", "Sync")).toEqual(
      expect.arrayContaining(["connect_ws"]),
    );
  });

  it("does not reconnect when staying within WS modes (Live <-> Sync)", () => {
    expect(sideEffectsForTransition("Live", "Sync")).not.toContain(
      "connect_ws",
    );
    expect(sideEffectsForTransition("Sync", "Live")).not.toContain(
      "connect_ws",
    );
  });

  it("disconnects WS when leaving WS modes", () => {
    expect(sideEffectsForTransition("Live", "Offline")).toEqual(
      expect.arrayContaining(["disconnect_ws"]),
    );
    expect(sideEffectsForTransition("Sync", "Sandbox")).toEqual(
      expect.arrayContaining(["disconnect_ws"]),
    );
  });

  it("snaps once when entering Offline (capture last WS state)", () => {
    expect(sideEffectsForTransition("Live", "Offline")).toEqual(
      expect.arrayContaining(["snap_once"]),
    );
  });

  it("does NOT snap when entering Sandbox", () => {
    expect(sideEffectsForTransition("Live", "Sandbox")).not.toContain(
      "snap_once",
    );
  });

  it("returns empty effects for same-mode transitions", () => {
    for (const m of all) {
      expect(sideEffectsForTransition(m, m)).toEqual([]);
    }
  });
});
