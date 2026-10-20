// Generates the hero zones' textures procedurally and encodes them to KTX2 (Basis Universal), two tiers:
//
//   node apps/web/scripts/gen-hero-textures.mjs        (needs basisu: brew install basis_universal)
//
// Writes apps/web/src/hero/assets/<name>.ktx2 (hi) and <name>.lo.ktx2 (half size) plus manifest.json. The
// files are committed; CI and the app never run this. Everything is drawn on canvases in headless Chromium
// (Outfit for the lettering, loaded from public/fonts), from the zone recipe (src/hero/bulk/recipe.ts) for
// the labels, tags and header boards:
//
//   pine, plaster (+ normal), concrete, burlap (+ normal), terracotta, stone (+ normal)   tileable surfaces
//   grains (+ normal)   8 × 4 atlas of grain shapes at their real size (recipe.ts GRAIN_SHAPES), near-white so
//                       a bin's tint colours them; the normals at half size
//   labels              house-brand labels, each drawn at its pack's aspect (kit/products.ts), and bin tags
//   headers             the black header boards with white uppercase lettering
//   cutouts             RGBA, alpha-tested: the sacks' stencils, the jute fringe, wheat ears
//   oak, brushed, chalk, packs, mounds, foliage    Produce's (scripts/produce-textures.mjs, src/hero/produce/recipe.ts)
//
// ONLY=oak,chalk,… re-encodes just those (the rest of the committed files and the manifest stay as they are).
//
// Albedo and normal maps go to ETC1S (small; organic surfaces and relief survive it: the grains' normals were
// 1.1 MB as UASTC and ~8× smaller as ETC1S); lettering and cutouts to UASTC with RDO (sharp edges, still
// zstd-supercompressed). sRGB for colour, linear for normals. Mipmapped.

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GRAIN_SHAPES, HEADERS, LABEL_ATLAS, LABEL_ROWS, LABEL_STYLE, SACK_STENCILS, labelCells } from "../src/hero/bulk/recipe.ts";
import { STANDARD_TEMPLATES, TEMPLATES } from "../src/hero/kit/products.ts";
import { BAND, signKeys, signLabel, styleOf, CAT_COLS, CAT_CELL } from "../src/hero/standard/styles.ts";
import CATEGORIES from "../../../packages/stores/grosher/categories.json" with { type: "json" };
import { CHALK_ATLAS, FOLIAGE, HEADER, HEADERS as PRODUCE_HEADERS, JUICES, JUICE_LABEL, JUICE_LABEL_ASPECT, MOUNDS, PACKS, SIGN, signCells } from "../src/hero/produce/recipe.ts";
import { drawProduce } from "./produce-textures.mjs";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "src", "hero", "assets");
const TMP = join(ROOT, ".hero-tex-tmp");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
mkdirSync(OUT, { recursive: true });

