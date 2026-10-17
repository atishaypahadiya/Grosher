// @vitest-environment node
// The production bundle must never contain an Anthropic key. The resolver
// worker holds it; the client only knows the worker's URL.
import { describe, expect, test } from "vitest";
import { build } from "vite";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("bundle", () => {
  test("contains no sk-ant key", { timeout: 120_000 }, async () => {
    const out = mkdtempSync(join(tmpdir(), "grosher-dist-"));
    await build({ root: process.cwd(), logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
    const files = walk(out).filter((f) => /\.(js|css|html|json|webmanifest)$/.test(f));
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/sk-ant/);
  });
});
