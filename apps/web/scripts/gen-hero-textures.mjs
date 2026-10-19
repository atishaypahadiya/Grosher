// Generates the hero zones' textures procedurally and encodes them to KTX2 (Basis Universal), two tiers:
//
//   node apps/web/scripts/gen-hero-textures.mjs        (needs basisu: brew install basis_universal)
//
// Writes apps/web/src/hero/assets/<name>.ktx2 (hi) and <name>.lo.ktx2 (half size) plus manifest.json. The
// files are committed; CI and the app never run this. Everything is drawn on canvases in headless Chromium
// (Outfit for the lettering, loaded from public/fonts), from the zone recipe (src/hero/bulk/recipe.ts) for
// the labels, tags and header boards:
//
//   pine, plaster (+ normal), concrete, burlap (+ normal), terracotta, stone   tileable surfaces
//   grains (+ normal)   4 × 4 atlas of grain shapes, near-white so a bin's tint colours them
//   labels              48 house-brand product labels and 64 bin tags
//   headers             the black header boards with white uppercase lettering
//
// Albedo goes to ETC1S (small, fine for organic surfaces); normal maps and lettering to UASTC with RDO
// (sharp edges, still zstd-supercompressed), except the grains' normals: thousands of tiny domes are noise
// to UASTC (1.1 MB even with RDO), so they go to ETC1S at its best quality (the relief survives, the size
// drops ~8×). sRGB for colour, linear for normals. Mipmapped.

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GRAIN_SHAPES, HEADERS, labelCells } from "../src/hero/bulk/recipe.ts";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "src", "hero", "assets");
const TMP = join(ROOT, ".hero-tex-tmp");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
mkdirSync(OUT, { recursive: true });

