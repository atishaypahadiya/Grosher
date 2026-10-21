// The numbers the README and the project page cite, checked against what the gates measured (CI runs this
// after them). A cited number carries its key:
//
//   README.md                         <!--n:perf.calls-->48<!--/n-->            (an HTML comment, invisible on GitHub)
//   apps/web/public/project/index.html <span class="num" data-n="perf.calls">48</span>
//                                     <i data-bar="perf.calls/70" style="width:68.6%"></i>   (a budget bar)
//
// The values come from the gates' --json files in one directory (default apps/web/.numbers):
//   perf.json      scripts/perf-gate.mjs --json            closeup.json   scripts/hero-gate.mjs --json
//   bench.json     packages/core bench --store grosher --json
//   eval-grosher.json / eval-demo.json   packages/stores eval:everyday --offline [--store grosher] --json
// plus the hero-route snapshot packages/stores/test/fixtures/grosher-hero-routes.json (the stores test keeps it
// current), cook mode's dish table and its recorded model answers (packages/stores: src/meals, test/fixtures/
// dishes-model.json, as CI's test scores them), and capture.json (the trip the share card shows, apps/web/scripts/capture-project.mjs). Timings vary
// run to run and from machine to machine: most are cited with their date, unkeyed; the one keyed (the solver's
// 30-stop median, `timing` below) is checked within ±35% on the machine the docs name (an Apple-silicon Mac) and
// skipped on CI's, whose processors are slower.
//
// Some numbers are CI's own: the close-up gate's texture megabytes and download kilobytes come out larger on
// CI's renderer and build than on a Mac (`ci: true` below). Off CI they are skipped, unless the directory came
// from a CI run (gh run download <run> -n docs-numbers -D <dir>), which `--ci` says.
//
//   node apps/web/scripts/docs-numbers.mjs [--dir d] [--ci]           check: exit 1 on any difference
//   node apps/web/scripts/docs-numbers.mjs [--dir d] [--ci] --write   rewrite the docs from the measurements
//   node apps/web/scripts/docs-numbers.mjs --run                      run the gates' cheap sources first (bench, eval)

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const DIR = arg("--dir") ?? join(ROOT, "apps", "web", ".numbers");
const WRITE = process.argv.includes("--write");
const ON_CI = !!process.env.CI || process.argv.includes("--ci");
const DOCS = { readme: join(ROOT, "README.md"), page: join(ROOT, "apps", "web", "public", "project", "index.html") };

if (process.argv.includes("--run")) {
  mkdirSync(DIR, { recursive: true });
  const run = (cwd, args) => execFileSync("node", args, { cwd: join(ROOT, cwd), stdio: ["ignore", "ignore", "inherit"] });
  run("packages/core", ["bench/bench.ts", "--store", "grosher", "--json", join(DIR, "bench.json")]);
  run("packages/stores", ["scripts/eval-everyday.ts", "--offline", "--store", "grosher", "--json", join(DIR, "eval-grosher.json")]);
  run("packages/stores", ["scripts/eval-everyday.ts", "--offline", "--json", join(DIR, "eval-demo.json")]);
}

const read = (f) => (existsSync(join(DIR, f)) ? JSON.parse(readFileSync(join(DIR, f), "utf8")) : null);
const src = {
  perf: read("perf.json"),
  closeup: read("closeup.json"),
  bench: read("bench.json"),
  grosher: read("eval-grosher.json"),
  demo: read("eval-demo.json"),
  routes: JSON.parse(readFileSync(join(ROOT, "packages", "stores", "test", "fixtures", "grosher-hero-routes.json"), "utf8")),
  capture: JSON.parse(readFileSync(join(ROOT, "apps", "web", "public", "project", "capture.json"), "utf8")),
  meals: await mealsNumbers(),
};

/** cook mode: the dish table (packages/stores/src/meals) and the local model's recorded answers for the ten unseen
 *  dishes (packages/stores/test/fixtures/dishes-model.json, scored by test/dish-score.ts as CI scores it) */
async function mealsNumbers() {
  const stores = join(ROOT, "packages", "stores");
  const { DISHES } = await import(join(stores, "src", "meals", "index.ts"));
  const { scoreRecording } = await import(join(stores, "test", "dish-score.ts"));
  const rec = JSON.parse(readFileSync(join(stores, "test", "fixtures", "dishes-model.json"), "utf8"));
  const score = scoreRecording(rec);
  const secs = rec.calls.map((c) => c.ms / 1000);
  return { dishes: DISHES.length, indian: DISHES.filter((d) => d.cuisine === "indian").length, unseen: rec.calls.length, core: score.coreFound, coreTotal: score.coreTotal, minS: Math.min(...secs), maxS: Math.max(...secs), totalS: rec.totalMs / 1000 };
}
const REFERENCE_MACHINE = process.platform === "darwin" && process.arch === "arm64";

