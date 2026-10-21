// The project page's still placeholders: each <img> of a <picture> still gets a tiny blurred copy of itself as its
// background (24 px wide WebP, a few hundred bytes, inline), so a phone frame is never a blank green block while the
// real image downloads and decodes. Run after the captures:
//
//   node apps/web/scripts/lqip.mjs
//
// It rewrites the style attribute of every <img src="/project/img/<name>-1x.png"> in public/project/index.html.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PAGE = join(import.meta.dirname, "..", "public", "project", "index.html");
const IMG = join(import.meta.dirname, "..", "public", "project", "img");
const tmp = mkdtempSync(join(tmpdir(), "lqip-"));
let html = readFileSync(PAGE, "utf8");
let n = 0;
html = html.replace(/<img src="\/project\/img\/([\w-]+)-1x\.png"([^>]*?)(?: style="[^"]*")?(\s*\/?)>/g, (all, name, rest, end) => {
  const out = join(tmp, `${name}.webp`);
  execFileSync("cwebp", ["-quiet", "-resize", "24", "0", "-q", "30", join(IMG, `${name}-1x.png`), "-o", out]);
  const uri = `data:image/webp;base64,${readFileSync(out).toString("base64")}`;
  n++;
  return `<img src="/project/img/${name}-1x.png"${rest} style="background-image:url(${uri})"${end}>`;
});
writeFileSync(PAGE, html);
console.log(`${n} placeholders, ${Math.round(Buffer.byteLength(html) / 1024)} KB page`);