const font = readFileSync(join(ROOT, "public", "fonts", "outfit-latin.woff2")).toString("base64");
const { labels, tags } = labelCells();

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<!doctype html><html><body></body></html>");
const images = await page.evaluate(
  async ({ font, labels, tags, headers, shapes }) => {
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
    // ---------------------------------------------------------------- clay plaster: warm, matte, trowelled
    {
      const big = fbm([[3, 1], [8, 0.6], [24, 0.3]]);
      const fine = fbm([[96, 1], [256, 0.8]]);
      const hgt = new Float32Array(512 * 512);
      put("plaster", paint(512, 512, (u, v, x, y) => {
        const b = big(u, v);
        const f = fine(u, v);
        hgt[y * 512 + x] = b * 0.6 + f * 0.4;
        const l = (b - 0.5) * 30 + (f - 0.5) * 10;
        return [clamp(198 + l), clamp(162 + l * 0.9), clamp(128 + l * 0.8)];
      }));
      put("plaster_n", normalFrom(512, hgt, 512, 3.2));
    }
    // ---------------------------------------------------------------- polished concrete: warm, clouded, flecked
    {
      const cloud = fbm([[3, 1], [9, 0.5], [27, 0.25]]);
      const c = paint(512, 512, (u, v) => {
        const l = (cloud(u, v) - 0.5) * 34;
        return [clamp(178 + l), clamp(163 + l * 0.95), clamp(146 + l * 0.9)];
      });
      const ctx = c.getContext("2d");
      for (let i = 0; i < 2600; i++) {
        const x = rand() * 512;
        const y = rand() * 512;
        const r = 0.6 + rand() * 1.6;
        const d = rand() < 0.5;
        ctx.fillStyle = d ? `rgba(90,78,66,${0.25 + rand() * 0.35})` : `rgba(236,226,212,${0.25 + rand() * 0.35})`;
        for (const [ox, oy] of [[0, 0], [512, 0], [-512, 0], [0, 512], [0, -512]]) {
          ctx.beginPath();
          ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      put("concrete", c);
    }
    // ---------------------------------------------------------------- burlap: a loose plain weave
    {
      const n = fbm([[32, 1], [128, 0.7]]);
      const hgt = new Float32Array(512 * 512);
      const T = 16; // px a thread pitch (32 threads over the tile)
      put("burlap", paint(512, 512, (u, v, x, y) => {
        const cx = (x % T) / T;
        const cy = (y % T) / T;
        const overX = (Math.floor(x / T) + Math.floor(y / T)) % 2 === 0;
        const warpThread = Math.sin(cx * Math.PI); // across the vertical thread
        const weftThread = Math.sin(cy * Math.PI);
        const h = overX ? Math.max(weftThread * 0.9, warpThread * 0.6) : Math.max(warpThread * 0.9, weftThread * 0.6);
        const gap = Math.min(warpThread, weftThread) < 0.12 && Math.max(warpThread, weftThread) < 0.5;
        const fuzz = n(u, v);
        hgt[y * 512 + x] = gap ? 0 : h * 0.8 + fuzz * 0.2;
        const l = (h - 0.6) * 40 + (fuzz - 0.5) * 30 - (gap ? 60 : 0);
        return [clamp(178 + l), clamp(142 + l * 0.9), clamp(94 + l * 0.75)];
      }));
      put("burlap_n", normalFrom(512, hgt, 512, 4));
    }
    // ---------------------------------------------------------------- terracotta: fired clay with throwing rings
    {
      const n = fbm([[8, 1], [64, 0.5]]);
      put("terracotta", paint(256, 256, (u, v) => {
        const ring = Math.sin(v * Math.PI * 2 * 28) * 6;
        const l = (n(u, v) - 0.5) * 30 + ring;
        return [clamp(186 + l), clamp(100 + l * 0.7), clamp(62 + l * 0.5)];
      }));
    }
    // ---------------------------------------------------------------- stone: a grey granite for the chakki
    {
      const n = fbm([[16, 1], [64, 0.8], [256, 0.6]]);
      put("stone", paint(256, 256, (u, v) => {
        const f = n(u, v);
        const fleck = f > 0.62 ? 30 : f < 0.36 ? -34 : 0;
        const l = (f - 0.5) * 40 + fleck;
        return [clamp(132 + l), clamp(126 + l), clamp(118 + l)];
      }));
    }
    // ---------------------------------------------------------------- grains: 4 × 4 cells of 256 px, near-white
    {
      const S = 1024;
      const C = 256;
      const alb = canvas(S, S);
      const hc = canvas(S, S);
      const a = alb.getContext("2d");
      const hctx = hc.getContext("2d");
      a.fillStyle = "#5a5652";
      a.fillRect(0, 0, S, S);
      hctx.fillStyle = "#000";
      hctx.fillRect(0, 0, S, S);
      hctx.globalCompositeOperation = "lighten";
      const spec = {
        round: { n: 900, rx: 6, ry: 6 },
        roundBig: { n: 260, rx: 11, ry: 10 },
        split: { n: 700, rx: 7, ry: 6, flat: true },
        kidney: { n: 330, rx: 13, ry: 7, notch: true },
        long: { n: 700, rx: 13, ry: 3.4 },
        short: { n: 900, rx: 8, ry: 4 },
        tiny: { n: 2600, rx: 2.6, ry: 2.4 },
        flake: { n: 420, rx: 10, ry: 7, flake: true },
        powder: { n: 0 },
        granular: { n: 9000, rx: 1.3, ry: 1.2 },
        oval: { n: 340, rx: 13, ry: 8 },
        crescent: { n: 380, rx: 12, ry: 8, crescent: true },
        blob: { n: 400, rx: 10, ry: 8, wrinkle: true },
        drop: { n: 650, rx: 5.5, ry: 5.5 },
        bean: { n: 340, rx: 10, ry: 7.5, crease: true },
        cluster: { n: 360, rx: 9, ry: 7, flake: true, mixed: true },
      };
      shapes.forEach((shape, idx) => {
        const ox = (idx % 4) * C;
        const oy = Math.floor(idx / 4) * C;
        const p = spec[shape];
        a.save();
        hctx.save();
        a.beginPath();
        a.rect(ox, oy, C, C);
        a.clip();
        hctx.beginPath();
        hctx.rect(ox, oy, C, C);
        hctx.clip();
        if (shape === "powder") {
          // soft mounds and a fine speckle, no grains
          const m = fbm([[6, 1], [24, 0.5], [96, 0.35]]);
          for (let y = 0; y < C; y += 2)
            for (let x = 0; x < C; x += 2) {
              const h = m(x / C, y / C);
              const l = Math.round(205 + (h - 0.5) * 70 + (rand() - 0.5) * 22);
              a.fillStyle = `rgb(${l},${l},${l})`;
              a.fillRect(ox + x, oy + y, 2, 2);
              const g = Math.round(h * 255);
              hctx.fillStyle = `rgb(${g},${g},${g})`;
              hctx.fillRect(ox + x, oy + y, 2, 2);
            }
        } else {
          for (let i = 0; i < p.n; i++) {
            const cx = ox + rand() * C;
            const cy = oy + rand() * C;
            const rot = rand() * Math.PI;
            const s = 0.82 + rand() * 0.36;
            const rx = p.rx * s;
            const ry = p.ry * s;
            // brightness varies grain to grain, never hue: the bin's tint is the colour
            const lum = 232 + (rand() - 0.5) * 34;
            const base = p.mixed ? [[226, 196, 140], [180, 120, 70], [240, 228, 200], [120, 70, 40], [200, 60, 60]][Math.floor(rand() * 5)] : [lum, lum, lum];
            for (const [dx, dy] of [[0, 0], [C, 0], [-C, 0], [0, C], [0, -C]]) {
              const x = cx + dx;
              const y = cy + dy;
              // albedo: a lit dome, darker at the rim (the grain's own shading), a highlight up-left
              const g = a.createRadialGradient(x - rx * 0.3, y - ry * 0.35, 0, x, y, Math.max(rx, ry));
              const [r, gg, b] = base.map((c) => clamp(c));
              g.addColorStop(0, `rgb(${clamp(r + 20)},${clamp(gg + 20)},${clamp(b + 20)})`);
              g.addColorStop(0.55, `rgb(${r},${gg},${b})`);
              g.addColorStop(1, `rgb(${clamp(r * 0.62)},${clamp(gg * 0.62)},${clamp(b * 0.62)})`);
              a.fillStyle = g;
              a.beginPath();
              if (p.flake) {
                for (let k = 0; k < 7; k++) {
                  const ang = rot + (k / 7) * Math.PI * 2;
                  const rr = (0.7 + rand() * 0.5) * (k % 2 ? rx : ry);
                  if (k === 0) a.moveTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
                  else a.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
                }
                a.closePath();
              } else if (p.crescent) {
                // a cashew: a fat curved kidney, the inner edge a shallower arc
                a.ellipse(x, y, rx, ry, rot, 0, Math.PI);
                a.ellipse(x, y + Math.cos(rot) * ry * 0.15, rx * 0.55, ry * 0.45, rot, Math.PI, 0, true);
                a.closePath();
              } else a.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
              a.fill();
              if (p.flat) {
                a.strokeStyle = "rgba(255,255,255,0.35)";
                a.lineWidth = 1;
                a.beginPath();
                a.ellipse(x, y, rx * 0.7, ry * 0.7, rot, 0, Math.PI * 2);
                a.stroke();
              }
              if (p.notch || p.crease || p.wrinkle) {
                a.strokeStyle = "rgba(40,30,25,0.55)";
                a.lineWidth = p.wrinkle ? 1 : 1.4;
                a.beginPath();
                if (p.wrinkle) {
                  for (let k = 0; k < 3; k++) {
                    const t = rot + rand() * Math.PI;
                    a.moveTo(x + Math.cos(t) * rx * 0.6, y + Math.sin(t) * ry * 0.6);
                    a.quadraticCurveTo(x, y, x - Math.cos(t + 0.6) * rx * 0.5, y - Math.sin(t + 0.6) * ry * 0.5);
                  }
                } else {
                  a.moveTo(x - Math.cos(rot) * rx * 0.7, y - Math.sin(rot) * rx * 0.7);
                  a.lineTo(x + Math.cos(rot) * rx * 0.7, y + Math.sin(rot) * rx * 0.7);
                }
                a.stroke();
              }
              // height: a dome
              const hg = hctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
              hg.addColorStop(0, "#fff");
              hg.addColorStop(1, "#000");
              hctx.fillStyle = hg;
              hctx.beginPath();
              hctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
              hctx.fill();
            }
          }
        }
        a.restore();
        hctx.restore();
      });
      put("grains", alb);
      put("grains_n", normalFrom(S, heightOf(hc), S, 5, C));
    }
    // ---------------------------------------------------------------- labels: 48 house-brand labels + 64 bin tags
    {
      const S = 1024;
      const c = canvas(S, S);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#e9dfcf";
      ctx.fillRect(0, 0, S, S);
      const kraftNoise = fbm([[16, 1], [64, 0.8], [128, 0.5]]);
      const kraft = paint(128, 128, (u, v) => {
        const l = (kraftNoise(u, v) - 0.5) * 30;
        return [clamp(186 + l), clamp(146 + l * 0.9), clamp(98 + l * 0.8)];
      });
      const wrap = (text, max, size, weight = 600) => {
        ctx.font = `${weight} ${size}px Outfit`;
        const words = text.split(" ");
        const lines = [];
        let line = "";
        for (const w of words) {
          const t = line ? `${line} ${w}` : w;
          if (ctx.measureText(t).width > max && line) {
            lines.push(line);
            line = w;
          } else line = t;
        }
        lines.push(line);
        return lines;
      };
      const ink = "#2A1A10";
      labels.forEach((l, i) => {
        const x = (i % 8) * 128;
        const y = Math.floor(i / 8) * 128;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, 128, 128);
        ctx.clip();
        // the side strip, x 0–12: what the pack's sides, back and top show
        if (l.kind === "kraft") ctx.drawImage(kraft, x, y);
        else {
          ctx.fillStyle = l.kind === "tin" ? l.band : "#F2EADB";
          ctx.fillRect(x, y, 128, 128);
        }
        ctx.fillStyle = l.kind === "kraft" ? "rgba(0,0,0,0)" : l.band;
        ctx.fillRect(x, y, 12, 128);
        const fx = x + 12;
        const fw = 116;
        if (l.kind === "kraft") {
          ctx.fillStyle = "rgba(42,26,16,0.75)";
          ctx.font = "600 10px Outfit";
          ctx.textAlign = "center";
          ctx.fillText("G R O S H E R", fx + fw / 2, y + 20);
          ctx.fillStyle = "#F7F1E6";
          ctx.fillRect(fx + 10, y + 32, fw - 20, 70);
          ctx.fillStyle = l.band;
          ctx.fillRect(fx + 10, y + 32, fw - 20, 8);
          ctx.fillStyle = ink;
          const lines = wrap(l.name, fw - 28, 15);
          lines.forEach((t, k) => ctx.fillText(t, fx + fw / 2, y + 60 + k * 16 - (lines.length - 1) * 8));
          ctx.font = "500 10px Outfit";
          ctx.fillText(l.weight, fx + fw / 2, y + 96);
        } else if (l.kind === "tin") {
          ctx.fillStyle = "rgba(255,255,255,0.9)";
          ctx.font = "600 10px Outfit";
          ctx.textAlign = "center";
          ctx.fillText("G R O S H E R", fx + fw / 2, y + 24);
          ctx.fillStyle = "#F7F1E6";
          ctx.fillRect(fx, y + 40, fw, 48);
          ctx.fillStyle = ink;
          const lines = wrap(l.name, fw - 16, 15);
          lines.forEach((t, k) => ctx.fillText(t, fx + fw / 2, y + 66 + k * 16 - (lines.length - 1) * 8));
          ctx.fillStyle = "rgba(255,255,255,0.9)";
          ctx.font = "500 11px Outfit";
          ctx.fillText(l.weight, fx + fw / 2, y + 110);
        } else {
          // pouch and jar: cream with the section's band, the wordmark on the band
          ctx.fillStyle = l.band;
          ctx.fillRect(fx, y, fw, l.kind === "jar" ? 18 : 26);
          if (l.kind === "jar") ctx.fillRect(fx, y + 110, fw, 18);
          ctx.fillStyle = "#FFFFFF";
          ctx.font = "600 10px Outfit";
          ctx.textAlign = "center";
          ctx.fillText("G R O S H E R", fx + fw / 2, y + (l.kind === "jar" ? 13 : 17));
          ctx.fillStyle = ink;
          const lines = wrap(l.name, fw - 14, 17);
          lines.forEach((t, k) => ctx.fillText(t, fx + fw / 2, y + 68 + k * 18 - (lines.length - 1) * 9));
          // a small grain emblem: three dots in the band colour
          ctx.fillStyle = l.band;
          for (let k = -1; k <= 1; k++) {
            ctx.beginPath();
            ctx.arc(fx + fw / 2 + k * 9, y + 40, 3.2, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = ink;
          ctx.font = "500 11px Outfit";
          ctx.fillText(l.weight, fx + fw / 2, y + (l.kind === "jar" ? 102 : 112));
        }
        ctx.restore();
      });
      tags.forEach((t, i) => {
        const x = (i % 8) * 128;
        const y = 768 + Math.floor(i / 8) * 32;
        ctx.fillStyle = "#F6F1E7";
        ctx.fillRect(x, y, 128, 32);
        ctx.fillStyle = t.band;
        ctx.fillRect(x, y, 8, 32);
        ctx.fillStyle = ink;
        ctx.textAlign = "center";
        let size = 15;
        ctx.font = `600 ${size}px Outfit`;
        while (ctx.measureText(t.name.toUpperCase()).width > 112 && size > 9) ctx.font = `600 ${--size}px Outfit`;
        ctx.fillText(t.name.toUpperCase(), x + 68, y + 21);
      });
      put("labels", c);
    }
    // ---------------------------------------------------------------- header boards: black, white uppercase
    {
      const c = canvas(1024, 512);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#1C1A18";
      ctx.fillRect(0, 0, 1024, 512);
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
    return out;
  },
  { font, labels, tags, headers: HEADERS, shapes: [...GRAIN_SHAPES] },
);
await browser.close();

// ---------------------------------------------------------------- encode
const KIND = {
  pine: "etc1s", plaster: "etc1s", plaster_n: "normal", concrete: "etc1s", burlap: "etc1s", burlap_n: "normal",
  terracotta: "etc1s", stone: "etc1s", grains: "etc1s", grains_n: "normal-etc1s", labels: "uastc", headers: "uastc",
};
const manifest = {};
for (const [name, url] of Object.entries(images)) {
  const png = join(TMP, `${name}.png`);
  writeFileSync(png, Buffer.from(url.split(",")[1], "base64"));
  const base = name.replace(/\.lo$/, "");
  const kind = KIND[base];
  const flags =
    kind === "etc1s" ? ["-q", "190", "-comp_level", "2", "-srgb"] : kind === "normal-etc1s" ? ["-q", "255", "-comp_level", "2", "-normal_map", "-linear"] : kind === "normal" ? ["-uastc", "-uastc_level", "2", "-uastc_rdo_l", "4.0", "-normal_map", "-linear"] : ["-uastc", "-uastc_level", "2", "-uastc_rdo_l", "0.5", "-srgb"];
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
  for (const name of Object.keys(images)) writeFileSync(join(process.env.PREVIEW, `${name}.png`), readFileSync(join(TMP, `${name}.png`)));
}
rmSync(TMP, { recursive: true, force: true });
const sum = (tier) => Object.entries(manifest).filter(([n]) => n.endsWith(".lo") === (tier === "lo")).reduce((s, [, m]) => s + m.bytes, 0);
console.log(`wrote ${Object.keys(manifest).length} KTX2 files to ${OUT}: hi ${(sum("hi") / 1024).toFixed(0)} KB, lo ${(sum("lo") / 1024).toFixed(0)} KB`);
for (const [n, m] of Object.entries(manifest)) console.log(`  ${n.padEnd(14)} ${m.kind.padEnd(7)} ${m.w}×${m.h}  ${(m.bytes / 1024).toFixed(0)} KB`);