const font = readFileSync(join(ROOT, "public", "fonts", "outfit-latin.woff2")).toString("base64");
const { labels, tags } = labelCells();
// each pack's label front, width over height: the generator draws the lettering at that aspect
const ASPECT = Object.fromEntries(Object.entries(TEMPLATES).map(([k, t]) => { const f = t().front; return [k, f[0] / f[1]]; }));
// the standard close-ups: every category's house label, at its pack's aspect, and the aisle signs
const CATS = CATEGORIES.map((c) => {
  const style = styleOf(c.id, c.department);
  const f = STANDARD_TEMPLATES[style]().front;
  return { id: c.id, name: c.name, band: BAND[c.department] ?? "#6A5A4A", style, aspect: f[0] / f[1] };
});
const SIGNS = signKeys(CATEGORIES).map((k) => signLabel(...k.split("|")));

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<!doctype html><html><body></body></html>");
const images = await page.evaluate(
  async ({ font, labels, tags, headers, GRAIN, STYLE, ASPECT, LABEL_ATLAS, LABEL_ROWS, stencils, CATS, SIGNS, CAT_COLS, CAT_CELL }) => {
    const face = new FontFace("Outfit", `url(data:font/woff2;base64,${font})`, { weight: "100 900" });
    await face.load();
    document.fonts.add(face);

    // ---------------------------------------------------------------- helpers
    let seed = 7;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const canvas = (w, h) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      return c;
    };
    /** periodic value noise: a `cells` × `cells` grid, wrapping, smooth */
    const periodic = (cells) => {
      const g = Array.from({ length: cells * cells }, () => rand());
      const at = (i, j) => g[((j % cells) + cells) % cells * cells + (((i % cells) + cells) % cells)];
      const s = (t) => t * t * (3 - 2 * t);
      return (u, v) => {
        const x = u * cells;
        const y = v * cells;
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const fx = s(x - x0);
        const fy = s(y - y0);
        const a = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
        const b = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
        return a * (1 - fy) + b * fy;
      };
    };
    const fbm = (octaves) => {
      const ns = octaves.map(([cells]) => periodic(cells));
      const total = octaves.reduce((s, [, a]) => s + a, 0);
      return (u, v) => ns.reduce((s, n, i) => s + n(u, v) * octaves[i][1], 0) / total;
    };
    /** fill an RGB(A) image from f(u, v) → [r, g, b] (0–255) */
    const paint = (w, h, f) => {
      const c = canvas(w, h);
      const ctx = c.getContext("2d");
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const [r, g, b] = f(x / w, y / h, x, y);
          const i = (y * w + x) * 4;
          img.data[i] = r;
          img.data[i + 1] = g;
          img.data[i + 2] = b;
          img.data[i + 3] = 255;
        }
      ctx.putImageData(img, 0, 0);
      return c;
    };
    /** a normal map from a height field h(x, y) (0–1), wrapping at `wrap` px (tileable) or within cells */
    const normalFrom = (w, hgt, H, strength, cell = 0) => {
      const get = (x, y) => {
        if (cell) {
          const cx = Math.floor(x / cell) * cell;
          const cy = Math.floor(y / cell) * cell;
          x = cx + ((x - cx) % cell + cell) % cell;
          y = cy + ((y - cy) % cell + cell) % cell;
        }
        return hgt[((y + H) % H) * w + ((x + w) % w)];
      };
      return paint(w, H, (u, v, x, y) => {
        const wrapX = (dx) => (cell ? Math.floor(x / cell) * cell + (((x % cell) + dx + cell) % cell) : x + dx);
        const wrapY = (dy) => (cell ? Math.floor(y / cell) * cell + (((y % cell) + dy + cell) % cell) : y + dy);
        const dx = (get(wrapX(1), y) - get(wrapX(-1), y)) * strength;
        const dy = (get(x, wrapY(1)) - get(x, wrapY(-1))) * strength;
        const n = [-dx, dy, 1];
        const l = Math.hypot(...n);
        return n.map((c) => Math.round(((c / l) * 0.5 + 0.5) * 255));
      });
    };
    const heightOf = (c) => {
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      const out = new Float32Array(c.width * c.height);
      for (let i = 0; i < out.length; i++) out[i] = d[i * 4] / 255;
      return out;
    };
    const half = (c) => {
      const h = canvas(c.width / 2, c.height / 2);
      const ctx = h.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(c, 0, 0, h.width, h.height);
      return h;
    };
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
    const out = {};
    const put = (name, c) => {
      out[name] = c.toDataURL("image/png");
      out[`${name}.lo`] = half(c).toDataURL("image/png");
    };

    // ---------------------------------------------------------------- pine planks: light pine, long grain along u
    {
      const warp = fbm([[2, 1], [6, 0.3]]);
      const streak = periodic(48); // long fibres: sampled stretched along u
      const fine = fbm([[64, 1], [256, 0.6]]);
      put("pine", paint(512, 512, (u, v) => {
        const ring = Math.sin((v * 34 + warp(u, v) * 1.4) * Math.PI * 2);
        const late = Math.pow(Math.max(0, ring), 8); // the darker latewood lines
        const fibre = streak(u * 0.125, v * 6) - 0.5;
        const l = -late * 30 + fibre * 22 + (fine(u, v) - 0.5) * 10 + (warp(u, v * 0.5) - 0.5) * 14;
        return [clamp(228 + l), clamp(196 + l * 0.9), clamp(150 + l * 0.75)];
      }));
    }
    // ---------------------------------------------------------------- clay plaster: warm tan, matte, trowelled
    {
      const big = fbm([[3, 1], [8, 0.6], [24, 0.3]]);
      const fine = fbm([[96, 1], [256, 0.8]]);
      const blot = fbm([[5, 1], [13, 0.5]]);
      const hgt = new Float32Array(512 * 512);
      put("plaster", paint(512, 512, (u, v, x, y) => {
        const b = big(u, v);
        const f = fine(u, v);
        hgt[y * 512 + x] = b * 0.6 + f * 0.4;
        // the reference's mud plaster: tan with darker clouds where it was trowelled wetter
        const l = (b - 0.5) * 34 + (f - 0.5) * 12 - Math.max(0, blot(u, v) - 0.58) * 70;
        return [clamp(192 + l), clamp(156 + l * 0.9), clamp(116 + l * 0.8)];
      }));
      put("plaster_n", normalFrom(512, hgt, 512, 3.2));
    }
    // ---------------------------------------------------------------- polished concrete: khaki-olive, clouded, flecked
    {
      const cloud = fbm([[3, 1], [9, 0.5], [27, 0.25]]);
      const swirl = fbm([[2, 1], [5, 0.6]]);
      const c = paint(512, 512, (u, v) => {
        const sw = Math.sin((u * 3 + swirl(u, v) * 4) * Math.PI * 2) * 0.5 + 0.5;
        const l = (cloud(u, v) - 0.5) * 38 + (sw - 0.5) * 8;
        return [clamp(160 + l), clamp(146 + l * 0.95), clamp(104 + l * 0.85)];
      });
      const ctx = c.getContext("2d");
      for (let i = 0; i < 1400; i++) {
        const x = rand() * 512;
        const y = rand() * 512;
        const r = 0.4 + rand() * 0.7;
        const d = rand() < 0.55;
        ctx.fillStyle = d ? `rgba(80,70,48,${0.12 + rand() * 0.18})` : `rgba(214,204,172,${0.1 + rand() * 0.15})`;
        for (const [ox, oy] of [[0, 0], [512, 0], [-512, 0], [0, 512], [0, -512]]) {
          ctx.beginPath();
          ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      put("concrete", c);
    }
    // ---------------------------------------------------------------- jute: pale, a fine plain weave with slubs
    {
      // the tile is 0.25 m of cloth: 100 threads each way, a 2.5 mm pitch (5 px)
      const n = fbm([[32, 1], [128, 0.7]]);
      const T = 5;
      const slubW = Array.from({ length: 512 / T }, () => (rand() < 0.12 ? 1.5 + rand() : 1));
      const slubH = Array.from({ length: 512 / T }, () => (rand() < 0.12 ? 1.5 + rand() : 1));
      const toneW = Array.from({ length: 512 / T }, () => (rand() - 0.5) * 26);
      const toneH = Array.from({ length: 512 / T }, () => (rand() - 0.5) * 26);
      const hgt = new Float32Array(512 * 512);
      put("burlap", paint(512, 512, (u, v, x, y) => {
        const i = Math.floor(x / T);
        const j = Math.floor(y / T);
        const cx = (x % T) / T;
        const cy = (y % T) / T;
        const over = (i + j) % 2 === 0;
        const vert = Math.max(0, 1 - Math.abs(cx - 0.5) * 2 / Math.min(1, 0.72 * slubW[i])); // the warp thread across x
        const horz = Math.max(0, 1 - Math.abs(cy - 0.5) * 2 / Math.min(1, 0.72 * slubH[j]));
        const h = over ? Math.max(horz * 0.95, vert * 0.6) : Math.max(vert * 0.95, horz * 0.6);
        const gap = vert < 0.05 && horz < 0.05;
        const fuzz = n(u, v);
        hgt[y * 512 + x] = gap ? 0 : h * 0.8 + fuzz * 0.2;
        const tone = over ? toneH[j] : toneW[i];
        const l = (h - 0.6) * 46 + (fuzz - 0.5) * 24 + tone - (gap ? 70 : 0);
        // the reference's sacks: a pale, slightly grey jute
        return [clamp(206 + l), clamp(192 + l * 0.95), clamp(160 + l * 0.85)];
      }));
      put("burlap_n", normalFrom(512, hgt, 512, 4));
    }
    // ---------------------------------------------------------------- terracotta: fired clay with throwing rings
    {
      const n = fbm([[8, 1], [64, 0.5]]);
      put("terracotta", paint(256, 256, (u, v) => {
        const ring = Math.sin(v * Math.PI * 2 * 28) * 6;
        const l = (n(u, v) - 0.5) * 30 + ring;
        return [clamp(196 + l), clamp(112 + l * 0.7), clamp(70 + l * 0.5)];
      }));
    }
    // ---------------------------------------------------------------- stone: grey granite, dressed with a chisel
    {
      const n = fbm([[16, 1], [64, 0.8], [256, 0.6]]);
      const hgt = new Float32Array(256 * 256);
      // chisel grooves run along v (up a wheel's rim), a few per tile, jittered
      const grooves = Array.from({ length: 14 }, (_, k) => (k + rand() * 0.6) / 14);
      put("stone", paint(256, 256, (u, v, x, y) => {
        const f = n(u, v);
        let g = 0;
        for (const gu of grooves) {
          const d = Math.abs(((u - gu + 1.5) % 1) - 0.5) * 256;
          g = Math.max(g, Math.max(0, 1 - d / 2.2));
        }
        const pit = f < 0.3 ? 1 : 0;
        hgt[y * 256 + x] = f * 0.5 - g * 0.5 - pit * 0.3;
        const fleck = f > 0.64 ? 26 : f < 0.36 ? -30 : 0;
        const l = (f - 0.5) * 40 + fleck - g * 36;
        return [clamp(138 + l), clamp(133 + l), clamp(126 + l)];
      }));
      put("stone_n", normalFrom(256, hgt, 256, 5));
    }
    // ---------------------------------------------------------------- grains: 8 × 4 cells of 256 px, at real size
    {
      const C = 256;
      const W = C * 8;
      const H = C * 4;
      const alb = canvas(W, H);
      const hc = canvas(W, H);
      const a = alb.getContext("2d");
      const hctx = hc.getContext("2d");
      // the crevices between grains: deep shade, never a black hole
      a.fillStyle = "#5C5650";
      a.fillRect(0, 0, W, H);
      hctx.fillStyle = "#000";
      hctx.fillRect(0, 0, W, H);
      /** the outline of one grain, centred at 0, 0, unrotated (length along x) */
      const outline = (ctx, kind, rx, ry, r) => {
        ctx.beginPath();
        if (kind === "kidney" || kind === "crescent") {
          // a bean: the outer edge a full arc, the inner edge bowed in
          const bow = kind === "crescent" ? 0.55 : 0.28;
          ctx.ellipse(0, 0, rx, ry, 0, Math.PI, 0, false);
          ctx.quadraticCurveTo(rx * 0.7, ry * 0.8, rx * 0.3, ry * (1 - bow));
          ctx.quadraticCurveTo(0, ry * (0.6 - bow), -rx * 0.3, ry * (1 - bow));
          ctx.quadraticCurveTo(-rx * 0.7, ry * 0.8, -rx, 0);
        } else if (kind === "teardrop") {
          ctx.moveTo(rx, 0);
          ctx.bezierCurveTo(rx * 0.4, ry * 1.2, -rx * 1.1, ry * 1.05, -rx, 0);
          ctx.bezierCurveTo(-rx * 1.1, -ry * 1.05, rx * 0.4, -ry * 1.2, rx, 0);
        } else if (kind === "long") {
          const k = ry;
          ctx.moveTo(-rx + k, -ry);
          ctx.lineTo(rx - k, -ry);
          ctx.quadraticCurveTo(rx + k * 0.2, 0, rx - k, ry);
          ctx.lineTo(-rx + k, ry);
          ctx.quadraticCurveTo(-rx - k * 0.2, 0, -rx + k, -ry);
        } else if (kind === "flake" || kind === "cluster" || kind === "wrinkled" || kind === "puff") {
          const n = 9;
          for (let k = 0; k <= n; k++) {
            const t = (k / n) * Math.PI * 2;
            const j = kind === "flake" ? 0.72 + r() * 0.42 : kind === "puff" ? 0.86 + r() * 0.2 : 0.82 + r() * 0.26;
            const px = Math.cos(t) * rx * j;
            const py = Math.sin(t) * ry * j;
            if (k === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
        } else if (kind === "chickpea") {
          ctx.ellipse(0, 0, rx, ry, 0, 0.35, Math.PI * 2 - 0.35);
          ctx.lineTo(rx * 1.18, 0); // the beak
          ctx.closePath();
        } else ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      };
      GRAIN.forEach((shape, idx) => {
        const ox = (idx % 8) * C;
        const oy = Math.floor(idx / 8) * C;
        const ppm = C / (shape.cellM * 1000); // px per millimetre
        a.save();
        hctx.save();
        a.beginPath();
        a.rect(ox, oy, C, C);
        a.clip();
        hctx.beginPath();
        hctx.rect(ox, oy, C, C);
        hctx.clip();
        if (shape.draw === "powder" || shape.draw === "granular") {
          // flour: soft mounds and a fine speckle; sooji: sand-fine grains
          const m = fbm([[4, 1], [16, 0.5], [64, 0.35]]);
          const step = shape.draw === "granular" ? 1 : 2;
          for (let y = 0; y < C; y += step)
            for (let x = 0; x < C; x += step) {
              const h = m(x / C, y / C);
              const grain = shape.draw === "granular" ? (rand() - 0.5) * 70 : (rand() - 0.5) * 16;
              const l = clamp(214 + (h - 0.5) * 60 + grain);
              a.fillStyle = `rgb(${l},${l},${l})`;
              a.fillRect(ox + x, oy + y, step, step);
              const g = clamp(h * 200 + (shape.draw === "granular" ? rand() * 55 : rand() * 10));
              hctx.fillStyle = `rgb(${g},${g},${g})`;
              hctx.fillRect(ox + x, oy + y, step, step);
            }
        } else {
          const rx0 = (shape.size[0] * ppm) / 2;
          const ry0 = (shape.size[1] * ppm) / 2;
          // enough grains to cover the cell twice over: a pile, no gaps but the shadows between grains
          const n = Math.ceil((3.4 * C * C) / (Math.PI * rx0 * ry0));
          const mixed = shape.draw === "cluster";
          const mix = shape.id === "granola" ? [[196, 150, 92], [174, 124, 72], [226, 196, 140], [150, 98, 60], [232, 214, 170]] : [[214, 168, 112], [92, 50, 40], [230, 206, 160], [176, 96, 60], [236, 228, 210], [150, 60, 48]];
          for (let i = 0; i < n; i++) {
            const cx = ox + rand() * C;
            const cy = oy + rand() * C;
            const rot = rand() * Math.PI * 2;
            const sz = 0.85 + rand() * 0.3;
            // a flat grain (a lentil, a split dal, a flake) lies at any tilt in a pile: seen from above it is an
            // ellipse of any eccentricity, which is what makes a pile of lentils read as lentils
            const flatGrain = ["lens", "split", "flake", "teardrop"].includes(shape.draw) || shape.id === "pumpkinSeed";
            const tilt = flatGrain ? 0.3 + 0.7 * Math.sqrt(rand()) : shape.draw === "oval" ? 0.75 + rand() * 0.25 : 1;
            const rx = rx0 * sz * (mixed ? 0.7 + rand() * 0.6 : 1);
            const ry = ry0 * sz * tilt * (mixed ? 0.7 + rand() * 0.6 : 1);
            const lum = 226 + (rand() - 0.5) * 36;
            const base = mixed ? mix[Math.floor(rand() * mix.length)] : [lum, lum, lum];
            const seed = rand() * 1e6;
            const kind = shape.draw === "split" ? "lens" : shape.draw === "drop" ? "oval" : shape.draw === "bean" ? "oval" : shape.draw;
            // split dal: most pieces lie flat face up (paler, a fine edge of seed coat), a few on their dome
            const flatFace = shape.draw === "split" && rand() < 0.7;
            // a D-shaped half when it lies on its edge
            for (const [dx, dy] of [[0, 0], [C, 0], [-C, 0], [0, C], [0, -C], [C, C], [-C, -C], [C, -C], [-C, C]]) {
              const x = cx + dx;
              const y = cy + dy;
              if (x < ox - rx * 2 || x > ox + C + rx * 2 || y < oy - rx * 2 || y > oy + C + rx * 2) continue;
              let s = seed;
              const r = () => {
                s = (s * 16807) % 2147483647;
                return (s % 1000) / 1000;
              };
              // the shadow it casts on the grains below
              a.save();
              a.translate(x + rx * 0.18, y + ry * 0.22);
              a.rotate(rot);
              outline(a, kind, rx * 1.05, ry * 1.05, r);
              a.fillStyle = "rgba(0,0,0,0.38)";
              a.fill();
              a.restore();
              s = seed;
              a.save();
              a.translate(x, y);
              a.rotate(rot);
              outline(a, kind, rx, ry, r);
              const [cr, cg, cb] = base;
              const flat = kind === "lens" || kind === "flake";
              const g = a.createRadialGradient(-rx * 0.25, -ry * 0.3, 0, 0, 0, Math.max(rx, ry));
              // a flat face is evenly lit (a tilted one a touch darker) with a thin dark rim; a dome shades round
              const top = flat ? 0.88 + tilt * 0.14 : 1.1;
              g.addColorStop(0, `rgb(${clamp(cr * top)},${clamp(cg * top)},${clamp(cb * top)})`);
              g.addColorStop(flat ? 0.82 : 0.5, `rgb(${clamp(cr * (flat ? top * 0.96 : 1))},${clamp(cg * (flat ? top * 0.96 : 1))},${clamp(cb * (flat ? top * 0.96 : 1))})`);
              g.addColorStop(1, `rgb(${clamp(cr * 0.6)},${clamp(cg * 0.6)},${clamp(cb * 0.6)})`);
              a.fillStyle = g;
              a.fill();
              if (flat && tilt > 0.55) {
                // the lens's edge catching the light
                a.strokeStyle = "rgba(255,255,255,0.22)";
                a.lineWidth = Math.max(0.6, rx * 0.08);
                a.beginPath();
                a.ellipse(0, 0, rx * 0.86, ry * 0.86, 0, Math.PI * 1.05, Math.PI * 1.75);
                a.stroke();
              }
              // details: a split face's seed-coat rim, a whole moong's hilum, a bean's crease, wrinkles, a gloss
              a.lineWidth = Math.max(0.6, ry * 0.12);
              if (flatFace) {
                a.strokeStyle = "rgba(60,40,20,0.35)";
                a.stroke();
              }
              if (shape.draw === "oval" && shape.gloss && rx > 3) {
                a.strokeStyle = "rgba(255,255,255,0.55)";
                a.lineWidth = Math.max(0.5, ry * 0.18);
                a.beginPath();
                a.moveTo(-rx * 0.3, -ry * 0.05);
                a.lineTo(rx * 0.3, -ry * 0.05);
                a.stroke();
              }
              if (shape.draw === "bean") {
                a.strokeStyle = "rgba(30,20,12,0.6)";
                a.lineWidth = Math.max(0.6, ry * 0.14);
                a.beginPath();
                a.moveTo(-rx * 0.75, 0);
                a.bezierCurveTo(-rx * 0.2, ry * 0.3, rx * 0.2, -ry * 0.3, rx * 0.75, 0);
                a.stroke();
              }
              if (shape.draw === "wrinkled" || shape.draw === "chickpea" || shape.id === "walnut") {
                a.strokeStyle = "rgba(30,18,12,0.45)";
                a.lineWidth = Math.max(0.6, ry * 0.07);
                for (let k = 0; k < (shape.id === "walnut" ? 6 : 3); k++) {
                  const t = r() * Math.PI * 2;
                  a.beginPath();
                  a.moveTo(Math.cos(t) * rx * 0.7, Math.sin(t) * ry * 0.7);
                  a.quadraticCurveTo((r() - 0.5) * rx, (r() - 0.5) * ry, -Math.cos(t + 0.8) * rx * 0.6, -Math.sin(t + 0.8) * ry * 0.6);
                  a.stroke();
                }
              }
              if (shape.draw === "teardrop" && rx > 4) {
                a.strokeStyle = "rgba(40,24,14,0.3)";
                a.lineWidth = 0.7;
                for (let k = -1; k <= 1; k++) {
                  a.beginPath();
                  a.moveTo(-rx * 0.8, k * ry * 0.35);
                  a.quadraticCurveTo(0, k * ry * 0.5, rx * 0.8, k * ry * 0.1);
                  a.stroke();
                }
              }
              if (shape.draw === "puff") {
                a.fillStyle = "rgba(120,80,50,0.45)";
                for (let k = 0; k < 3; k++) {
                  a.beginPath();
                  a.arc((r() - 0.5) * rx, (r() - 0.5) * ry, rx * (0.1 + r() * 0.15), 0, Math.PI * 2);
                  a.fill();
                }
              }
              if (shape.gloss) {
                a.fillStyle = `rgba(255,255,255,${0.35 * shape.gloss})`;
                a.beginPath();
                a.ellipse(-rx * 0.3, -ry * 0.35, rx * 0.22, ry * 0.16, 0, 0, Math.PI * 2);
                a.fill();
              }
              a.restore();
              // height: a dome (a plateau for flat faces)
              s = seed;
              hctx.save();
              hctx.translate(x, y);
              hctx.rotate(rot);
              outline(hctx, kind, rx, ry, r);
              const hg = hctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(rx, ry));
              hg.addColorStop(0, "#fff");
              hg.addColorStop(flat || flatFace ? 0.7 : 0.35, flat || flatFace ? "#eee" : "#bbb");
              hg.addColorStop(1, "#222");
              hctx.fillStyle = hg;
              hctx.fill();
              hctx.restore();
            }
          }
        }
        a.restore();
        hctx.restore();
      });
      put("grains", alb);
      // the relief at half size: a grain's dome needs fewer pixels than its colour
      const hgt = heightOf(hc);
      const nrm = normalFrom(W, hgt, H, 5, C);
      out.grains_n = half(nrm).toDataURL("image/png");
      out["grains_n.lo"] = half(half(nrm)).toDataURL("image/png");
    }
    // ---------------------------------------------------------------- labels: house-brand labels at each pack's aspect + bin tags
    {
      const [W, H] = LABEL_ATLAS;
      const c = canvas(W, H);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#e9dfcf";
      ctx.fillRect(0, 0, W, H);
      const kraftNoise = fbm([[16, 1], [64, 0.8], [128, 0.5]]);
      const kraft = paint(160, 160, (u, v) => {
        const l = (kraftNoise(u, v) - 0.5) * 30;
        return [clamp(186 + l), clamp(146 + l * 0.9), clamp(98 + l * 0.8)];
      });
      // woven polypropylene: white tape weave
      const woven = paint(64, 64, (u, v, x, y) => {
        const over = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0;
        const along = over ? (x % 4) / 4 : (y % 4) / 4;
        const l = 238 - Math.abs(along - 0.5) * 30 - (rand() < 0.02 ? 20 : 0);
        return [l, l, clamp(l - 6)];
      });
      const fit = (text, max, size, weight = 600, min = 8) => {
        ctx.font = `${weight} ${size}px Outfit`;
        while (ctx.measureText(text).width > max && size > min) ctx.font = `${weight} ${--size}px Outfit`;
        return size;
      };
      const wrap = (text, max, size, weight = 600) => {
        ctx.font = `${weight} ${size}px Outfit`;
        const lines = [];
        let line = "";
        for (const w of text.split(" ")) {
          const t = line ? `${line} ${w}` : w;
          if (ctx.measureText(t).width > max && line) {
            lines.push(line);
            line = w;
          } else line = t;
        }
        lines.push(line);
        return lines;
      };
      const lines = (arr, cx, cy, lh) => arr.forEach((t, k) => ctx.fillText(t, cx, cy + k * lh - ((arr.length - 1) * lh) / 2));
      /** a few grains in a window, so the pack shows what is in it */
      const window = (x, y, w, h, tint, r = 6) => {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
        ctx.clip();
        ctx.fillStyle = tint;
        ctx.fillRect(x, y, w, h);
        for (let k = 0; k < (w * h) / 14; k++) {
          ctx.fillStyle = rand() < 0.5 ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.22)";
          ctx.beginPath();
          ctx.ellipse(x + rand() * w, y + rand() * h, 2 + rand() * 1.6, 1.4 + rand(), rand() * 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
        ctx.stroke();
      };
      const ink = "#2A1A10";
      labels.forEach((l, i) => {
        const x = (i % 16) * 128;
        const y = Math.floor(i / 16) * 128;
        const style = STYLE[l.kind];
        const aspect = ASPECT[l.kind];
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, 128, 128);
        ctx.clip();
        // the side strip (x 0–12): what the pack's sides, back and top show
        const strip = { pouch: "#F4EEE2", kraft: null, sack: null, carton: l.band, jar: "#F2EADB", spice: "#2A2420", ghee: "#D9A82E", oil: "#F2EADB", tin: l.band }[style];
        if (style === "kraft") ctx.drawImage(kraft, x, y);
        else if (style === "sack") for (let k = 0; k < 4; k++) for (let j = 0; j < 2; j++) ctx.drawImage(woven, x + j * 64, y + k * 32, 64, 32);
        else {
          ctx.fillStyle = strip;
          ctx.fillRect(x, y, 128, 128);
        }
        // the front: drawn in a virtual box at the pack's aspect (160 tall), squeezed into 116 × 128
        const VH = 160;
        const VW = VH * aspect;
        ctx.translate(x + 12, y);
        ctx.scale(116 / VW, 128 / VH);
        const cx = VW / 2;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        if (style === "pouch") {
          const g = ctx.createLinearGradient(0, 0, VW, 0);
          g.addColorStop(0, "#F7F2E8");
          g.addColorStop(0.5, "#FFFFFF");
          g.addColorStop(1, "#EFE8DA");
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, VW, VH);
          ctx.fillStyle = l.band;
          ctx.fillRect(0, 0, VW, 34);
          ctx.fillStyle = "#FFFFFF";
          ctx.font = "600 10px Outfit";
          ctx.fillText("G R O S H E R", cx, 22);
          ctx.fillStyle = ink;
          lines(wrap(l.name, VW - 14, 15), cx, 60, 15);
          window(VW * 0.16, 80, VW * 0.68, 46, l.tint, 8);
          ctx.fillStyle = l.band;
          ctx.font = "600 11px Outfit";
          ctx.fillText(l.weight, cx, 148);
        } else if (style === "kraft") {
          ctx.drawImage(kraft, 0, 0, VW, VH);
          ctx.fillStyle = "rgba(42,26,16,0.8)";
          ctx.font = "700 10px Outfit";
          ctx.fillText("G R O S H E R", cx, 26);
          ctx.fillStyle = "#F7F1E6";
          ctx.fillRect(VW * 0.1, 44, VW * 0.8, 84);
          ctx.fillStyle = l.band;
          ctx.fillRect(VW * 0.1, 44, VW * 0.8, 9);
          ctx.fillStyle = ink;
          lines(wrap(l.name, VW * 0.72, 15), cx, 84, 15);
          ctx.font = "500 10px Outfit";
          ctx.fillText(l.weight, cx, 120);
        } else if (style === "sack") {
          for (let k = 0; k < 5; k++) for (let j = 0; j < 3; j++) ctx.drawImage(woven, j * 64, k * 64, 64, 64);
          ctx.fillStyle = l.band;
          ctx.fillRect(0, 10, VW, 40);
          ctx.fillStyle = "#FFFFFF";
          const nm = l.name.toUpperCase();
          fit(nm, VW - 12, 16, 700);
          ctx.fillText(nm, cx, 36);
          ctx.fillStyle = l.tint;
          ctx.beginPath();
          ctx.ellipse(cx, 82, VW * 0.26, 20, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = l.band;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = l.band;
          ctx.font = "800 26px Outfit";
          ctx.fillText(l.weight, cx, 136);
          ctx.fillStyle = "rgba(42,26,16,0.75)";
          ctx.font = "600 9px Outfit";
          ctx.fillText("G R O S H E R", cx, 152);
        } else if (style === "carton") {
          ctx.fillStyle = l.band;
          ctx.fillRect(0, 0, VW, VH);
          ctx.fillStyle = "#FFFFFF";
          ctx.font = "700 7px Outfit";
          ctx.fillText("GROSHER", cx, 14);
          ctx.fillStyle = "#F7F1E6";
          ctx.fillRect(4, 22, VW - 8, 66);
          ctx.fillStyle = ink;
          lines(wrap(l.name, VW - 12, 11, 700), cx, 52, 12);
          window(6, 96, VW - 12, 40, l.tint, 4);
          ctx.fillStyle = "#FFFFFF";
          ctx.font = "600 8px Outfit";
          ctx.fillText(l.weight, cx, 152);
        } else if (style === "jar" || style === "oil" || style === "tin") {
          ctx.fillStyle = style === "tin" ? l.band : "#F4ECDD";
          ctx.fillRect(0, 0, VW, VH);
          if (style !== "tin") {
            ctx.fillStyle = l.band;
            ctx.fillRect(0, 0, VW, 22);
            ctx.fillRect(0, VH - 14, VW, 14);
          } else {
            ctx.fillStyle = "#F7F1E6";
            ctx.fillRect(VW * 0.12, 40, VW * 0.76, 82);
          }
          ctx.fillStyle = style === "tin" ? "#FFFFFF" : "#FFFFFF";
          ctx.font = "600 12px Outfit";
          ctx.fillText("G R O S H E R", cx, style === "tin" ? 28 : 16);
          ctx.fillStyle = ink;
          if (style === "oil") {
            ctx.font = "600 11px Outfit";
            ctx.fillText("COLD PRESSED", cx, 48);
          }
          const size = fit(l.name, VW * 0.7, style === "jar" ? 30 : 24, 700, 12);
          lines(wrap(l.name, VW * 0.72, size, 700), cx, style === "oil" ? 92 : 88, size + 2);
          ctx.font = "500 14px Outfit";
          ctx.fillText(l.weight, cx, style === "tin" ? 114 : 132);
        } else if (style === "spice") {
          ctx.fillStyle = "#2A2420";
          ctx.fillRect(0, 0, VW, VH);
          ctx.fillStyle = l.tint;
          ctx.fillRect(0, 26, VW, 108);
          ctx.fillStyle = "#FFFFFF";
          ctx.font = "600 13px Outfit";
          ctx.fillText("G R O S H E R", cx, 18);
          ctx.fillStyle = "#FFFFFF";
          const nm = l.name.toUpperCase();
          const size = fit(nm, VW * 0.8, 44, 800, 14);
          ctx.fillText(nm, cx, 80 + size * 0.35);
          ctx.font = "500 14px Outfit";
          ctx.fillText(l.weight, cx, 152);
        } else if (style === "ghee") {
          const g = ctx.createLinearGradient(0, 0, VW, 0);
          g.addColorStop(0, "#B8861E");
          g.addColorStop(0.45, "#F2D27A");
          g.addColorStop(1, "#C8962A");
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, VW, VH);
          ctx.fillStyle = "#4A2A10";
          ctx.font = "700 12px Outfit";
          ctx.fillText("G R O S H E R", cx, 24);
          ctx.fillStyle = "#FFF8E8";
          ctx.beginPath();
          ctx.ellipse(cx, 84, VW * 0.36, 38, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#4A2A10";
          ctx.font = "600 11px Outfit";
          ctx.fillText("PURE", cx, 64);
          const size = fit(l.name, VW * 0.6, 26, 800, 12);
          ctx.fillText(l.name, cx, 92 + size * 0.2);
          ctx.font = "600 16px Outfit";
          ctx.fillText(l.weight, cx, 146);
        }
        ctx.restore();
      });
      tags.forEach((t, i) => {
        const x = (i % 16) * 128;
        const y = LABEL_ROWS * 128 + Math.floor(i / 16) * 32;
        ctx.fillStyle = "#F6F1E7";
        ctx.fillRect(x, y, 128, 32);
        ctx.fillStyle = t.band;
        ctx.fillRect(x, y, 8, 32);
        ctx.fillStyle = ink;
        ctx.textAlign = "center";
        fit(t.name.toUpperCase(), 112, 15, 600, 9);
        ctx.fillText(t.name.toUpperCase(), x + 68, y + 21);
      });
      put("labels", c);
    }
    // ---------------------------------------------------------------- header boards: black, white uppercase
    {
      const c = canvas(1024, 768);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#1C1A18";
      ctx.fillRect(0, 0, 1024, 768);
      headers.forEach((h, i) => {
        const y = i * 80;
        ctx.fillStyle = "#1C1A18";
        ctx.fillRect(0, y, 1024, 80);
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.lineWidth = 2;
        ctx.strokeRect(10, y + 10, 1004, 60);
        ctx.fillStyle = "#F4F1EA";
        ctx.textAlign = "center";
        ctx.font = "600 40px Outfit";
        ctx.letterSpacing = "7px";
        ctx.fillText(h, 512, y + 54);
      });
      put("headers", c);
    }
    // ---------------------------------------------------------------- cutouts: sack stencils, jute fringe, wheat ears (RGBA)
    {
      const [W, H] = [1024, 512];
      const c = canvas(W, H);
      const ctx = c.getContext("2d");
      ctx.clearRect(0, 0, W, H);
      // stencils: a mill's stamp in faded teal ink, a frame round some
      stencils.forEach((rows, i) => {
        const x = i * 256;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, 0, 256, 128);
        ctx.clip();
        ctx.fillStyle = "#2D6670";
        ctx.strokeStyle = "#2D6670";
        ctx.textAlign = "center";
        rows.forEach((t, k) => {
          ctx.font = `${k === 1 ? 800 : 700} ${k === 1 ? 24 : 18}px Outfit`;
          let size = k === 1 ? 24 : 18;
          while (ctx.measureText(t).width > 230 && size > 10) ctx.font = `700 ${--size}px Outfit`;
          ctx.fillText(t, x + 128, 34 + k * 34);
        });
        if (i % 2 === 1) {
          ctx.lineWidth = 3;
          ctx.strokeRect(x + 10, 8, 236, 112);
        }
        // worn ink: knock holes in it
        ctx.globalCompositeOperation = "destination-out";
        for (let k = 0; k < 900; k++) {
          ctx.fillStyle = `rgba(0,0,0,${0.5 + rand() * 0.5})`;
          ctx.fillRect(x + rand() * 256, rand() * 128, 1 + rand() * 3, 1 + rand() * 2);
        }
        ctx.restore();
      });
      // the frayed fringe: loose jute fibres hanging off a rolled rim, tileable along x
      {
        const y0 = 128;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, y0, W, 64);
        ctx.clip();
        for (let k = 0; k < 900; k++) {
          const x = rand() * W;
          const len = 10 + rand() * 46;
          const tone = 170 + rand() * 50;
          ctx.strokeStyle = `rgba(${tone},${tone * 0.92},${tone * 0.76},1)`;
          ctx.lineWidth = 0.8 + rand() * 1.3;
          for (const ox of [0, W, -W]) {
            ctx.beginPath();
            ctx.moveTo(x + ox, y0);
            ctx.bezierCurveTo(x + ox + (rand() - 0.5) * 8, y0 + len * 0.4, x + ox + (rand() - 0.5) * 14, y0 + len * 0.7, x + ox + (rand() - 0.5) * 16, y0 + len);
            ctx.stroke();
          }
        }
        ctx.restore();
      }
      // wheat ears: two rows of spikelets on a rachis, long awns above, a bit of stalk below
      for (let i = 0; i < 8; i++) {
        const x0 = i * 128;
        const y0 = H - 192;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0, 128, 192);
        ctx.clip();
        const cx = x0 + 64 + (rand() - 0.5) * 6;
        const bottom = y0 + 186;
        const earTop = y0 + 70 + rand() * 10;
        const earBottom = y0 + 150;
        const straw = (k) => {
          const t = 196 + k;
          return `rgb(${clamp(t)},${clamp(t * 0.8)},${clamp(t * 0.5)})`;
        };
        ctx.strokeStyle = straw(-10);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx, bottom);
        ctx.lineTo(cx, earTop);
        ctx.stroke();
        const n = 9 + Math.floor(rand() * 3);
        for (let k = 0; k < n; k++) {
          const t = k / (n - 1);
          const y = earBottom - t * (earBottom - earTop);
          for (const side of [-1, 1]) {
            const sx = cx + side * (7 - t * 2);
            const sy = y - (side === 1 ? 4 : 0);
            ctx.fillStyle = straw((rand() - 0.5) * 30);
            ctx.beginPath();
            ctx.ellipse(sx, sy, 5.5 - t * 1.5, 8.5 - t * 2, side * 0.45, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "rgba(120,86,40,0.6)";
            ctx.lineWidth = 0.8;
            ctx.stroke();
            // the awn: a long fine bristle up and out
            ctx.strokeStyle = straw(10);
            ctx.lineWidth = 0.9;
            ctx.beginPath();
            ctx.moveTo(sx, sy - 7);
            ctx.lineTo(sx + side * (8 + rand() * 10), sy - 50 - rand() * 30);
            ctx.stroke();
          }
        }
        ctx.restore();
      }
      out.cutouts = c.toDataURL("image/png");
      out["cutouts.lo"] = half(c).toDataURL("image/png");
    }
    // ---------------------------------------------------------------- the standard close-ups: category labels
    {
      const W = CAT_COLS * CAT_CELL;
      const H = Math.ceil(CATS.length / CAT_COLS) * CAT_CELL;
      const c = canvas(W, H);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#EFE8DA";
      ctx.fillRect(0, 0, W, H);
      const wrapC = (text, max, size, weight = 700) => {
        ctx.font = `${weight} ${size}px Outfit`;
        const out = [];
        let line = "";
        for (const w of text.split(" ")) {
          const t = line ? `${line} ${w}` : w;
          if (ctx.measureText(t).width > max && line) {
            out.push(line);
            line = w;
          } else line = t;
        }
        out.push(line);
        return out;
      };
      CATS.forEach((cat, i) => {
        const x = (i % CAT_COLS) * CAT_CELL;
        const y = Math.floor(i / CAT_COLS) * CAT_CELL;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, CAT_CELL, CAT_CELL);
        ctx.clip();
        // the side strip (x 0–12): the pack's plain colour, its band
        ctx.fillStyle = cat.band;
        ctx.fillRect(x, y, CAT_CELL, CAT_CELL);
        const VH = 160;
        const VW = VH * cat.aspect;
        ctx.translate(x + 12, y);
        ctx.scale(116 / VW, 128 / VH);
        const cx = VW / 2;
        ctx.textAlign = "center";
        // a cream face with the band across the top, the wordmark, the category's name; a few styles differ
        const dark = cat.style === "wine" || cat.style === "frozen";
        ctx.fillStyle = dark ? "#1E2A3A" : "#F7F2E8";
        if (cat.style === "wine") ctx.fillStyle = "#F4ECDD";
        ctx.fillRect(0, 0, VW, VH);
        ctx.fillStyle = cat.band;
        ctx.fillRect(0, 0, VW, Math.max(18, VH * 0.2));
        ctx.fillStyle = "#FFFFFF";
        ctx.font = "700 11px Outfit";
        ctx.fillText("G R O S H E R", cx, Math.max(13, VH * 0.13));
        ctx.fillStyle = cat.style === "frozen" ? "#FFFFFF" : "#2A1A10";
        const size = Math.max(11, Math.min(22, VW / 6));
        const lines = wrapC(cat.name, VW * 0.84, size);
        lines.slice(0, 3).forEach((t, k) => ctx.fillText(t, cx, VH * 0.52 + k * (size + 2) - ((Math.min(3, lines.length) - 1) * (size + 2)) / 2));
        ctx.fillStyle = cat.band;
        ctx.fillRect(VW * 0.2, VH * 0.84, VW * 0.6, 4);
        ctx.restore();
      });
      out.catlabels = c.toDataURL("image/png");
      out["catlabels.lo"] = half(c).toDataURL("image/png");
    }
    // ---------------------------------------------------------------- the standard close-ups: signs
    {
      const c = canvas(1024, 1280);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#1C1A18";
      ctx.fillRect(0, 0, 1024, 1280);
      SIGNS.forEach((t, i) => {
        const x = (i % 2) * 512;
        const y = Math.floor(i / 2) * 64;
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 6, y + 6, 500, 52);
        ctx.fillStyle = "#F4F1EA";
        ctx.textAlign = "center";
        let size = 30;
        ctx.font = `600 ${size}px Outfit`;
        ctx.letterSpacing = "3px";
        while (ctx.measureText(t).width > 470 && size > 14) ctx.font = `600 ${--size}px Outfit`;
        ctx.fillText(t, x + 256, y + 32 + size * 0.36);
      });
      put("signs", c);
    }
    return out;
  },
  { font, labels, tags, headers: HEADERS, GRAIN: GRAIN_SHAPES, STYLE: LABEL_STYLE, ASPECT, LABEL_ATLAS, LABEL_ROWS, stencils: SACK_STENCILS, CATS, SIGNS, CAT_COLS, CAT_CELL },
);
Object.assign(
  images,
  await page.evaluate(`(${drawProduce.toString()})(${JSON.stringify({ font, CHALK_ATLAS, SIGN, SIGNS: signCells(), JUICE_LABEL, JUICE_LABEL_ASPECT, JUICES, HEADER, HEADERS: PRODUCE_HEADERS, PACKS, MOUNDS, FOLIAGE })})`),
);
await browser.close();

