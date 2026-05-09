import { useCallback, useEffect, useRef, useState } from "react";
import {
  type SimMode,
  isCommandEmitted,
  isDragEnabled,
  jointSourceFor,
  sideEffectsForTransition,
} from "./simModeFsm";

const COMMAND_DEBOUNCE_MS = 250;

export interface UseSimulator {
  mode: SimMode;
  setMode: (next: SimMode) => void;
  joints: number[];
  setJoints: (joints: number[]) => void;
  source: "ws" | "local";
  dragEnabled: boolean;
}

const ZEROS: number[] = [0, 0, 0, 0, 0, 0];

function makeWsUrl(robotId: string): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/api/v1/robots/ws/${robotId}`;
}

export function useSimulator(robotId: string): UseSimulator {
  const [mode, setModeState] = useState<SimMode>("Live");
  const [joints, setJointsState] = useState<number[]>(ZEROS);

  const wsRef = useRef<WebSocket | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingJointsRef = useRef<number[] | null>(null);

  const openWs = useCallback(() => {
    if (!robotId) return; // no-op while page is still loading the robot list
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) return;
    const ws = new WebSocket(makeWsUrl(robotId));
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (Array.isArray(data.joints) && data.joints.length === 6) {
          setJointsState(data.joints.map(Number));
        }
      } catch {
        // ignore malformed
      }
    };
    wsRef.current = ws;
  }, [robotId]);

  const closeWs = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  // Mount: open WS if initial mode wants one. Cleanup on unmount or robotId change.
  useEffect(() => {
    if (jointSourceFor(mode) === "ws") openWs();
    return () => {
      closeWs();
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [robotId]); // re-run only on robotId change

  const setMode = useCallback(
    (next: SimMode) => {
      setModeState((current) => {
        const effects = sideEffectsForTransition(current, next);
        for (const e of effects) {
          if (e === "connect_ws") openWs();
          else if (e === "disconnect_ws") {
            // "snap_once" is implicit: by the time we reach disconnect_ws,
            // the latest WS frame has already been applied to `joints` state.
            // Disconnecting freezes that value as the local-mode starting point.
            closeWs();
          }
        }
        return next;
      });
    },
    [openWs, closeWs],
  );

  const sendMoveDebounced = useCallback(
    (target: number[]) => {
      pendingJointsRef.current = target;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const j = pendingJointsRef.current;
        pendingJointsRef.current = null;
        debounceRef.current = null;
        if (!j) return;
        fetch(`/api/v1/robots/${robotId}/command`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cmd: "MOVE",
            params: { j1: j[0], j2: j[1], j3: j[2], j4: j[3], j5: j[4], j6: j[5] },
          }),
        }).catch(() => {
          // Drag should not fail loudly on transient network issues.
        });
      }, COMMAND_DEBOUNCE_MS);
    },
    [robotId],
  );

  const setJoints = useCallback(
    (next: number[]) => {
      if (!isDragEnabled(mode)) return; // Live = read-only
      setJointsState(next);
      if (isCommandEmitted(mode)) sendMoveDebounced(next);
    },
    [mode, sendMoveDebounced],
  );

  return {
    mode,
    setMode,
    joints,
    setJoints,
    source: jointSourceFor(mode),
    dragEnabled: isDragEnabled(mode),
  };
}
