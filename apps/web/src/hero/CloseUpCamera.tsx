// The eye-level camera of a close-up (hero or standard). The way in has two moves: it descends from the
// overview over the walkway outside the zone (a curve that stays out over the store, never above a hero
// zone's ceiling) to eye level at the aisle's open end, then walks in down the aisle's walking line and across
// to stand a couple of metres from the stop's slot, turning to face it, with a slight head bob (1.0 s down,
// then a walk of 1.2–1.5 s by its length, each eased in and out: DESIGN.md §7's one exception, a scene
// transition; a tap skips to the end; a cut under reduced motion). The slot is framed in the clear band
// between the progress strip and the bottom card; for a low shelf the shopper crouches (the eye comes down to
// 1.05 m) and looks down, so the card never hides it. At eye level it allows a limited look around (±57° yaw,
// ±17° pitch), a pan along the shelf and a dolly down to arm's length. No free flight. On exit it walks back
// out and rises to the overview camera's pose in 0.8 s, and hands over.
//
// `envRef` carries how far the scene is into the close-up (0 overview … 1 eye level), from the camera's
// height: the fog, the background, the overview's lights and fixtures blend on it (Scene.tsx).

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Euler, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from "three";
import type { HeroTargetInfo } from "./index.ts";
import type { SafeArea } from "../map3d/CameraRig.tsx";

export const EYE_HEIGHT = 1.6;
/** the lowest the eye comes for a bottom shelf: a crouch */
export const CROUCH_HEIGHT = 1.05;
export const DESCENT_MS = 1000;
/** the way back out: the walk back to the door, then the rise to the map */
export const EXIT_WALK_MS = 300;
export const EXIT_RISE_MS = 500;
/** the bottom card covers about this much of the screen in a close-up: the slot stays above it */
export const CARD_MIN = 0.4;
const ARM = 0.7; // the closest the dolly comes: arm's length from the bin's centre
const YAW = 1.0; // ±57°: enough to look down the aisle, never behind
const PITCH = 0.3;
const BOB = 0.012; // metres, a step's rise and fall

/** the walk's duration for its length: a stroll, 1.2–1.5 s */
export const walkMs = (metres: number) => Math.round(Math.min(1500, Math.max(1200, 1050 + metres * 90)));
/** the eye's height for a slot centred at y: standing, or crouched for the low shelves */
export const eyeHeightFor = (y: number) => Math.min(EYE_HEIGHT, Math.max(CROUCH_HEIGHT, y + 0.75));

export interface CloseUpCameraHandle {
  look: (dxPx: number, dyPx: number) => void;
  pan: (dxPx: number) => void;
  dolly: (factor: number) => void;
  /** jump to the end of the move in progress (a tap during the arrival or the way out); false if none */
  skip: () => boolean;
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
  /** 0 overview … 1 eye level: how far the scene is into the close-up */
  envRef?: { current: number };
}

/** A vertical field that shows ~60° across in landscape and a usable width in portrait, 50–75°. */
export const closeUpFov = (aspect: number) => Math.min(75, Math.max(50, (2 * Math.atan(Math.tan(Math.PI / 6) / aspect) * 180) / Math.PI));

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
/** the arrival's two moves: soft at both ends, never a lurch */
const easeSine = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);

/**
 * Two moves as one motion: a single ease in and out over both, each move taking its share of the way by its
 * own duration, so the camera never stops at the door between them (it slows only at the two ends).
 */
const chain = (a: Segment, b: Segment): Segment => {
  const f = a.ms / (a.ms + b.ms);
  return {
    ms: a.ms + b.ms,
    ease: easeSine,
    at: (g, t) => (g < f ? a.at(g / f, t) : b.at((g - f) / (1 - f), t)),
  };
};

/** the environment blend for a camera height: overview above 9 m, the close-up at 2.2 m and below */
export const envAt = (y: number) => {
  const t = Math.max(0, Math.min(1, (9 - y) / (9 - 2.2)));
  return t * t * (3 - 2 * t);
};

