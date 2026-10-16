// Camera: perspective, tilt 58° from vertical, yaw −18°, framing the current
// leg; eases 480 ms to every new framing; flattens to top-down on request.
// Gestures come from the container (see TripMap3D) through the ref API.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera, Vector3 } from "three";
import { easeOutCubic, MAX_DISTANCE, MIN_DISTANCE, type Framing } from "./layout.ts";

/** What the camera should frame: the shopper, the next stop if any, and the current leg's path. */
export interface Focus {
  you: { x: number; y: number };
  next?: { x: number; y: number };
  points?: { x: number; y: number }[];
  /** the store footprint; the view slides toward it so a short leg does not leave empty floor around a corner */
  footprint?: { x: number; z: number; w: number; d: number };
}
/** The part of the viewport the map may use, as fractions of height from the top and from the bottom. */
export interface SafeArea {
  top: number;
  bottom: number;
}
export const DEFAULT_SAFE: SafeArea = { top: 0.16, bottom: 0.36 };
const MIN_FRAME = 36;

export const DEFAULT_TILT = 58;
export const DEFAULT_YAW = -18;
const YAW_RANGE = 25;
const MIN_DIST = MIN_DISTANCE;
const MAX_DIST = MAX_DISTANCE;
const EASE_MS = 480;
const H_FOV = 42; // the design's 42° is the horizontal field; three's fov is vertical

/** Vertical fov (deg) that gives a 42° horizontal field at this aspect, kept between 42° and 80°. */
export const verticalFov = (aspect: number) => Math.min(80, Math.max(42, (2 * Math.atan(Math.tan((H_FOV * Math.PI) / 360) / aspect) * 180) / Math.PI));

function placeCamera(cam: PerspectiveCamera, p: { tx: number; tz: number; distance: number; tilt: number; yaw: number }) {
  const tilt = (Math.max(p.tilt, 1.5) * Math.PI) / 180;
  const yaw = (p.yaw * Math.PI) / 180;
  cam.position.set(p.tx + p.distance * Math.sin(tilt) * Math.sin(yaw), p.distance * Math.cos(tilt), p.tz + p.distance * Math.sin(tilt) * Math.cos(yaw));
  cam.up.set(0, 1, 0);
  cam.lookAt(p.tx, 0, p.tz);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
}

/**
 * Solve the framing in screen space on a scratch camera: fit the leg (you,
 * the path, the next stop) padded 15% into the safe area between the header
 * strip and the bottom sheet; pin the next stop at that area's upper third
 * and let the distance grow until the you-dot reaches its lower third when
 * the leg has that depth. Never closer than 36 m. Same rule when flat.
 */
