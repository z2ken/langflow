export type SimMode = "Offline" | "Live" | "Sync" | "Sandbox";

export type JointSource = "ws" | "local";

export type SideEffect =
  | "connect_ws"
  | "disconnect_ws"
  | "snap_once"
  | "show_sync_confirm";

const WS_MODES = new Set<SimMode>(["Live", "Sync"]);

export function jointSourceFor(mode: SimMode): JointSource {
  return WS_MODES.has(mode) ? "ws" : "local";
}

export function isDragEnabled(mode: SimMode): boolean {
  return mode !== "Live";
}

export function isCommandEmitted(mode: SimMode): boolean {
  return mode === "Sync";
}

export function needsConfirmation(from: SimMode, to: SimMode): boolean {
  return to === "Sync" && from !== "Sync";
}

export function sideEffectsForTransition(
  from: SimMode,
  to: SimMode,
): SideEffect[] {
  if (from === to) return [];

  const effects: SideEffect[] = [];
  const fromOnWs = WS_MODES.has(from);
  const toOnWs = WS_MODES.has(to);

  // Snap to current WS joints once before disconnecting (Offline only;
  // Sandbox keeps whatever the user was already looking at).
  if (fromOnWs && to === "Offline") {
    effects.push("snap_once");
  }

  if (!fromOnWs && toOnWs) effects.push("connect_ws");
  if (fromOnWs && !toOnWs) effects.push("disconnect_ws");

  return effects;
}
