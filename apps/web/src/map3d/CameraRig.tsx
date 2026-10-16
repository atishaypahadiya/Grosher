// Camera: perspective, tilt 58° from vertical, yaw −18°, framing the current
// leg; eases 480 ms to every new framing; flattens to top-down on request.
// Gestures come from the container (see TripMap3D) through the ref API.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { easeOutCubic, MAX_DISTANCE, MIN_DISTANCE, type Framing } from "./layout.ts";

export const DEFAULT_TILT = 58;
export const DEFAULT_YAW = -18;
const YAW_RANGE = 25;
const MIN_DIST = MIN_DISTANCE;
const MAX_DIST = MAX_DISTANCE;
const EASE_MS = 480;
const H_FOV = 42; // the design's 42° is the horizontal field; three's fov is vertical

/** Vertical fov (deg) that gives a 42° horizontal field at this aspect, kept between 42° and 80°. */
export const verticalFov = (aspect: number) => Math.min(80, Math.max(42, (2 * Math.atan(Math.tan((H_FOV * Math.PI) / 360) / aspect) * 180) / Math.PI));

interface Pose {
  tx: number;
  tz: number;
  distance: number;
  tilt: number; // degrees from vertical
  yaw: number; // degrees
}

export interface CameraRigHandle {
  pan: (dxPx: number, dyPx: number) => void;
  zoom: (factor: number) => void;
  rotate: (deltaDeg: number) => void;
  /** returns the new flat state */
  flatten: (flat: boolean) => void;
}

export interface CameraRigProps {
  framing: Framing;
  flat: boolean;
  reducedMotion?: boolean;
  /** fires when pinching out past max zoom (caller may flatten) */
  onOverZoomOut?: () => void;
}

export const CameraRig = forwardRef<CameraRigHandle, CameraRigProps>(function CameraRig({ framing, flat, reducedMotion, onOverZoomOut }, ref) {
  const { camera, invalidate, size } = useThree();
  const pose = useRef<Pose>({ ...framing, tilt: flat ? 2 : DEFAULT_TILT, yaw: flat ? 0 : DEFAULT_YAW });
  const from = useRef<Pose>({ ...pose.current });
  const to = useRef<Pose>({ ...pose.current });
  const t0 = useRef<number | null>(null);

  const apply = (p: Pose) => {
    if ("fov" in camera) {
      const fov = verticalFov(size.width / size.height);
      if (Math.abs(camera.fov - fov) > 0.01) camera.fov = fov;
    }
    const tilt = (Math.max(p.tilt, 1.5) * Math.PI) / 180;
    const yaw = (p.yaw * Math.PI) / 180;
    camera.position.set(p.tx + p.distance * Math.sin(tilt) * Math.sin(yaw), p.distance * Math.cos(tilt), p.tz + p.distance * Math.sin(tilt) * Math.cos(yaw));
    camera.up.set(0, 1, 0);
    camera.lookAt(p.tx, 0, p.tz);
    camera.updateProjectionMatrix();
  };

  const animateTo = (next: Partial<Pose>) => {
    from.current = { ...pose.current };
    to.current = { ...to.current, ...next };
    t0.current = reducedMotion ? -Infinity : performance.now();
    invalidate();
  };

  // New framing (reroute / check-off) or flat toggle.
  useEffect(() => {
    animateTo({ ...framing, tilt: flat ? 2 : DEFAULT_TILT, yaw: flat ? 0 : Math.max(-YAW_RANGE + DEFAULT_YAW, Math.min(YAW_RANGE + DEFAULT_YAW, to.current.yaw)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framing.tx, framing.tz, framing.distance, flat]);

  useImperativeHandle(ref, () => ({
    pan: (dx, dy) => {
      const p = to.current;
      const unitsPerPx = (2 * p.distance * Math.tan((verticalFov(size.width / size.height) * Math.PI) / 360)) / size.height;
      const yaw = (p.yaw * Math.PI) / 180;
      // screen right = camera right; screen up = away from camera on the ground
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const mx = (-dx * rx + dy * fx) * unitsPerPx;
      const mz = (-dx * rz + dy * fz) * unitsPerPx;
      to.current = { ...p, tx: p.tx + mx, tz: p.tz + mz };
      pose.current = { ...pose.current, tx: to.current.tx, tz: to.current.tz };
      t0.current = null;
      apply(pose.current);
      invalidate();
    },
    zoom: (factor) => {
      const p = to.current;
      const d = p.distance / factor;
      if (d > MAX_DIST * 1.15 && !flat) onOverZoomOut?.();
      to.current = { ...p, distance: Math.min(MAX_DIST, Math.max(MIN_DIST, d)) };
      pose.current = { ...pose.current, distance: to.current.distance };
      t0.current = null;
      apply(pose.current);
      invalidate();
    },
    rotate: (deg) => {
      if (flat) return;
      const p = to.current;
      const yaw = Math.max(DEFAULT_YAW - YAW_RANGE, Math.min(DEFAULT_YAW + YAW_RANGE, p.yaw + deg));
      to.current = { ...p, yaw };
      pose.current = { ...pose.current, yaw };
      t0.current = null;
      apply(pose.current);
      invalidate();
    },
    flatten: (f) => animateTo({ tilt: f ? 2 : DEFAULT_TILT, yaw: f ? 0 : DEFAULT_YAW }),
  }));

  useFrame(() => {
    if (t0.current === null) return;
    const k = t0.current === -Infinity ? 1 : Math.min(1, (performance.now() - t0.current) / EASE_MS);
    const e = easeOutCubic(k);
    const a = from.current;
    const b = to.current;
    pose.current = {
      tx: a.tx + (b.tx - a.tx) * e,
      tz: a.tz + (b.tz - a.tz) * e,
      distance: a.distance + (b.distance - a.distance) * e,
      tilt: a.tilt + (b.tilt - a.tilt) * e,
      yaw: a.yaw + (b.yaw - a.yaw) * e,
    };
    apply(pose.current);
    if (k >= 1) t0.current = null;
    else invalidate();
  });

  useEffect(() => {
    apply(pose.current);
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height]);

  return null;
});
