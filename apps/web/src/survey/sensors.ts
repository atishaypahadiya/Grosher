// The phone's motion and compass for survey mode. iOS asks permission for both, and only inside a tap:
// requestSensors() must run in the click handler that starts a walk. Elsewhere the events just arrive (or
// never do: a desktop, a phone that blocks them). The step detector and heading maths are in steps.ts.

import { headingOf, StepDetector } from "./steps.ts";

type PermissionAPI = { requestPermission?: () => Promise<"granted" | "denied" | "default"> };

/** In a tap: ask for motion and orientation where the browser wants asking. Never throws. */
export async function requestSensors(): Promise<{ motion: boolean; orientation: boolean }> {
  const ask = async (api: PermissionAPI | undefined) => {
    if (!api?.requestPermission) return !!api;
    try {
      return (await api.requestPermission()) === "granted";
    } catch {
      return false;
    }
  };
  const M = typeof DeviceMotionEvent === "undefined" ? undefined : (DeviceMotionEvent as unknown as PermissionAPI);
  const O = typeof DeviceOrientationEvent === "undefined" ? undefined : (DeviceOrientationEvent as unknown as PermissionAPI);
  const [motion, orientation] = await Promise.all([ask(M), ask(O)]);
  return { motion, orientation };
}

export interface SensorStream {
  /** steps detected since start (ms epoch each) */
  readonly detector: StepDetector;
  /** the latest compass heading, or null */
  heading(): number | null;
  /** any accelerometer sample at all since start (a desktop never sends one) */
  hasMotion(): boolean;
  /** raw samples since start, for a calibration walk's trace */
  trace(): { t: number[]; x: number[]; y: number[]; z: number[] };
  stop(): void;
}

/**
 * Listen to the accelerometer and the compass. `onStep(t)` for each step, `onHeading(t, deg)` at most twice
 * a second. Times are Date.now(), so a survey's steps and taps share one clock.
 */
export function startSensors(o: { onStep?: (t: number) => void; onHeading?: (t: number, deg: number) => void; keepTrace?: boolean } = {}): SensorStream {
  const detector = new StepDetector();
  let heading: number | null = null;
  let lastHeadingAt = 0;
  let motionSeen = false;
  const t0 = Date.now();
  const raw = { t: [] as number[], x: [] as number[], y: [] as number[], z: [] as number[] };
  const onMotion = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    motionSeen = true;
    const t = Date.now();
    if (o.keepTrace) {
      raw.t.push(t - t0);
      raw.x.push(+a.x.toFixed(3));
      raw.y.push(+a.y.toFixed(3));
      raw.z.push(+a.z.toFixed(3));
    }
    const step = detector.push(t, a.x, a.y, a.z);
    if (step !== null) o.onStep?.(step);
  };
  const onOrientation = (e: DeviceOrientationEvent) => {
    const h = headingOf(e as DeviceOrientationEvent & { webkitCompassHeading?: number });
    if (h === null) return;
    heading = h;
    const t = Date.now();
    if (t - lastHeadingAt >= 500) {
      lastHeadingAt = t;
      o.onHeading?.(t, Math.round(h * 10) / 10);
    }
  };
  window.addEventListener("devicemotion", onMotion);
  // Chrome on Android: absolute (compass) alpha comes on its own event; iOS: webkitCompassHeading on this one
  window.addEventListener("deviceorientationabsolute", onOrientation as EventListener);
  window.addEventListener("deviceorientation", onOrientation);
  return {
    detector,
    heading: () => heading,
    hasMotion: () => motionSeen,
    trace: () => raw,
    stop() {
      window.removeEventListener("devicemotion", onMotion);
      window.removeEventListener("deviceorientationabsolute", onOrientation as EventListener);
      window.removeEventListener("deviceorientation", onOrientation);
    },
  };
}
