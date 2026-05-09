import { useCallback, useEffect, useRef, useState } from "react";

const STEP_DURATION_MS = 500;

interface Keyframe {
  line: string;
  jointsBefore: number[];
  jointsAfter: number[];
  success: boolean;
  message: string;
}

interface RawStepStart {
  line: string;
  joints_before: number[];
}

interface RawStepEnd {
  line: string;
  joints_after: number[];
  success: boolean;
  message: string;
}

export interface PlaybackLogEntry {
  line: string;
  success: boolean;
  message: string;
}

export type PlaybackStatus = "idle" | "loading" | "playing" | "paused" | "done" | "error";

export interface UseScriptPlayback {
  status: PlaybackStatus;
  speed: number;
  setSpeed: (s: number) => void;
  log: PlaybackLogEntry[];
  error: string | null;
  /** Start a playback. Cancels any current one. */
  play: (robotId: string, code: string) => void;
  /** Pause an ongoing playback. */
  pause: () => void;
  /** Resume a paused playback. */
  resume: () => void;
  /** Stop and reset. */
  stop: () => void;
}

interface Props {
  /** Called with each tween joint update during playback. */
  onJoints: (jointsDeg: number[]) => void;
}

/** Cubic ease in/out. */
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function useScriptPlayback({ onJoints }: Props): UseScriptPlayback {
  const [status, setStatus] = useState<PlaybackStatus>("idle");
  const [speed, setSpeed] = useState(1);
  const [log, setLog] = useState<PlaybackLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const keyframesRef = useRef<Keyframe[]>([]);
  const indexRef = useRef(0);
  const stepStartTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const onJointsRef = useRef(onJoints);
  onJointsRef.current = onJoints;

  const cleanup = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const tick = useCallback(() => {
    rafRef.current = null;
    if (status !== "playing") return;
    const idx = indexRef.current;
    const kfs = keyframesRef.current;
    if (idx >= kfs.length) {
      setStatus("done");
      return;
    }
    const kf = kfs[idx];
    const start = stepStartTimeRef.current ?? performance.now();
    if (stepStartTimeRef.current === null) stepStartTimeRef.current = start;
    const elapsed = performance.now() - start;
    const duration = STEP_DURATION_MS / Math.max(0.01, speedRef.current);
    const t = Math.min(1, elapsed / duration);
    const eased = easeInOut(t);
    const joints = kf.jointsBefore.map(
      (b, i) => b + (kf.jointsAfter[i] - b) * eased,
    );
    onJointsRef.current(joints);

    if (t >= 1) {
      indexRef.current = idx + 1;
      stepStartTimeRef.current = null;
      setLog((prev) => [
        ...prev,
        { line: kf.line, success: kf.success, message: kf.message },
      ]);
      if (!kf.success) {
        setStatus("error");
        setError(kf.message);
        return;
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [status]);

  useEffect(() => {
    if (status === "playing" && rafRef.current === null) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [status, tick]);

  const play = useCallback(
    (robotId: string, code: string) => {
      cleanup();
      keyframesRef.current = [];
      indexRef.current = 0;
      stepStartTimeRef.current = null;
      setLog([]);
      setError(null);
      setStatus("loading");

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      (async () => {
        try {
          const res = await fetch("/api/v1/robots/run/stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ robot_id: robotId, code }),
            signal: ctrl.signal,
          });
          if (!res.ok || !res.body) {
            throw new Error(`HTTP ${res.status}`);
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let pendingStart: RawStepStart | null = null;

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split("\n\n");
            buffer = frames.pop() ?? "";
            for (const frame of frames) {
              const ev = frame
                .split("\n")
                .find((l) => l.startsWith("event:"))
                ?.slice("event:".length)
                .trim();
              const data = frame
                .split("\n")
                .find((l) => l.startsWith("data:"))
                ?.slice("data:".length)
                .trim();
              if (!ev || !data) continue;
              const parsed = JSON.parse(data);
              if (ev === "step_start") {
                pendingStart = parsed as RawStepStart;
              } else if (ev === "step_end" && pendingStart) {
                const end = parsed as RawStepEnd;
                keyframesRef.current.push({
                  line: end.line,
                  jointsBefore: pendingStart.joints_before,
                  jointsAfter: end.joints_after,
                  success: end.success,
                  message: end.message,
                });
                pendingStart = null;
                if (status !== "playing") setStatus("playing");
              } else if (ev === "error") {
                setError(parsed.detail ?? "stream error");
                setStatus("error");
                return;
              }
            }
          }
          if (keyframesRef.current.length === 0) setStatus("done");
        } catch (e: unknown) {
          if ((e as { name?: string })?.name === "AbortError") return;
          setError((e as { message?: string })?.message ?? String(e));
          setStatus("error");
        }
      })();
    },
    [cleanup, status],
  );

  const pause = useCallback(() => {
    if (status === "playing") {
      const start = stepStartTimeRef.current;
      if (start !== null) {
        const elapsed = performance.now() - start;
        stepStartTimeRef.current = -elapsed;
      }
      setStatus("paused");
    }
  }, [status]);

  const resume = useCallback(() => {
    if (status === "paused") {
      const stored = stepStartTimeRef.current;
      if (stored !== null && stored < 0) {
        stepStartTimeRef.current = performance.now() + stored;
      }
      setStatus("playing");
    }
  }, [status]);

  const stop = useCallback(() => {
    cleanup();
    keyframesRef.current = [];
    indexRef.current = 0;
    stepStartTimeRef.current = null;
    setStatus("idle");
    setLog([]);
    setError(null);
  }, [cleanup]);

  return { status, speed, setSpeed, log, error, play, pause, resume, stop };
}