const int = (v) => v.toLocaleString("en-US");
const k = (v) => `${Math.round(v / 1000)}k`;
const mb = (v) => v.toFixed(1);
const row = (view) => {
  const r = src.closeup?.rows.find((x) => x.view === view);
  if (!r) throw new Error(`no close-up gate row "${view}"`);
  return r;
};
const benchRow = (n) => {
  const r = src.bench?.rows.find((x) => x.stops === n);
  if (!r) throw new Error(`no bench row for ${n} stops`);
  return r;
};

/** key → [source, value(), format, ci-only? | "timing"] */
const KEYS = {
  "perf.calls": ["perf", () => Math.max(...src.perf.rows.map((r) => r.calls)), int],
  "perf.instances": ["perf", () => Math.max(...src.perf.rows.map((r) => r.instances)), int],
  "closeup.calls": ["closeup", () => Math.max(...src.closeup.rows.map((r) => r.calls)), int],
  "closeup.triangles": ["closeup", () => Math.max(...src.closeup.rows.map((r) => r.triangles)), k],
  "closeup.bulk.calls": ["closeup", () => row("Bulk: arriving (worst frame)").calls, int],
  "closeup.bulk.triangles": ["closeup", () => row("Bulk: arriving (worst frame)").triangles, k],
  "closeup.produce.calls": ["closeup", () => row("Produce island: arriving (worst frame)").calls, int],
  "closeup.produce.triangles": ["closeup", () => row("Produce island: arriving (worst frame)").triangles, k],
  "closeup.standard.calls": ["closeup", () => row("standard A4-R16: arriving (worst frame)").calls, int],
  "closeup.standard.triangles": ["closeup", () => row("standard A4-R16: arriving (worst frame)").triangles, k],
  "closeup.bulkEye.calls": ["closeup", () => row("Bulk: eye level").calls, int],
  "closeup.bulkEye.triangles": ["closeup", () => row("Bulk: eye level").triangles, k],
  "closeup.wetWall.calls": ["closeup", () => row("Produce: the wet wall").calls, int],
  "closeup.wetWall.triangles": ["closeup", () => row("Produce: the wet wall").triangles, k],
  "closeup.peakMB": ["closeup", () => src.closeup.combined.peakMB, mb, true],
  "closeup.download.bulk": ["closeup", () => src.closeup.downloadKB.Bulk, int, true],
  "closeup.download.standard": ["closeup", () => src.closeup.downloadKB.standard, int, true],
  "closeup.download.produce": ["closeup", () => src.closeup.downloadKB.Produce, int, true],
  "eval.grosher.correct": ["grosher", () => src.grosher.everyday.correct, int],
  "eval.grosher.total": ["grosher", () => src.grosher.everyday.total, int],
  "eval.grosher.pct": ["grosher", () => Math.round((100 * src.grosher.everyday.correct) / src.grosher.everyday.total), int],
  "eval.demo.correct": ["demo", () => src.demo.everyday.correct, int],
  "eval.demo.pct": ["demo", () => Math.round((100 * src.demo.everyday.correct) / src.demo.everyday.total), int],
  "eval.newShelves.grosher": ["grosher", () => src.grosher.newShelves.grosher, int],
  "eval.newShelves.demo": ["grosher", () => src.grosher.newShelves["demo-supercenter"], int],
  "bench.30.p50ms": ["bench", () => benchRow(30).p50ms, (v) => String(Math.round(v)), "timing"],
  "card.day": ["capture", () => src.capture.card.eyebrows[1], (v) => v],
  "card.clock": ["capture", () => src.capture.card.clock, (v) => v],
  "card.sub": ["capture", () => src.capture.card.sub, (v) => v],
  "card.walked": ["capture", () => src.capture.card.tiles[0].value, (v) => v],
  "card.walkedCaption": ["capture", () => src.capture.card.tiles[0].caption, (v) => v],
  "card.saved": ["capture", () => src.capture.card.tiles[1].value, (v) => v],
  "card.savedCaption": ["capture", () => src.capture.card.tiles[1].caption, (v) => v],
  "meals.dishes": ["meals", () => src.meals.dishes, int],
  "meals.indian": ["meals", () => src.meals.indian, int],
  "meals.unseen": ["meals", () => src.meals.unseen, int],
  "meals.core": ["meals", () => src.meals.core, int],
  "meals.coreTotal": ["meals", () => src.meals.coreTotal, int],
  "meals.minS": ["meals", () => src.meals.minS, (v) => v.toFixed(1)],
  "meals.maxS": ["meals", () => src.meals.maxS, (v) => v.toFixed(1)],
  "meals.totalS": ["meals", () => src.meals.totalS, (v) => String(Math.round(v))],
  "bench.range14.p10": ["bench", () => src.bench.range14.p10, int],
  "bench.range14.p90": ["bench", () => src.bench.range14.p90, int],
};
for (const kind of ["food", "brand", "household", "pharmacy", "indian", "typo"]) {
  KEYS[`eval.kind.${kind}.total`] = ["grosher", () => src.grosher.everyday.byKind[kind].total, int];
  KEYS[`eval.kind.${kind}.correct`] = ["grosher", () => src.grosher.everyday.byKind[kind].correct, int];
}
for (const n of [5, 8, 10, 12, 13, 18, 25, 30])
  for (const f of ["listOrderM", "routeM", "savedPct", "p10", "p90"]) KEYS[`bench.${n}.${f}`] = ["bench", () => benchRow(n)[f], int];
