// One canvas atlas for every aisle sign, so all signs are a single draw call.

import { CanvasTexture, SRGBColorSpace } from "three";

export interface AtlasCell {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

const COLS = 4;
const ROWS = 16;
const CELL_W = 256;
const CELL_H = 64;

export function buildSignAtlas(labels: string[]): { texture: CanvasTexture; cells: Map<string, AtlasCell> } {
  const canvas = document.createElement("canvas");
  canvas.width = COLS * CELL_W;
  canvas.height = ROWS * CELL_H;
  const ctx = canvas.getContext("2d")!;
  const cells = new Map<string, AtlasCell>();
  labels.slice(0, COLS * ROWS).forEach((label, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = col * CELL_W;
    const y = row * CELL_H;
    ctx.fillStyle = "rgba(10,40,22,0.55)";
    ctx.beginPath();
    ctx.roundRect(x + 2, y + 2, CELL_W - 4, CELL_H - 4, 10);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = `500 ${label.length > 6 ? 30 : 38}px Outfit, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0.08em";
    ctx.fillText(label, x + CELL_W / 2, y + CELL_H / 2 + 1);
    // canvas y grows down, texture v grows up
    cells.set(label, { u0: x / canvas.width, u1: (x + CELL_W) / canvas.width, v0: 1 - (y + CELL_H) / canvas.height, v1: 1 - y / canvas.height });
  });
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, cells };
}
