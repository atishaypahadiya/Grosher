// The eye-level camera of a hero close-up: it dollies from the overview down to ~1.6 m in the aisle, facing
// the shelf with the stop's bin in the clear band between the progress strip and the sheet (480 ms, the
// design's longest animation; a cut under reduced motion), then allows a limited look around (±35° yaw,
// ±17° pitch), a pan along the aisle inside the zone and a short dolly. No free flight. On exit it dollies
// back to the overview camera's pose and hands over.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Euler, PerspectiveCamera, Quaternion, Vector3 } from "three";
import type { HeroTargetInfo } from "./index.ts";
import type { SafeArea } from "../map3d/CameraRig.tsx";

export const EYE_HEIGHT = 1.6;
const STAND_OFF = 2.45; // metres from the bin's centre to the shopper
const EASE_MS = 480;
const YAW = 1.0; // ±57°: enough to look down the aisle, never behind
const PITCH = 0.3;
const DOLLY: [number, number] = [-0.9, 0.6];

export interface CloseUpCameraHandle {
  look: (dxPx: number, dyPx: number) => void;
  pan: (dxPx: number) => void;
  dolly: (factor: number) => void;
}

export interface CameraView {
  position: Vector3;
  quaternion: Quaternion;
  fov: number;
}

export interface CloseUpCameraProps {
  target: HeroTargetInfo;
  safe: SafeArea;
  reducedMotion?: boolean;
  exiting: boolean;
  /** the overview camera's pose to return to */
  returnView: () => CameraView;
  onExited: () => void;
  /** written while the close-up is open, for the perf readout */
  distanceRef?: { current: number };
}

/** A vertical field that shows ~60° across in landscape and a usable width in portrait, 50–75°. */
export const closeUpFov = (aspect: number) => Math.min(75, Math.max(50, (2 * Math.atan(Math.tan(Math.PI / 6) / aspect) * 180) / Math.PI));

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export const CloseUpCamera = forwardRef<CloseUpCameraHandle, CloseUpCameraProps>(function CloseUpCamera({ target, safe, reducedMotion, exiting, returnView, onExited, distanceRef }, ref) {
  const { camera, invalidate, size } = useThree();
  const cam = camera as PerspectiveCamera;
  const user = useRef({ yaw: 0, pitch: 0, pan: 0, dolly: 0 });
  const anim = useRef<{ t0: number; from: CameraView; to: () => CameraView; done?: () => void } | null>(null);
  const settled = useRef(false);

  /** the eye pose for the current target and the shopper's look / pan / dolly */
  const eye = (): CameraView => {
    const aspect = size.width / size.height;
    const fov = closeUpFov(aspect);
    const u = user.current;
    const back = STAND_OFF - u.dolly;
    const x = Math.min(target.bounds.x1, Math.max(target.bounds.x0, target.center[0] + u.pan));
    const position = new Vector3(x, EYE_HEIGHT, target.center[2] + target.facing * back);
    // aim so the bin sits in the middle of the band the strip and the sheet leave clear
    const bandMid = 1 - 2 * (safe.top + (1 - safe.top - safe.bottom) / 2); // ndc y
    const toBin = Math.atan2(target.center[1] - EYE_HEIGHT, back);
    const lift = Math.atan(bandMid * Math.tan((fov * Math.PI) / 360));
    const pitch = Math.max(-0.6, Math.min(0.4, toBin - lift + u.pitch));
    const yaw = (target.facing === 1 ? 0 : Math.PI) + u.yaw;
    const quaternion = new Quaternion().setFromEuler(new Euler(pitch, yaw, 0, "YXZ"));
    return { position, quaternion, fov };
  };

  const apply = (v: CameraView) => {
    cam.position.copy(v.position);
    cam.quaternion.copy(v.quaternion);
    if (Math.abs(cam.fov - v.fov) > 0.01) cam.fov = v.fov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    if (distanceRef) distanceRef.current = 2;
  };

  const start = (to: () => CameraView, done?: () => void) => {
    const from = { position: cam.position.clone(), quaternion: cam.quaternion.clone(), fov: cam.fov };
    if (reducedMotion) {
      apply(to());
      done?.();
      invalidate();
      return;
    }
    anim.current = { t0: performance.now(), from, to, done };
    invalidate();
  };

  // in: from wherever the overview left the camera, down to eye level
  useEffect(() => {
    cam.near = 0.05;
    cam.updateProjectionMatrix();
    settled.current = false;
    start(eye, () => (settled.current = true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.center[0], target.center[1], target.center[2], target.facing]);

  // out: back to the overview pose, then hand over
  useEffect(() => {
    if (!exiting) return;
    start(returnView, () => {
      cam.near = 0.5;
      cam.updateProjectionMatrix();
      onExited();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exiting]);

  useEffect(() => {
    if (settled.current && !anim.current) {
      apply(eye());
      invalidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height, safe.top, safe.bottom]);

  useFrame(() => {
    const a = anim.current;
    if (!a) return;
    const k = Math.min(1, (performance.now() - a.t0) / EASE_MS);
    const e = easeInOut(k);
    const to = a.to();
    apply({ position: a.from.position.clone().lerp(to.position, e), quaternion: a.from.quaternion.clone().slerp(to.quaternion, e), fov: a.from.fov + (to.fov - a.from.fov) * e });
    if (k >= 1) {
      anim.current = null;
      a.done?.();
    } else invalidate();
  });

  useImperativeHandle(ref, () => ({
    look: (dx, dy) => {
      if (anim.current) return;
      const u = user.current;
      u.yaw = Math.max(-YAW, Math.min(YAW, u.yaw - dx * 0.004));
      u.pitch = Math.max(-PITCH, Math.min(PITCH, u.pitch - dy * 0.004));
      apply(eye());
      invalidate();
    },
    pan: (dx) => {
      if (anim.current) return;
      const u = user.current;
      const along = target.facing === 1 ? -1 : 1; // screen right is +x facing the wall, −x facing the island
      u.pan = Math.max(target.bounds.x0 - target.center[0], Math.min(target.bounds.x1 - target.center[0], u.pan + along * dx * 0.006));
      apply(eye());
      invalidate();
    },
    dolly: (factor) => {
      if (anim.current) return;
      const u = user.current;
      u.dolly = Math.max(DOLLY[0], Math.min(DOLLY[1], u.dolly + Math.log(factor) * 1.2));
      apply(eye());
      invalidate();
    },
  }));

  return null;
});
