// Step detection from the accelerometer, and heading arithmetic. Pure: survey/sensors.ts feeds the browser's
// events in, test/fixtures/motion/*.json feed recorded traces in.
//
// Steps: the magnitude of accelerationIncludingGravity (so the phone's orientation does not matter),
// low-passed at ~LOW_PASS_HZ, minus a slow baseline (gravity, BASELINE_HZ). A candidate is a local maximum
// of that signal above an adaptive threshold (a fraction of the recent step peaks, never under a floor that
// rises with the sensor's noise: NOISE_FACTOR × the RMS of what the low-pass removed), at
// least 250 ms (and 60% of the recent step interval) after the last one, once the signal has dropped back under the baseline since (one per
// stride bounce, however noisy its top). Walking has a rhythm, fidgets do not: a candidate counts only with
// a neighbour within MAX_STEP_GAP_MS (the first of a walk counts when the second arrives), so a lone bump
// while standing never becomes a step.

export const MIN_STEP_GAP_MS = 250;
export const MAX_STEP_GAP_MS = 1500;
/** m/s²: the floor under the adaptive threshold (a cart damps the bounce to ~0.5) */
export const MIN_THRESHOLD = 0.3;
/** the threshold follows the steps: this fraction of the running mean step peak */
export const PEAK_FRACTION = 0.4;
export const LOW_PASS_HZ = 4;
/** the floor is at least this many times the high-frequency noise (RMS of the sample minus the low-pass) */
export const NOISE_FACTOR = 1.6;
export const BASELINE_HZ = 0.4;

const lowPassAlpha = (dtMs: number, cutoffHz: number) => {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = Math.max(1, dtMs) / 1000;
  return dt / (rc + dt);
};

export class StepDetector {
  count = 0;
  /** the last sample's filtered signal (m/s² above the baseline), for a live readout */
  signal = 0;
  private lp: number | null = null;
  private base: number | null = null;
  private lastT: number | null = null;
  private prev = 0;
  private prev2 = 0;
  private prevT = 0;
  private lastStep = -Infinity;
  private armed = true;
  private peakMean = 0;
  /** the last candidate, and whether it was counted */
  private lastCand = -Infinity;
  private lastCandCounted = false;
  /** running mean of the interval between counted steps, ms */
  private interval = 0;
  /** running mean square of the high-frequency part (sensor noise), (m/s²)² */
  private noise2 = 0;
  readonly steps: number[] = [];

  /** One accelerometer sample (ms, m/s² per axis). Returns the step's time when this sample completes one. */
  push(t: number, x: number, y: number, z: number): number | null {
    const mag = Math.hypot(x, y, z);
    if (!Number.isFinite(mag)) return null;
    const dt = this.lastT === null ? 16 : t - this.lastT;
    this.lastT = t;
    if (this.lp === null || this.base === null) {
      this.lp = mag;
      this.base = mag;
      return null;
    }
    if (dt <= 0) return null;
    this.lp += lowPassAlpha(dt, LOW_PASS_HZ) * (mag - this.lp);
    this.noise2 += lowPassAlpha(dt, 0.5) * ((mag - this.lp) ** 2 - this.noise2);
    this.base += lowPassAlpha(dt, BASELINE_HZ) * (this.lp - this.base);
    const s = this.lp - this.base;
    let step: number | null = null;
    // the previous sample was a peak
    if (this.prev > this.prev2 && this.prev >= s) {
      const threshold = Math.max(MIN_THRESHOLD, NOISE_FACTOR * Math.sqrt(this.noise2), PEAK_FRACTION * this.peakMean);
      const gap = Math.max(MIN_STEP_GAP_MS, 0.6 * this.interval);
      if (this.armed && this.prev > threshold && this.prevT - this.lastStep >= gap) {
        this.armed = false;
        this.lastStep = this.prevT;
        if (this.prevT - this.lastCand <= MAX_STEP_GAP_MS) {
          // in rhythm: this one counts, and the one before it if it was waiting for a partner
          if (!this.lastCandCounted) this.record(this.lastCand);
          const d = this.prevT - this.lastCand;
          this.interval = this.interval === 0 ? d : this.interval * 0.7 + d * 0.3;
          this.record(this.prevT);
          step = this.prevT;
          this.lastCandCounted = true;
          this.peakMean = this.peakMean === 0 ? this.prev : this.peakMean * 0.8 + this.prev * 0.2;
        } else {
          // a new walk: its cadence is learnt again
          this.lastCandCounted = false;
          this.interval = 0;
        }
        this.lastCand = this.prevT;
      }
    }
    if (s < 0) this.armed = true;
    this.prev2 = this.prev;
    this.prev = s;
    this.prevT = t;
    this.signal = s;
    return step;
  }

  private record(t: number) {
    this.count++;
    this.steps.push(t);
  }
}

/** Count the steps in a recorded trace (fixtures, a calibration walk's raw samples). */
export function countSteps(trace: MotionTrace): number[] {
  const d = new StepDetector();
  for (let i = 0; i < trace.t.length; i++) d.push(trace.t[i], trace.x[i], trace.y[i], trace.z[i]);
  return d.steps;
}

/** Raw accelerometer samples: ms from the start, m/s² per axis (accelerationIncludingGravity). */
export interface MotionTrace {
  t: number[];
  x: number[];
  y: number[];
  z: number[];
}

// ---------------------------------------------------------------- headings (degrees clockwise from north)

export const norm360 = (d: number) => ((d % 360) + 360) % 360;
/** the signed difference a − b in (−180, 180] */
export const angleDiff = (a: number, b: number) => {
  const d = norm360(a - b);
  return d > 180 ? d - 360 : d;
};

/** The mean of angles (a plain average of 350° and 10° is 180°, not 0°). Null for none. */
export function circularMean(degs: number[]): number | null {
  if (!degs.length) return null;
  let sx = 0;
  let sy = 0;
  for (const d of degs) {
    sx += Math.cos((d * Math.PI) / 180);
    sy += Math.sin((d * Math.PI) / 180);
  }
  if (Math.hypot(sx, sy) < 1e-9) return null;
  return norm360((Math.atan2(sy, sx) * 180) / Math.PI);
}

/** The heading from a DeviceOrientationEvent: iOS gives a compass heading; elsewhere an absolute alpha. */
export function headingOf(e: { webkitCompassHeading?: number | null; alpha: number | null; absolute?: boolean }): number | null {
  if (typeof e.webkitCompassHeading === "number" && Number.isFinite(e.webkitCompassHeading)) return norm360(e.webkitCompassHeading);
  if (e.absolute && typeof e.alpha === "number") return norm360(360 - e.alpha);
  return null;
}