/** a pose looking from `from` toward `to`, level */
const lookPose = (from: Vector3, to: Vector3, fov: number): CameraView => {
  const yaw = Math.atan2(-(to.x - from.x), -(to.z - from.z));
  return { position: from.clone(), quaternion: new Quaternion().setFromEuler(new Euler(-0.04, yaw, 0, "YXZ")), fov };
};
const UP = new Vector3(0, 1, 0);
/** the camera's orientation looking from `from` at `at` (no roll) */
const aim = (from: Vector3, at: Vector3) => new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(from, at, UP));
/** where a pose's view meets the floor (or a point 30 m out, when it looks above the horizon) */
const groundOf = (v: CameraView) => {
  const f = new Vector3(0, 0, -1).applyQuaternion(v.quaternion);
  return f.y < -0.05 ? v.position.clone().addScaledVector(f, -v.position.y / f.y) : v.position.clone().addScaledVector(f, 30);
};

interface Segment {
  ms: number;
  /** the pose at eased progress e (0–1) and raw progress t */
  at: (e: number, t: number) => CameraView;
  ease: (t: number) => number;
}

/**
 * Where the eye is and where it looks, for a target, the shopper's look / pan / dolly and the screen: standing
 * (crouched for a low slot) `stand` metres out from it (a step to the side when the target says), turned to it,
 * pitched so the slot sits in the middle of the band the progress strip and the bottom card leave clear.
 */
export function eyePose(target: HeroTargetInfo, u: { yaw: number; pitch: number; pan: number; dolly: number }, safe: SafeArea, aspect: number): CameraView {
  const out = target.out ?? [0, target.facing];
  const axis = target.axis ?? [1, 0];
  const fov = closeUpFov(aspect);
  const back = target.stand - u.dolly;
  const c = target.center;
  const along0 = c[0] * axis[0] + c[2] * axis[1];
  const along = Math.min(target.bounds.x1, Math.max(target.bounds.x0, along0 + u.pan)) - along0;
  const y = eyeHeightFor(c[1]);
  const side = target.side ?? 0;
  const position = new Vector3(c[0] + out[0] * back + axis[0] * (along + side), y, c[2] + out[1] * back + axis[1] * (along + side));
  const bottom = Math.max(safe.bottom, CARD_MIN);
  const bandMid = 1 - 2 * (safe.top + (1 - safe.top - bottom) / 2); // ndc y
  const toBin = Math.atan2(c[1] - y, Math.hypot(back, side));
  const lift = Math.atan(bandMid * Math.tan((fov * Math.PI) / 360));
  const pitch = Math.max(-0.85, Math.min(0.4, toBin - lift + u.pitch));
  // facing the shelf; from one side, turned back toward the target
  const yaw = Math.atan2(out[0] * back + axis[0] * side, out[1] * back + axis[1] * side) + u.yaw;
  const quaternion = new Quaternion().setFromEuler(new Euler(pitch, yaw, 0, "YXZ"));
  return { position, quaternion, fov };
}