// ---------------------------------------------------------------- encode
const KIND = {
  pine: "etc1s", plaster: "etc1s", plaster_n: "normal-etc1s", concrete: "etc1s", burlap: "etc1s", burlap_n: "normal-etc1s",
  terracotta: "etc1s", stone: "etc1s", stone_n: "normal-etc1s", grains: "etc1s", grains_n: "normal-etc1s", labels: "uastc", headers: "uastc", cutouts: "uastc", catlabels: "etc1s", signs: "uastc",
  // Produce's lettering is chalk and big numbers: ETC1S at full quality keeps it (UASTC was 4× the bytes)
  oak: "etc1s", brushed: "etc1s", chalk: "etc1s-hq", packs: "etc1s", mounds: "etc1s", foliage: "etc1s-hq",
};
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const manifest = ONLY ? JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8")).textures : {};
for (const [name, url] of Object.entries(images)) {
  if (ONLY && !ONLY.has(name.replace(/\.lo$/, ""))) continue;
  const png = join(TMP, `${name}.png`);
  writeFileSync(png, Buffer.from(url.split(",")[1], "base64"));
  const base = name.replace(/\.lo$/, "");
  const kind = KIND[base];
  const flags =
    kind === "etc1s" ? ["-q", "190", "-comp_level", "2", "-srgb"] : kind === "etc1s-hq" ? ["-q", "255", "-comp_level", "2", "-srgb"] : kind === "normal-etc1s" ? ["-q", "255", "-comp_level", "2", "-normal_map", "-linear"] : kind === "normal" ? ["-uastc", "-uastc_level", "2", "-uastc_rdo_l", "4.0", "-normal_map", "-linear"] : ["-uastc", "-uastc_level", "2", "-uastc_rdo_l", "0.5", "-srgb"];
  // compressed textures cannot be flipped on upload (three keeps flipY false for them): flip here, so atlas
  // rectangles read the way they do for any other texture (v up from the bottom)
  execFileSync("basisu", ["-ktx2", "-mipmap", "-y_flip", ...flags, "-file", png, "-output_path", OUT], { stdio: "ignore" });
  const file = join(OUT, `${name}.ktx2`);
  const dims = Buffer.from(url.split(",")[1], "base64");
  manifest[name] = { bytes: statSync(file).size, kind, w: dims.readUInt32BE(16), h: dims.readUInt32BE(20) };
}
writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ note: "scripts/gen-hero-textures.mjs; bytes on disk (KTX2, zstd / ETC1S supercompressed)", textures: manifest }, null, 2) + "\n");
// PREVIEW=dir keeps the source PNGs there, to look at
if (process.env.PREVIEW) {
  mkdirSync(process.env.PREVIEW, { recursive: true });
  for (const name of Object.keys(images)) if (!ONLY || ONLY.has(name.replace(/\.lo$/, ""))) writeFileSync(join(process.env.PREVIEW, `${name}.png`), readFileSync(join(TMP, `${name}.png`)));
}
rmSync(TMP, { recursive: true, force: true });
const sum = (tier) => Object.entries(manifest).filter(([n]) => n.endsWith(".lo") === (tier === "lo")).reduce((s, [, m]) => s + m.bytes, 0);
console.log(`wrote ${Object.keys(manifest).length} KTX2 files to ${OUT}: hi ${(sum("hi") / 1024).toFixed(0)} KB, lo ${(sum("lo") / 1024).toFixed(0)} KB`);
for (const [n, m] of Object.entries(manifest)) console.log(`  ${n.padEnd(14)} ${m.kind.padEnd(7)} ${m.w}×${m.h}  ${(m.bytes / 1024).toFixed(0)} KB`);
