// Writes test/fixtures/motion/*.json: accelerometer traces (accelerationIncludingGravity, m/s²) with a known
// step count, for the step detector's tests. These are SYNTHETIC: a walking model (per step a heel-strike
// spike, the push-off bounce and the swing's dip, arm sway at half the cadence, cadence jitter, sensor noise, gravity
// spread over the axes by a slowly swaying phone), seeded so they never change. Survey mode keeps the raw
// samples of every calibration walk (Survey.calibration.trace); traces recorded on a phone belong next to
// these as recorded-*.json with the count walked.
//
//   node scripts/gen-motion-fixtures.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures/motion");
mkdirSync(OUT, { recursive: true });

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

/**
 * segments: [{walk: steps, hz: cadence} | {pause: seconds}]; amp: bounce m/s²; impact: heel-strike m/s²;
 * noise: σ m/s²; tilt: radians the phone leans (gravity leaves z); bumps: [[t s, m/s²]] (a stand still fidget)
 */
function trace({ name, seed, rate, segments, amp = 1.5, impact = 1.2, noise = 0.25, jitter = 0.05, tilt = 0.3, sway = 0.35, bumps = [] }) {
  const r = rng(seed);
  // step times
  const steps = [];
  let t = 1.5; // standing first
  for (const seg of segments) {
    if (seg.pause) t += seg.pause;
    else
      for (let k = 0; k < seg.walk; k++) {
        steps.push(t);
        t += (1 / seg.hz) * (1 + jitter * gauss(r));
      }
  }
  const end = t + 1.2;
  const out = { name, synthetic: true, rate, steps: steps.length, t: [], x: [], y: [], z: [] };
  const walkingAt = (s) => steps.some((st) => s >= st - 0.05 && s < st + 0.7);
  for (let s = 0; s < end; s += (1 / rate) * (1 + 0.08 * (r() - 0.5))) {
    let v = 0;
    for (const st of steps) {
      const tau = s - st;
      if (tau < -0.2 || tau > 0.8) continue;
      // one step: the heel strike, the push-off bounce right after it, the dip of the swing
      v += impact * Math.exp(-(((tau - 0.02) / 0.025) ** 2));
      v += amp * Math.exp(-(((tau - 0.1) / 0.09) ** 2));
      v -= 0.6 * amp * Math.exp(-(((tau - 0.33) / 0.1) ** 2));
    }
    for (const [bt, ba] of bumps) v += ba * Math.exp(-(((s - bt) / 0.12) ** 2));
    // arm / hand sway at half the cadence, only while walking
    const lateral = walkingAt(s) ? sway * Math.sin(Math.PI * 1.8 * s) : 0;
    // the phone leans and rolls slowly: gravity moves between the axes, its size does not
    const pitch = tilt + 0.15 * Math.sin(0.4 * s);
    const roll = 0.1 * Math.sin(0.27 * s + 1);
    const g = 9.81 + v;
    const gx = g * Math.sin(roll) + lateral;
    const gy = g * Math.sin(pitch) * Math.cos(roll);
    const gz = g * Math.cos(pitch) * Math.cos(roll);
    out.t.push(Math.round(s * 1000));
    out.x.push(+(gx + noise * gauss(r)).toFixed(3));
    out.y.push(+(gy + noise * gauss(r)).toFixed(3));
    out.z.push(+(gz + noise * gauss(r)).toFixed(3));
  }
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(out) + "\n");
  console.log(`${name}: ${out.steps} steps, ${out.t.length} samples, ${end.toFixed(1)} s`);
}

trace({ name: "walk-hand-60hz", seed: 1, rate: 60, segments: [{ walk: 20, hz: 1.8 }] });
trace({ name: "walk-cart-50hz", seed: 2, rate: 50, segments: [{ walk: 16, hz: 1.45 }], amp: 0.9, impact: 0.8, noise: 0.2, sway: 0.1 });
trace({ name: "walk-pocket-60hz", seed: 3, rate: 60, segments: [{ walk: 24, hz: 2.0 }], amp: 2.6, impact: 2.2, noise: 0.45, tilt: 1.1 });
trace({ name: "walk-stop-walk-60hz", seed: 4, rate: 60, segments: [{ walk: 10, hz: 1.8 }, { pause: 3 }, { walk: 10, hz: 1.7 }] });
trace({ name: "walk-irregular-30hz", seed: 5, rate: 30, segments: [{ walk: 18, hz: 1.7 }], jitter: 0.12, noise: 0.3 });
trace({ name: "stand-fidget-60hz", seed: 6, rate: 60, segments: [{ pause: 8 }], noise: 0.3, bumps: [[2.5, 0.5], [5.1, 0.45], [7.3, 0.4]] });

// held out: never tuned against. Random walks across the plausible ranges, from their own seeds.
for (let i = 1; i <= 8; i++) {
  const r = rng(1000 + i);
  const pick = (a, b) => a + (b - a) * r();
  const walk = Math.round(pick(12, 30));
  trace({
    name: `heldout-${i}`,
    seed: 2000 + i,
    rate: [30, 50, 60, 60][Math.floor(r() * 4)],
    segments: r() < 0.3 ? [{ walk: Math.floor(walk / 2), hz: pick(1.4, 2.1) }, { pause: pick(2, 4) }, { walk: Math.ceil(walk / 2), hz: pick(1.4, 2.1) }] : [{ walk, hz: pick(1.4, 2.1) }],
    amp: pick(0.8, 2.6),
    impact: pick(0.6, 2.2),
    noise: pick(0.15, 0.45),
    jitter: pick(0.03, 0.12),
    tilt: pick(0, 1.2),
    sway: pick(0.05, 0.4),
  });
}