export function solveFraming(focus: Focus, flat: boolean, aspect: number, yawDeg = flat ? 0 : DEFAULT_YAW, safe: SafeArea = DEFAULT_SAFE): Framing {
  const fov = verticalFov(aspect);
  const tilt = flat ? 2 : DEFAULT_TILT;
  const cam = new PerspectiveCamera(fov, aspect, 0.5, 400);
  const v = new Vector3();
  const ndc = (p: { x: number; y: number }) => v.set(p.x, 0.6, p.y).project(cam).clone();
  const yawRad = (yawDeg * Math.PI) / 180;
  const f = { x: -Math.sin(yawRad), z: -Math.cos(yawRad) }; // screen-up along the ground
  const r = { x: Math.cos(yawRad), z: -Math.sin(yawRad) }; // screen-right along the ground

  const ndcTop = 1 - 2 * safe.top;
  const ndcBot = -1 + 2 * safe.bottom;
  const height = ndcTop - ndcBot;
  const third = height / 3;
  const yNext = ndcTop - third;
  const yYou = ndcBot + third;
  const PAD = 0.15;
  const availY = height * (1 - PAD);
  const availX = 2 * (1 - PAD);
  const padY = (height * PAD) / 2;

  const pts = [focus.you, ...(focus.next ? [focus.next] : []), ...(focus.points ?? [])];
  let tx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  let tz = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  let distance = MIN_FRAME;
  const groundPerNdc = () => (distance * Math.tan((fov * Math.PI) / 360)) / (flat ? 1 : Math.sin((tilt * Math.PI) / 180));

  for (let i = 0; i < 12; i++) {
    placeCamera(cam, { tx, tz, distance, tilt, yaw: yawDeg });
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      const q = ndc(p);
      minX = Math.min(minX, q.x);
      maxX = Math.max(maxX, q.x);
      minY = Math.min(minY, q.y);
      maxY = Math.max(maxY, q.y);
    }
    const you = ndc(focus.you);
    const next = focus.next ? ndc(focus.next) : null;
    // distance: grow until the padded box and the next/you spread fit; shrink toward the fit but never below the floor
    let ratio = Math.max((maxX - minX) / availX, (maxY - minY) / availY);
    if (next) ratio = Math.max(ratio, (next.y - you.y) / (yNext - yYou));
    if (ratio > 1.001) distance = Math.min(MAX_DISTANCE, distance * ratio);
    else if (ratio < 0.9 && distance > MIN_FRAME) distance = Math.max(MIN_FRAME, distance * Math.max(ratio, 0.6));
    placeCamera(cam, { tx, tz, distance, tilt, yaw: yawDeg });
    minX = Infinity;
    maxX = -Infinity;
    minY = Infinity;
    maxY = -Infinity;
    for (const p of pts) {
      const q = ndc(p);
      minX = Math.min(minX, q.x);
      maxX = Math.max(maxX, q.x);
      minY = Math.min(minY, q.y);
      maxY = Math.max(maxY, q.y);
    }
    const you2 = ndc(focus.you);
    const next2 = focus.next ? ndc(focus.next) : null;
    // vertical: next stop at the upper third (alone: you at the area's centre), then keep the box inside the area
    let errY = next2 ? next2.y - yNext : you2.y - (ndcTop + ndcBot) / 2;
    if (minY - errY < ndcBot + padY) errY -= ndcBot + padY - (minY - errY);
    if (maxY - errY > ndcTop - padY) errY += maxY - errY - (ndcTop - padY);
    const errX = (minX + maxX) / 2;
    const g = groundPerNdc();
    tx += f.x * errY * g + r.x * errX * g * aspect;
    tz += f.z * errY * g + r.z * errX * g * aspect;
  }

  // Slide toward the store footprint within the slack the leg rule leaves:
  // the next stop may sit anywhere in the upper third, the box must stay in the area.
  if (focus.footprint) {
    placeCamera(cam, { tx, tz, distance, tilt, yaw: yawDeg });
    const { x, z, w, d } = focus.footprint;
    const corners = [
      { x: x - w / 2, y: z - d / 2 },
      { x: x + w / 2, y: z - d / 2 },
      { x: x + w / 2, y: z + d / 2 },
      { x: x - w / 2, y: z + d / 2 },
    ].map((p) => ndc(p));
    const fx0 = Math.min(...corners.map((c) => c.x));
    const fx1 = Math.max(...corners.map((c) => c.x));
    const fy0 = Math.min(...corners.map((c) => c.y));
    const leg = pts.map((p) => ndc(p));
    const lx0 = Math.min(...leg.map((q) => q.x));
    const lx1 = Math.max(...leg.map((q) => q.x));
    const ly0 = Math.min(...leg.map((q) => q.y));
    const ly1 = Math.max(...leg.map((q) => q.y));
    const nextY = focus.next ? ndc(focus.next).y : null;
    // wanted content shift (ndc): close empty strips between the footprint and the view / area edges
    let sx = 0;
    if (fx0 > -1) sx = -(fx0 + 1); // empty strip on the left: move content left
    else if (fx1 < 1) sx = 1 - fx1; // empty strip on the right: move content right
    // vertical: only close empty floor below the store (never trade sky for the leg's position)
    let sy = 0;
    if (fy0 > ndcBot) sy = ndcBot - fy0;
    // clamp to the slack
    const sxMin = -1 + PAD - lx0; // content may move left until the leg touches the padded left edge
    const sxMax = 1 - PAD - lx1;
    sx = Math.max(sxMin, Math.min(sxMax, sx));
    let syMin = ndcBot + padY - ly0;
    let syMax = ndcTop - padY - ly1;
    if (nextY !== null) {
      // the next stop stays inside the upper third band
      syMin = Math.max(syMin, yNext - third / 2 - nextY);
      syMax = Math.min(syMax, yNext + third / 2 - nextY);
    }
    sy = Math.max(syMin, Math.min(syMax, sy));
    const g = groundPerNdc();
    // moving content by +s means moving the target by −s along the screen axes
    tx += -(f.x * sy * g + r.x * sx * g * aspect);
    tz += -(f.z * sy * g + r.z * sx * g * aspect);
  }
  return { tx, tz, distance };
}

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
  focus: Focus;
  safe?: SafeArea;
  flat: boolean;
  reducedMotion?: boolean;
  /** fires when pinching out past max zoom (caller may flatten) */
  onOverZoomOut?: () => void;
}

export const CameraRig = forwardRef<CameraRigHandle, CameraRigProps>(function CameraRig({ focus, safe = DEFAULT_SAFE, flat, reducedMotion, onOverZoomOut }, ref) {
  const { camera, invalidate, size } = useThree();
  const initial = solveFraming(focus, flat, size.width / size.height, undefined, safe);
  const pose = useRef<Pose>({ ...initial, tilt: flat ? 2 : DEFAULT_TILT, yaw: flat ? 0 : DEFAULT_YAW });
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

  // New focus (reroute / check-off), flat toggle or resize: re-solve and ease there.
  useEffect(() => {
    const yaw = flat ? 0 : Math.max(-YAW_RANGE + DEFAULT_YAW, Math.min(YAW_RANGE + DEFAULT_YAW, to.current.yaw));
    const framing = solveFraming(focus, flat, size.width / size.height, yaw, safe);
    animateTo({ ...framing, tilt: flat ? 2 : DEFAULT_TILT, yaw });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus.you.x, focus.you.y, focus.next?.x, focus.next?.y, focus.points?.length, flat, size.width, size.height, safe.top, safe.bottom]);

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