export const CloseUpCamera = forwardRef<CloseUpCameraHandle, CloseUpCameraProps>(function CloseUpCamera({ target, safe, reducedMotion, exiting, returnView, onExited, distanceRef, envRef }, ref) {
  const { camera, invalidate, size } = useThree();
  const cam = camera as PerspectiveCamera;
  const user = useRef({ yaw: 0, pitch: 0, pan: 0, dolly: 0 });
  const anim = useRef<{ t0: number; segs: Segment[]; i: number; done?: () => void } | null>(null);
  const settled = useRef(false);

  const out = target.out ?? [0, target.facing];
  const axis = target.axis ?? [1, 0];
  /** the eye pose for the current target and the shopper's look / pan / dolly */
  const eye = (): CameraView => eyePose(target, user.current, safe, size.width / size.height);

  const apply = (v: CameraView) => {
    cam.position.copy(v.position);
    cam.quaternion.copy(v.quaternion);
    if (Math.abs(cam.fov - v.fov) > 0.01) cam.fov = v.fov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    if (distanceRef) distanceRef.current = 2;
    if (envRef) envRef.current = envAt(v.position.y);
  };

  const run = (segs: Segment[], done?: () => void) => {
    if (reducedMotion) {
      const last = segs[segs.length - 1];
      apply(last.at(1, 1));
      done?.();
      invalidate();
      return;
    }
    anim.current = { t0: performance.now(), segs, i: 0, done };
    invalidate();
  };

  /** the two moves between `high` (the overview's pose) and the eye pose, through the door */
  const moves = (high: CameraView): { descent: Segment; walk: Segment } => {
    const end = eye();
    const door = new Vector3(...target.door);
    const stand = end.position.clone();
    // the walk: the door, its turns along the aisle's walking line, where the shopper stands
    const path = [door, ...target.via.map((v) => new Vector3(...v)), stand];
    const lengths = path.slice(1).map((p, i) => p.distanceTo(path[i]));
    const metres = lengths.reduce((a, b) => a + b, 0);
    const along = (d: number) => {
      for (let i = 0; i < lengths.length; i++) {
        if (d <= lengths[i] || i === lengths.length - 1) return path[i].clone().lerp(path[i + 1], lengths[i] ? Math.min(1, d / lengths[i]) : 1);
        d -= lengths[i];
      }
      return stand.clone();
    };
    // at the door the shopper looks down the aisle toward the first turn (or the bin, when there is none)
    const doorPose = lookPose(door, target.via.length ? path[1].clone().lerp(path[2], 0.5) : stand.clone().lerp(new Vector3(...target.center), 0.25), end.fov);
    // the curve's control point: above the door at the overview's height, so the path comes down outside
    const ctrl = new Vector3(door.x, high.position.y, door.z).lerp(high.position, 0.25);
    // the view stays on the store all the way down: it looks at a point that glides from where the overview
    // was looking to the zone's open side ahead of the door, so the camera never turns to the sky
    const from = groundOf(high);
    const ahead = door.clone().add(new Vector3(0, 0, -1).applyQuaternion(doorPose.quaternion).multiplyScalar(3));
    // eased in and out (DESIGN.md §7's exception): it lifts off the map gently and settles at the door
    const descent: Segment = {
      ms: DESCENT_MS,
      ease: easeSine,
      at: (e) => {
        const a = high.position.clone().multiplyScalar((1 - e) * (1 - e));
        const b = ctrl.clone().multiplyScalar(2 * e * (1 - e));
        const c = door.clone().multiplyScalar(e * e);
        const position = a.add(b).add(c);
        const q = aim(position, from.clone().lerp(ahead, easeOut(e)));
        // the first and last moments hand over exactly from the overview's pose and to the door's
        const quaternion = high.quaternion.clone().slerp(q, Math.min(1, e * 6)).slerp(doorPose.quaternion, Math.max(0, (e - 0.85) / 0.15));
        return { position, quaternion, fov: high.fov + (doorPose.fov - high.fov) * e };
      },
    };
    const walk: Segment = {
      ms: walkMs(metres),
      ease: easeSine,
      at: (e) => {
        const p = along(e * metres);
        // a step every ~0.7 m: the head rises and falls, fading in and out with the walk
        if (!reducedMotion) p.y += BOB * Math.sin(Math.PI * e) * Math.pow(Math.sin((Math.PI * e * metres) / 0.7), 2);
        // the head turns to the bin over the walk's second half, as the shopper comes off the walking line
        return { position: p, quaternion: doorPose.quaternion.clone().slerp(end.quaternion, easeInOut(Math.max(0, Math.min(1, (e - 0.35) / 0.6)))), fov: end.fov };
      },
    };
    return { descent, walk };
  };

  // in: from wherever the overview left the camera, down outside the zone, then the walk in (started in the
  // commit itself, not after paint: the descent's first frame is the next one)
  useLayoutEffect(() => {
    cam.near = 0.05;
    cam.updateProjectionMatrix();
    settled.current = false;
    user.current = { yaw: 0, pitch: 0, pan: 0, dolly: 0 };
    const high = { position: cam.position.clone(), quaternion: cam.quaternion.clone(), fov: cam.fov };
    // already at eye level (another bin in the zone): just walk over, by the zone's way when it has one
    // (Produce: along the walking lines and the cross aisles, never through an island), else straight
    if (cam.position.y < 3) {
      const from = high;
      const to = eye();
      const way = [from.position.clone(), ...(target.over?.([from.position.x, from.position.y, from.position.z]) ?? []).map((p) => new Vector3(...p)), to.position.clone()];
      const lengths = way.slice(1).map((p, i) => p.distanceTo(way[i]));
      const metres = lengths.reduce((a, b) => a + b, 0) || 1e-3;
      const along = (d: number) => {
        for (let i = 0; i < lengths.length; i++) {
          if (d <= lengths[i] || i === lengths.length - 1) return way[i].clone().lerp(way[i + 1], lengths[i] ? Math.min(1, d / lengths[i]) : 1);
          d -= lengths[i];
        }
        return to.position.clone();
      };
      run(
        [
          {
            ms: walkMs(metres),
            ease: easeSine,
            at: (e) => {
              const p = along(e * metres);
              if (way.length === 2) return { position: p, quaternion: from.quaternion.clone().slerp(to.quaternion, e), fov: to.fov };
              // looking where they walk, turning to the shelf over the last stretch
              const ahead = lookPose(p, along(Math.min(metres, e * metres + 1.2)), to.fov).quaternion;
              const q = from.quaternion.clone().slerp(ahead, Math.min(1, e * 5)).slerp(to.quaternion, easeInOut(Math.max(0, (e - 0.6) / 0.4)));
              return { position: p, quaternion: q, fov: to.fov };
            },
          },
        ],
        () => (settled.current = true),
      );
      return;
    }
    const { descent, walk } = moves(high);
    run([chain(descent, walk)], () => (settled.current = true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.center[0], target.center[1], target.center[2], target.facing]);

  // out: walk back to the door, rise to the overview pose, then hand over
  useEffect(() => {
    if (!exiting) return;
    const back = returnView();
    const here = { position: cam.position.clone(), quaternion: cam.quaternion.clone(), fov: cam.fov };
    const { descent, walk } = moves(back);
    // 0.8 s in all, one motion: the walk back gathers speed, the rise carries it on and settles on the map
    const outward = chain(
      {
        ...walk,
        ms: EXIT_WALK_MS,
        // the walk back starts from wherever the shopper looked (panned, turned, dollied): blend that in
        at: (e, t) => {
          const p = walk.at(1 - e, 1 - t);
          const k = Math.min(1, e * 3);
          return { position: here.position.clone().lerp(p.position, k), quaternion: here.quaternion.clone().slerp(p.quaternion, k), fov: p.fov };
        },
      },
      { ...descent, ms: EXIT_RISE_MS, at: (e, t) => descent.at(1 - e, 1 - t) },
    );
    run([outward], () => {
      cam.near = 0.5;
      cam.updateProjectionMatrix();
      if (envRef) envRef.current = 0;
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
    const seg = a.segs[a.i];
    const t = Math.min(1, (performance.now() - a.t0) / seg.ms);
    apply(seg.at(seg.ease(t), t));
    if (t < 1) {
      invalidate();
      return;
    }
    if (a.i + 1 < a.segs.length) {
      a.i += 1;
      a.t0 = performance.now();
      invalidate();
      return;
    }
    anim.current = null;
    a.done?.();
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
      // dragging right moves the view left along the shelf: screen right, looking into the shelf, is (out.z, −out.x)
      const along = -(out[1] * axis[0] - out[0] * axis[1]);
      const along0 = target.center[0] * axis[0] + target.center[2] * axis[1];
      u.pan = Math.max(target.bounds.x0 - along0, Math.min(target.bounds.x1 - along0, u.pan + along * dx * 0.006));
      apply(eye());
      invalidate();
    },
    dolly: (factor) => {
      if (anim.current) return;
      const u = user.current;
      u.dolly = Math.max(-0.9, Math.min(target.stand - ARM, u.dolly + Math.log(factor) * 1.2));
      apply(eye());
      invalidate();
    },
    skip: () => {
      const a = anim.current;
      if (!a) return false;
      anim.current = null;
      apply(a.segs[a.segs.length - 1].at(1, 1));
      a.done?.();
      invalidate();
      return true;
    },
  }));

  return null;
});
