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

export const DEFAULT_TILT = 58;
export const DEFAULT_YAW = -18;
const YAW_RANGE = 25;
const MIN_DIST = MIN_DISTANCE;
export const MIN_DISTANCE_PINCH = MIN_DISTANCE;
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

/** Minimum visible store width across the frame, metres. The camera is never closer than this needs. */
export const MIN_SPAN_M = 30;
/** Camera distance at which the 42° horizontal field shows MIN_SPAN_M metres. */
export const minFramingDistance = () => MIN_SPAN_M / (2 * Math.tan((H_FOV * Math.PI) / 360));

interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}
const boxOf = (qs: { x: number; y: number }[]): Box => ({
  minX: Math.min(...qs.map((q) => q.x)),
  maxX: Math.max(...qs.map((q) => q.x)),
  minY: Math.min(...qs.map((q) => q.y)),
  maxY: Math.max(...qs.map((q) => q.y)),
});

/**
 * Solve the framing in screen space on a scratch camera.
 *  - fit: the leg's path plus the next stop, padded 15%, inside the map area
 *    between the header strip and the bottom sheet; next stop at that area's
 *    upper third, the distance grows until the you-dot reaches its lower third
 *    when the leg has the depth; never closer than a 30 m visible span.
 *  - slide: toward the store footprint within the slack the rule leaves, in
 *    both directions, so neither empty floor nor sky is kept for nothing.
 *  - hard constraints: both endpoints (you, next) end inside the padded area;
 *    if no shift can satisfy that, the distance grows and it solves again.
 * Same rule when flat.
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
  const padY = (height * PAD) / 2;
  const availY = height - 2 * padY;
  const availX = 2 * (1 - PAD);
  const xLo = -1 + PAD;
  const xHi = 1 - PAD;
  const yLo = ndcBot + padY;
  const yHi = ndcTop - padY;

  const pts = [focus.you, ...(focus.next ? [focus.next] : []), ...(focus.points ?? [])];
  const ends = focus.next ? [focus.you, focus.next] : [focus.you];
  const minD = minFramingDistance();
  let tx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  let tz = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  let distance = minD;
  const groundPerNdc = () => (distance * Math.tan((fov * Math.PI) / 360)) / (flat ? 1 : Math.sin((tilt * Math.PI) / 180));
  const place = () => placeCamera(cam, { tx, tz, distance, tilt, yaw: yawDeg });
  /** move the content by (sx, sy) ndc: the target moves the other way along the screen axes */
  const shiftContent = (sx: number, sy: number) => {
    const g = groundPerNdc();
    tx -= f.x * sy * g + r.x * sx * g * aspect;
    tz -= f.z * sy * g + r.z * sx * g * aspect;
  };

  for (let attempt = 0; attempt < 6; attempt++) {
    // ---- fit
    for (let i = 0; i < 10; i++) {
      place();
      const box = boxOf(pts.map(ndc));
      const you = ndc(focus.you);
      const next = focus.next ? ndc(focus.next) : null;
      let ratio = Math.max((box.maxX - box.minX) / availX, (box.maxY - box.minY) / availY);
      if (next) ratio = Math.max(ratio, (next.y - you.y) / (yNext - yYou));
      if (ratio > 1.001) distance = Math.min(MAX_DISTANCE, distance * ratio);
      else if (ratio < 0.9 && distance > minD) distance = Math.max(minD, distance * Math.max(ratio, 0.6));
      place();
      const box2 = boxOf(pts.map(ndc));
      const you2 = ndc(focus.you);
      const next2 = focus.next ? ndc(focus.next) : null;
      let errY = next2 ? next2.y - yNext : you2.y - (ndcTop + ndcBot) / 2;
      if (box2.minY - errY < yLo) errY -= yLo - (box2.minY - errY);
      if (box2.maxY - errY > yHi) errY += box2.maxY - errY - yHi;
      shiftContent(-(box2.minX + box2.maxX) / 2, -errY);
    }

    // ---- slide toward the store footprint within the slack
    if (focus.footprint) {
      place();
      const { x, z, w, d } = focus.footprint;
      const fb = boxOf(
        [
          { x: x - w / 2, y: z - d / 2 },
          { x: x + w / 2, y: z - d / 2 },
          { x: x + w / 2, y: z + d / 2 },
          { x: x - w / 2, y: z + d / 2 },
        ].map(ndc),
      );
      const lb = boxOf(pts.map(ndc));
      const nextY = focus.next ? ndc(focus.next).y : null;
      let sx = 0;
      if (fb.minX > -1) sx = -(fb.minX + 1);
      else if (fb.maxX < 1) sx = 1 - fb.maxX;
      // sky above the store is closed first (content up), else empty floor below it (content down)
      let sy = 0;
      if (fb.maxY < ndcTop) sy = ndcTop - fb.maxY;
      else if (fb.minY > ndcBot) sy = ndcBot - fb.minY;
      sx = Math.max(xLo - lb.minX, Math.min(xHi - lb.maxX, sx));
      let syMin = yLo - lb.minY;
      let syMax = yHi - lb.maxY;
      if (nextY !== null) {
        syMin = Math.max(syMin, yNext - third / 2 - nextY);
        syMax = Math.min(syMax, yNext + third / 2 - nextY);
      }
      if (syMin <= syMax) sy = Math.max(syMin, Math.min(syMax, sy));
      else sy = 0;
      shiftContent(sx, sy);
    }

    // ---- hard constraints on the endpoints: shift if possible, else zoom out and solve again
    let ok = false;
    for (let k = 0; k < 4; k++) {
      place();
      const qs = ends.map(ndc);
      const sxLo = Math.max(...qs.map((q) => xLo - q.x));
      const sxHi = Math.min(...qs.map((q) => xHi - q.x));
      const syLo = Math.max(...qs.map((q) => yLo - q.y));
      const syHi = Math.min(...qs.map((q) => yHi - q.y));
      if (sxLo > sxHi + 1e-6 || syLo > syHi + 1e-6) break; // cannot fit at this distance
      const sx = Math.max(sxLo, Math.min(sxHi, 0));
      const sy = Math.max(syLo, Math.min(syHi, 0));
      if (Math.abs(sx) < 1e-4 && Math.abs(sy) < 1e-4) {
        ok = true;
        break;
      }
      shiftContent(sx, sy);
    }
    if (ok || distance >= MAX_DISTANCE) break;
    distance = Math.min(MAX_DISTANCE, distance * 1.15);
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
  /** written every frame with the current camera distance (metres) */
  distanceRef?: { current: number };
  flat: boolean;
  reducedMotion?: boolean;
  /** fires when pinching out past max zoom (caller may flatten) */
  onOverZoomOut?: () => void;
}

export const CameraRig = forwardRef<CameraRigHandle, CameraRigProps>(function CameraRig({ focus, safe = DEFAULT_SAFE, distanceRef, flat, reducedMotion, onOverZoomOut }, ref) {
  const { camera, invalidate, size } = useThree();
  const initial = solveFraming(focus, flat, size.width / size.height, undefined, safe);
  const pose = useRef<Pose>({ ...initial, tilt: flat ? 2 : DEFAULT_TILT, yaw: flat ? 0 : DEFAULT_YAW });
  const from = useRef<Pose>({ ...pose.current });
  const to = useRef<Pose>({ ...pose.current });
  const t0 = useRef<number | null>(null);

  const apply = (p: Pose) => {
    if (distanceRef) distanceRef.current = p.distance;
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