for (const id of Object.keys(src.routes))
  for (const f of ["listOrderM", "routeM", "savedPct"]) KEYS[`routes.${id}.${f}`] = ["routes", () => src.routes[id][f], int];

/** the value a key should read, or why it cannot be checked here */
function expected(key) {
  const def = KEYS[key];
  if (!def) return { error: `unknown key` };
  const [from, value, format, kind] = def;
  if (!src[from]) return { skip: `no ${from} measurement in ${DIR}` };
  if (kind === true && !ON_CI) return { skip: "CI's own number (pass --ci with a CI run's files)" };
  if (kind === "timing" && (process.env.CI || !REFERENCE_MACHINE)) return { skip: "a timing, checked on the machine the docs name (an Apple-silicon Mac)", timing: true };
  try {
    const v = value();
    return { text: format(v), value: v, timing: kind === "timing" };
  } catch (e) {
    return { error: e.message };
  }
}

const problems = [];
const skipped = new Set();
let checked = 0;
const timingsSkipped = new Set();
const look = (doc, key, got, fix) => {
  const e = expected(key);
  if (e.skip && e.timing) return timingsSkipped.add(`${key}: ${e.skip}`), got;
  if (e.skip) return skipped.add(`${key}: ${e.skip}`), got;
  if (e.error) return problems.push(`${doc}: ${key}: ${e.error}`), got;
  checked++;
  if (got === e.text) return got;
  // a timing passes within ±35% of this run's measurement
  if (e.timing && Math.abs(Number(got) - e.value) <= 0.35 * e.value) return got;
  if (!WRITE) problems.push(`${doc}: ${key} reads ${got}, the gate measured ${e.text}`);
  return fix(e);
};

let readme = readFileSync(DOCS.readme, "utf8");
readme = readme.replace(/<!--n:([\w.-]+)-->(.*?)<!--\/n-->/g, (all, key, got) => `<!--n:${key}-->${look("README.md", key, got, (e) => e.text)}<!--/n-->`);
let page = readFileSync(DOCS.page, "utf8");
page = page.replace(/(<(\w+)[^>]*\bdata-n="([\w.-]+)"[^>]*>)([^<]*)(<\/\2>)/g, (all, open, tag, key, got, close) => `${open}${look("project page", key, got, (e) => e.text)}${close}`);
page = page.replace(/<i([^>]*)\bdata-bar="([\w.-]+)\/(\d+)"([^>]*)style="width:([\d.]+)%"/g, (all, a, key, budget, b, width) => {
  const e = expected(key);
  if (e.skip || e.error) return look("project page", key, width, () => width), all;
  const want = String(Number(((100 * e.value) / Number(budget)).toFixed(1)));
  checked++;
  if (width === want) return all;
  if (!WRITE) problems.push(`project page: the ${key} bar is ${width}% wide, ${e.text} of ${budget} is ${want}%`);
  return `<i${a}data-bar="${key}/${budget}"${b}style="width:${want}%"`;
});

if (WRITE) {
  writeFileSync(DOCS.readme, readme);
  writeFileSync(DOCS.page, page);
}
const keyed = (readme.match(/<!--n:/g) ?? []).length + (page.match(/data-(n|bar)="/g) ?? []).length;
console.log(`docs numbers: ${checked} checked of ${keyed} keyed${skipped.size ? `, ${skipped.size} skipped` : ""}${WRITE ? " (written)" : ""}`);
for (const s of skipped) console.log(`  skipped ${s}`);
for (const s of timingsSkipped) console.log(`  not checked here: ${s}`);
if (problems.length) {
  console.error(`docs numbers FAILED: the docs cite what the gates did not measure\n  ${problems.join("\n  ")}`);
  console.error("Fix: node apps/web/scripts/docs-numbers.mjs --write (with --dir from `gh run download <run> -n docs-numbers` and --ci for CI's own numbers)");
  process.exit(1);
}
if (ON_CI && skipped.size) {
  console.error("docs numbers FAILED: on CI every keyed number must be checked");
  process.exit(1);
}
