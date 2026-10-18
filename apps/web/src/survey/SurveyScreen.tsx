// Survey mode (#/survey, DESIGN.md §5 Survey): map a store in one walk with one thumb. Cream like the editor,
// every control at the bottom of the screen, numbers in Doto. Calibrate once at home, then: Entrance, and per
// aisle Sign photo → Start → walk → End (tags on the way), pins for landmarks, Undo for any slip. Photos are
// read in the background (signQueue.ts); "Build draft map" derives the store and opens it in the editor.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { StoreBundle } from "@grosher/stores";
import { Num } from "../components/Num.tsx";
import { IconArrowLeft, IconCheck, IconClose } from "../components/Icons.tsx";
import { signReaderFor } from "../lib/resolver.ts";
import { loadSettings } from "../lib/settings.ts";
import { buildDraft, derive, type BuildReport } from "./derive.ts";
import {
  addPhoto,
  describeAction,
  dropPin,
  endAisle,
  newSurvey,
  phaseOf,
  PIN_LABELS,
  startAisle,
  stepsBetween,
  tagAisle,
  tapEntrance,
  uid,
  undo,
  updatePhoto,
  type Calibration,
  type PinLabel,
  type Survey,
  type SurveyAction,
  type SurveyEvent,
} from "./model.ts";
import { downscale, savePhoto } from "./photos.ts";
import { requestSensors, startSensors, type SensorStream } from "./sensors.ts";
import { nextToRead, photoStatus, readPhoto } from "./signQueue.ts";
import { activeStoreId, importSurvey, loadCalibration, loadSurvey, saveBuiltDraft, saveCalibration, saveSurvey, setActiveStoreId, shareOrDownload, surveyFile } from "./store.ts";

type View = "home" | "calibrate" | "walk" | "built";
const CAL_DISTANCE_M = 10;
/** no accelerometer sample this long after starting: the phone has no motion sensor here, so time the legs */
const MOTION_GRACE_MS = 2500;

const DEFAULT_STORE = { name: "Walmart Story Rd #5435", storeId: "walmart-5435", address: "Story Rd · San José" };
const fmtM = (m: number) => (m < 10 ? m.toFixed(1) : String(Math.round(m)));
const fmtDay = (t: number) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

export function SurveyScreen({ bundle, onExit }: { bundle: StoreBundle; onExit: () => void }) {
  const [view, setView] = useState<View>("home");
  const [calibration, setCalibration] = useState<Calibration | null>(loadCalibration);
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [form, setForm] = useState(DEFAULT_STORE);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [built, setBuilt] = useState<BuildReport | null>(null);

  // the survey of the last store surveyed on this phone
  useEffect(() => {
    const id = activeStoreId();
    (id ? loadSurvey(id) : Promise.resolve(null)).then((s) => {
      if (s) {
        setSurvey(s);
        setForm({ name: s.name, storeId: s.storeId, address: s.address ?? "" });
      }
      setLoaded(true);
    });
  }, []);
  // autosave, a little behind the taps and steps
  useEffect(() => {
    if (!survey) return;
    const t = setTimeout(() => void saveSurvey(survey), 600);
    return () => clearTimeout(t);
  }, [survey]);

  const say = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice((n) => (n === text ? null : n)), 3500);
  };

  // ---- sign reading, in the background whenever online
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [kick, setKick] = useState(0);
  const busy = useRef(false);
  const reader = useMemo(() => signReaderFor(loadSettings()), []);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const tick = setInterval(() => setKick((k) => k + 1), 5000);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      clearInterval(tick);
    };
  }, []);
  useEffect(() => {
    if (!survey || busy.current || !online) return;
    const p = nextToRead(survey.photos, Date.now());
    if (!p) return;
    busy.current = true;
    setSurvey((s) => s && updatePhoto(s, p.id, { status: "reading" }));
    readPhoto(p, reader, bundle.categories)
      .then((patch) => setSurvey((s) => s && updatePhoto(s, p.id, patch)))
      .finally(() => {
        busy.current = false;
        setKick((k) => k + 1);
      });
  }, [survey, online, kick, reader, bundle.categories]);

  // ---- sensors for the walk
  const sensors = useRef<SensorStream | null>(null);
  const [live, setLive] = useState({ heading: null as number | null, motion: true });
  const stopSensors = () => {
    sensors.current?.stop();
    sensors.current = null;
  };
  useEffect(() => stopSensors, []);
  async function beginWalk(s: Survey) {
    await requestSensors();
    stopSensors();
    const started = Date.now();
    sensors.current = startSensors({
      onStep: (t) => setSurvey((cur) => cur && { ...cur, steps: [...cur.steps, t] }),
      onHeading: (t, d) => {
        setLive((l) => ({ ...l, heading: d }));
        setSurvey((cur) => cur && { ...cur, headings: [...cur.headings, [t, d]] });
      },
    });
    setSurvey(s);
    setActiveStoreId(s.storeId);
    setView("walk");
    setTimeout(() => {
      if (!sensors.current || Date.now() - started < MOTION_GRACE_MS) return;
      const motion = sensors.current.hasMotion();
      setLive((l) => ({ ...l, motion }));
      // a survey that started without steps stays timed throughout, so its legs stay comparable
      if (!motion) setSurvey((cur) => cur && { ...cur, motion: false });
    }, MOTION_GRACE_MS);
  }

  if (!loaded) return <div className="survey" />;

  return (
    <div className="survey">
      <header className="sv-top">
        <button type="button" className="wordmark soil-mark" onClick={view === "home" ? onExit : () => (stopSensors(), setView("home"))}>
          <i className="dot" />
          grosher <span className="slash">/ survey</span>
        </button>
        {view !== "home" && (
          <button type="button" className="pill-s" onClick={() => (stopSensors(), setView("home"))}>
            <IconArrowLeft className="icon" aria-hidden /> Back
          </button>
        )}
      </header>

      {view === "home" && (
        <Home
          form={form}
          setForm={setForm}
          calibration={calibration}
          survey={survey}
          online={online}
          onCalibrate={() => setView("calibrate")}
          onStart={async () => {
            const fresh = survey && survey.storeId === form.storeId ? survey : newSurvey({ ...form, calibration });
            await beginWalk({ ...fresh, name: form.name, address: form.address, calibration: fresh.calibration ?? calibration });
          }}
          onNew={() => {
            if (survey?.events.length && !confirm(`Start a new survey of ${form.name}? The current one (${survey.events.length} taps) is replaced on this phone; export it first to keep it.`)) return;
            setSurvey(null);
          }}
          onBuild={() => {
            if (!survey) return;
            void saveSurvey(survey);
            const { draft, report } = buildDraft(survey, derive(survey), { categories: bundle.categories, departments: bundle.store.departments ?? [] });
            saveBuiltDraft(draft);
            setBuilt(report);
            setView("built");
          }}
          onExport={async () => {
            if (!survey) return;
            const r = await shareOrDownload(await surveyFile(survey));
            if (r !== "cancelled") say(r === "shared" ? "Survey shared." : "Survey file saved.");
          }}
          onImport={async (file) => {
            try {
              const s = await importSurvey(file);
              setSurvey(s);
              setForm({ name: s.name, storeId: s.storeId, address: s.address ?? "" });
              setActiveStoreId(s.storeId);
              say(`Imported ${s.name}: ${s.events.filter((e) => e.kind === "end").length} aisles.`);
            } catch (e) {
              say(e instanceof Error ? e.message : "That file could not be read.");
            }
          }}
        />
      )}

      {view === "calibrate" && (
        <Calibrate
          current={calibration}
          onSave={(c) => {
            saveCalibration(c);
            setCalibration(c);
            // a survey in progress re-derives with the new stride
            setSurvey((s) => s && { ...s, calibration: c });
            say(c.strideM ? `Stride saved: ${c.strideM.toFixed(2)} m a step.` : `Pace saved: ${c.paceMps.toFixed(2)} m/s.`);
            setView("home");
          }}
        />
      )}

      {view === "walk" && survey && (
        <Walk
          survey={survey}
          setSurvey={setSurvey}
          heading={live.heading}
          motion={live.motion}
          online={online}
          onFinish={() => {
            stopSensors();
            void saveSurvey(survey);
            setView("home");
          }}
          headingNow={() => sensors.current?.heading() ?? null}
        />
      )}

      {view === "built" && survey && built && (
        <Built
          survey={survey}
          report={built}
          onOpen={() => {
            location.hash = `#/edit?store=${encodeURIComponent(survey.storeId)}`;
          }}
          onExport={async () => {
            const r = await shareOrDownload(await surveyFile(survey));
            if (r !== "cancelled") say(r === "shared" ? "Survey shared." : "Survey file saved.");
          }}
        />
      )}

      {notice && (
        <p className="sv-notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- home

function Home(p: {
  form: typeof DEFAULT_STORE;
  setForm: (f: typeof DEFAULT_STORE) => void;
  calibration: Calibration | null;
  survey: Survey | null;
  online: boolean;
  onCalibrate: () => void;
  onStart: () => void;
  onNew: () => void;
  onBuild: () => void;
  onExport: () => void;
  onImport: (f: File) => void;
}) {
  const importRef = useRef<HTMLInputElement>(null);
  const s = p.survey;
  const aisles = s?.events.filter((e) => e.kind === "end").length ?? 0;
  const pins = s?.events.filter((e) => e.kind === "pin").length ?? 0;
  const read = s?.photos.filter((x) => x.status === "done").length ?? 0;
  const c = p.calibration;
  return (
    <main className="sv-main">
      <h1 className="sv-h1">Survey a store</h1>
      <p className="sv-sub">One walk, a draft map. Hold the phone in front of you, screen up, and tap as you go.</p>

      <section className="sv-card" aria-label="Stride">
        <span className="eyebrow soil">Stride</span>
        {c ? (
          <p className="sv-big-num">
            {c.strideM ? <Num value={c.strideM.toFixed(2)} unit="m a step" /> : <Num value={c.paceMps.toFixed(2)} unit="m/s, timed" />}
          </p>
        ) : (
          <p className="sv-big-num muted-soil">Not calibrated yet</p>
        )}
        <p className="sv-fine">{c ? `${c.steps ?? "no"} steps in ${c.distanceM} m · ${(c.durationMs / 1000).toFixed(1)} s · ${fmtDay(c.at)}` : "Walk 10 m once at home: every length in the map is steps × stride."}</p>
        <button type="button" className="pill-s" onClick={p.onCalibrate}>
          {c ? "Calibrate again" : "Calibrate"}
        </button>
      </section>

      <section className="sv-card" aria-label="Store">
        <span className="eyebrow soil">Store</span>
        <label className="ed-field">
          <span className="ed-label">Name</span>
          <input value={p.form.name} onChange={(e) => p.setForm({ ...p.form, name: e.target.value, storeId: s ? p.form.storeId : slug(e.target.value.replace(/#(\d+)/, "$1")) || p.form.storeId })} />
        </label>
        <div className="ed-grid-2">
          <label className="ed-field">
            <span className="ed-label">Store id</span>
            <input value={p.form.storeId} onChange={(e) => p.setForm({ ...p.form, storeId: slug(e.target.value) })} autoCapitalize="off" spellCheck={false} />
          </label>
          <label className="ed-field">
            <span className="ed-label">Address</span>
            <input value={p.form.address} onChange={(e) => p.setForm({ ...p.form, address: e.target.value })} />
          </label>
        </div>
      </section>

      {s && s.events.length > 0 && (
        <section className="sv-card" aria-label="This survey">
          <span className="eyebrow soil">This survey · {fmtDay(s.updatedAt)}</span>
          <p className="sv-stats">
            <Num value={aisles} unit={aisles === 1 ? "aisle" : "aisles"} /> <Num value={pins} unit={pins === 1 ? "pin" : "pins"} /> <Num value={`${read}/${s.photos.length}`} unit="signs read" />
          </p>
          {!p.online && s.photos.some((x) => x.status !== "done") && <p className="sv-fine">Offline: the signs are read when there is a connection.</p>}
          <div className="sv-row">
            <button type="button" className="pill-s" onClick={p.onExport}>
              Export survey file
            </button>
            <button type="button" className="link rose" onClick={p.onNew}>
              New survey
            </button>
          </div>
        </section>
      )}

      <div className="sv-actions">
        {s && aisles > 0 && (
          <button type="button" className="sv-big ghost" onClick={p.onBuild}>
            Build draft map
          </button>
        )}
        <button type="button" className="sv-big primary" onClick={p.onStart} disabled={!p.form.storeId}>
          {s && s.events.length ? "Continue the walk" : "Start survey"}
        </button>
        <button type="button" className="link sv-import" onClick={() => importRef.current?.click()}>
          Import a survey file
        </button>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) p.onImport(f);
            e.target.value = "";
          }}
        />
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- calibrate

function Calibrate({ current, onSave }: { current: Calibration | null; onSave: (c: Calibration) => void }) {
  const stream = useRef<SensorStream | null>(null);
  const [phase, setPhase] = useState<"ready" | "walking" | "done">("ready");
  const [t0, setT0] = useState(0);
  const [, setTick] = useState(0);
  const [result, setResult] = useState<Calibration | null>(null);
  useEffect(() => () => stream.current?.stop(), []);
  useEffect(() => {
    if (phase !== "walking") return;
    const t = setInterval(() => setTick((k) => k + 1), 200);
    return () => clearInterval(t);
  }, [phase]);
  const steps = stream.current?.detector.count ?? 0;
  const secs = phase === "walking" ? (Date.now() - t0) / 1000 : result ? result.durationMs / 1000 : 0;
  return (
    <main className="sv-main">
      <h1 className="sv-h1">Walk {CAL_DISTANCE_M} m</h1>
      <p className="sv-sub">Mark {CAL_DISTANCE_M} m on the floor. Stand on the first mark, tap Start, walk at your shopping pace, tap Stop on the second.</p>
      <section className="sv-card sv-live" aria-live="polite">
        <div>
          <span className="eyebrow soil">Steps</span>
          <p className="sv-huge">
            <Num value={phase === "done" && result ? (result.steps ?? "–") : steps} />
          </p>
        </div>
        <div>
          <span className="eyebrow soil">Time</span>
          <p className="sv-huge">
            <Num value={secs.toFixed(1)} unit="s" />
          </p>
        </div>
      </section>
      {result && (
        <section className="sv-card" aria-label="Result">
          <span className="eyebrow soil">Result</span>
          <p className="sv-big-num">{result.strideM ? <Num value={result.strideM.toFixed(2)} unit="m a step" /> : <span>No motion sensor: timed</span>}</p>
          <p className="sv-fine">
            {result.steps ?? "no"} steps · <Num value={result.paceMps.toFixed(2)} unit="m/s" />
            {current?.strideM && result.strideM ? ` · was ${current.strideM.toFixed(2)} m` : ""}
          </p>
        </section>
      )}
      <div className="sv-actions">
        {phase === "ready" && (
          <button
            type="button"
            className="sv-big primary"
            onClick={async () => {
              await requestSensors();
              stream.current?.stop();
              stream.current = startSensors({ keepTrace: true });
              setT0(Date.now());
              setResult(null);
              setPhase("walking");
            }}
          >
            Start
          </button>
        )}
        {phase === "walking" && (
          <button
            type="button"
            className="sv-big primary"
            onClick={() => {
              const st = stream.current!;
              st.stop();
              const durationMs = Date.now() - t0;
              const motion = st.hasMotion();
              const n = motion ? st.detector.count : null;
              const raw = st.trace();
              setResult({
                distanceM: CAL_DISTANCE_M,
                steps: n,
                durationMs,
                strideM: n ? CAL_DISTANCE_M / n : null,
                paceMps: CAL_DISTANCE_M / Math.max(1, durationMs / 1000),
                at: Date.now(),
                trace: motion ? { t: raw.t.slice(0, 3600), x: raw.x.slice(0, 3600), y: raw.y.slice(0, 3600), z: raw.z.slice(0, 3600) } : undefined,
              });
              setPhase("done");
            }}
          >
            Stop
          </button>
        )}
        {phase === "done" && result && (
          <>
            <button type="button" className="sv-big ghost" onClick={() => setPhase("ready")}>
              Walk it again
            </button>
            <button type="button" className="sv-big primary" onClick={() => onSave(result)} disabled={result.steps === 0}>
              Save
            </button>
          </>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- the walk

function Walk(p: { survey: Survey; setSurvey: (f: (s: Survey | null) => Survey | null) => void; heading: number | null; motion: boolean; online: boolean; onFinish: () => void; headingNow: () => number | null }) {
  const s = p.survey;
  const [actions, setActions] = useState<SurveyAction[]>([]);
  const [sheet, setSheet] = useState<null | "number" | "pins">(null);
  const [, setTick] = useState(0);
  const photoRef = useRef<HTMLInputElement>(null);
  const photoTapAt = useRef(0);
  useEffect(() => {
    const t = setInterval(() => setTick((k) => k + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const phase = phaseOf(s);
  const now = Date.now();
  const stride = s.calibration?.strideM ?? 0.7;
  const pace = s.calibration?.paceMps ?? 1.1;
  const since = phase.kind === "aisle" ? phase.start.t : phase.kind === "between" ? phase.since : now;
  const stepsNow = stepsBetween(s, since, now + 1);
  const metresNow = s.motion && p.motion ? stepsNow * stride : ((now - since) / 1000) * pace;
  const derived = useMemo(() => derive(s), [s]);
  const aisleNo = s.events.filter((e) => e.kind === "start").length;

  /** one tap: the survey update (pure) and what Undo reverses; refused when the phase does not allow it */
  const act = (allowed: boolean, f: (s: Survey) => Survey, action: SurveyAction) => {
    if (!allowed) return;
    p.setSurvey((cur) => cur && f(cur));
    setActions((xs) => [...xs, action]);
  };
  const tap = (allowed: boolean, f: (s: Survey, id: string) => Survey, prefix: string) => {
    const id = uid(prefix);
    act(allowed, (cur) => f(cur, id), { kind: "event", id });
  };
  const currentStart = phase.kind === "aisle" ? phase.start : null;
  // the tags apply to the aisle being walked, else the last one walked
  const tagTarget = currentStart ?? ([...s.events].reverse().find((e) => e.kind === "start") as Extract<SurveyEvent, { kind: "start" }> | undefined) ?? null;
  const tag = (patch: { number?: string; endcap?: boolean; oneSide?: boolean }) => {
    if (!tagTarget) return;
    const prev = { number: tagTarget.number, endcap: tagTarget.endcap, oneSide: tagTarget.oneSide };
    act(true, (cur) => tagAisle(cur, tagTarget.id, patch), { kind: "tag", startId: tagTarget.id, prev });
  };
  const lastAction = actions[actions.length - 1];

  return (
    <main className="sv-main sv-walk">
      <section className="sv-live sv-card" aria-label="Live">
        <div>
          <span className="eyebrow soil">{p.motion && s.motion ? "Steps" : "Timing"}</span>
          <p className="sv-huge">
            <Num value={p.motion && s.motion ? s.steps.length : Math.round((now - (s.events[0]?.t ?? now)) / 1000)} unit={p.motion && s.motion ? undefined : "s"} />
          </p>
        </div>
        <div>
          <span className="eyebrow soil">Heading</span>
          <p className="sv-huge">{p.heading === null ? <span className="sv-none">no compass</span> : <Num value={Math.round(p.heading)} unit="°" />}</p>
        </div>
      </section>
      {!p.motion && <p className="sv-fine">No motion sensor here: each leg is timed at {pace.toFixed(2)} m/s.</p>}

      <section className="sv-now" aria-live="polite">
        {phase.kind === "before" && <p className="sv-state">Stand in the entrance, facing into the store, and tap Entrance.</p>}
        {phase.kind === "between" && (
          <p className="sv-state">
            Walking · <Num value={stepsNow} unit="steps" /> · <Num value={fmtM(metresNow)} unit="m" /> since the last tap
          </p>
        )}
        {phase.kind === "aisle" && (
          <p className="sv-state">
            Aisle {phase.start.number ?? aisleNo} · <Num value={stepsNow} unit="steps" /> · <Num value={fmtM(metresNow)} unit="m" />
          </p>
        )}
        {tagTarget && phase.kind !== "before" && (
          <div className="sv-tags" aria-label={`Tags for aisle ${tagTarget.number ?? ""}`}>
            <button type="button" className="tag" onClick={() => setSheet("number")}>
              {tagTarget.number ? `Aisle ${tagTarget.number}` : "Aisle number"}
            </button>
            <button type="button" className={`tag${tagTarget.endcap ? " on" : ""}`} aria-pressed={!!tagTarget.endcap} onClick={() => tag({ endcap: !tagTarget.endcap })}>
              End cap
            </button>
            <button type="button" className={`tag${tagTarget.oneSide ? " on" : ""}`} aria-pressed={!!tagTarget.oneSide} onClick={() => tag({ oneSide: !tagTarget.oneSide })}>
              One side only
            </button>
          </div>
        )}
      </section>

      <Captured survey={s} derived={derived} online={p.online} now={now} />

      <div className="sv-actions">
        <div className="sv-row">
          <button type="button" className="pill-s" disabled={!lastAction} onClick={() => {
            if (!lastAction) return;
            p.setSurvey((cur) => cur && undo(cur, lastAction));
            setActions((xs) => xs.slice(0, -1));
          }}>
            {lastAction ? `Undo ${describeAction(s, lastAction)}` : "Undo"}
          </button>
          <button type="button" className="pill-s" onClick={p.onFinish}>
            Finish
          </button>
        </div>
        {phase.kind === "before" ? (
          <button type="button" className="sv-big primary" onClick={() => tap(phase.kind === "before", (cur, id) => tapEntrance(cur, Date.now(), p.headingNow(), id), "ev")}>
            Entrance
          </button>
        ) : (
          <>
            <div className="sv-grid">
              <button
                type="button"
                className="sv-big ghost"
                onClick={() => {
                  photoTapAt.current = Date.now();
                  photoRef.current?.click();
                }}
              >
                Sign photo
              </button>
              <button type="button" className="sv-big ghost" onClick={() => setSheet("pins")}>
                Pin
              </button>
            </div>
            {phase.kind === "aisle" ? (
              <button type="button" className="sv-big primary" onClick={() => tap(phase.kind === "aisle", (cur, id) => endAisle(cur, Date.now(), id), "ev")}>
                End aisle
              </button>
            ) : (
              <button type="button" className="sv-big primary" onClick={() => tap(phase.kind === "between", (cur, id) => startAisle(cur, Date.now(), id), "ai")}>
                Start aisle
              </button>
            )}
          </>
        )}
        <input
          ref={photoRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          aria-label="Sign photo"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            const id = uid("ph");
            const t = photoTapAt.current || Date.now();
            try {
              const photo = await downscale(file);
              await savePhoto(id, photo);
              act(true, (cur) => addPhoto(cur, { id, t, w: photo.w, h: photo.h }), { kind: "photo", id });
            } catch {
              /* a photo that cannot be decoded is simply not added */
            }
          }}
        />
      </div>

      {sheet === "number" && tagTarget && (
        <Numpad
          initial={tagTarget.number ?? ""}
          onClose={() => setSheet(null)}
          onDone={(n) => {
            tag({ number: n || undefined });
            setSheet(null);
          }}
        />
      )}
      {sheet === "pins" && (
        <PinSheet
          onClose={() => setSheet(null)}
          onPin={(label, name) => {
            tap(phase.kind !== "before", (cur, id) => dropPin(cur, Date.now(), label, name, id), "pin");
            setSheet(null);
          }}
        />
      )}
    </main>
  );
}

/** the running list, newest first */
function Captured({ survey: s, derived, online, now }: { survey: Survey; derived: ReturnType<typeof derive>; online: boolean; now: number }) {
  const rows: { key: string; title: ReactNode; detail?: ReactNode; photos?: { id: string; status: string; ok: boolean }[] }[] = [];
  for (const e of s.events) {
    if (e.kind === "entrance") rows.push({ key: e.id, title: "Entrance", detail: s.referenceHeading === null ? "no compass" : `facing ${Math.round(s.referenceHeading)}°` });
    if (e.kind === "start") {
      const a = derived.aisles.find((x) => x.id === e.id);
      const photos = s.photos.filter((ph) => (a ? a.photos.includes(ph.id) : ph.t >= e.t));
      if (a?.spacingM != null) rows.push({ key: `${e.id}-x`, title: "Cross walk", detail: <Num value={fmtM(a.spacingM)} unit="m to the next aisle" /> });
      rows.push({
        key: e.id,
        title: a ? `Aisle ${a.code.replace(/^A/, "")}` : `Aisle ${e.number ?? ""} · walking`,
        detail: a ? (
          <>
            <Num value={fmtM(a.lengthM)} unit="m" />
            {a.steps !== null && (
              <>
                {" · "}
                <Num value={a.steps} unit="steps" />
              </>
            )}
            {a.endcap ? " · end cap" : ""}
            {a.oneSide ? " · one side" : ""}
            {a.categories.length ? ` · ${a.categories.map((c) => c.name).slice(0, 3).join(", ")}${a.categories.length > 3 ? "…" : ""}` : ""}
          </>
        ) : undefined,
        photos: photos.map((ph) => ({ id: ph.id, status: photoStatus(ph, online, now), ok: ph.status === "done" })),
      });
    }
    if (e.kind === "pin") rows.push({ key: e.id, title: `Pin · ${e.name ?? e.label}` });
  }
  // photos taken before any aisle started
  const loose = s.photos.filter((ph) => !s.events.some((e) => e.kind === "start" && ph.t >= e.t) && !derived.aisles.some((a) => a.photos.includes(ph.id)));
  if (loose.length) rows.push({ key: "loose", title: "Sign photo · for the next aisle", photos: loose.map((ph) => ({ id: ph.id, status: photoStatus(ph, online, now), ok: ph.status === "done" })) });
  if (!rows.length) return null;
  return (
    <section className="sv-list" aria-label="Captured so far">
      <span className="eyebrow soil">Captured · {rows.length}</span>
      <ol>
        {rows.reverse().map((r) => (
          <li key={r.key}>
            <strong>{r.title}</strong>
            {r.detail && <span className="sv-detail">{r.detail}</span>}
            {r.photos?.map((ph, i) => (
              <span key={ph.id} className={`sv-photo${ph.ok ? " ok" : ""}`}>
                {ph.ok && <IconCheck className="icon" aria-hidden />}
                Sign {i + 1}: {ph.status}
              </span>
            ))}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Numpad({ initial, onDone, onClose }: { initial: string; onDone: (n: string) => void; onClose: () => void }) {
  const [v, setV] = useState(initial);
  const press = (k: string) => setV((x) => (x + k).slice(0, 4));
  return (
    <div className="sv-sheet" role="dialog" aria-modal="true" aria-label="Aisle number">
      <div className="sv-sheet-head">
        <span className="eyebrow soil">Aisle number</span>
        <button type="button" className="sv-x" aria-label="Close" onClick={onClose}>
          <IconClose className="icon" />
        </button>
      </div>
      <p className="sv-pad-value" aria-live="polite">
        <Num value={v || "–"} />
      </p>
      <div className="sv-pad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
          <button key={k} type="button" onClick={() => press(k)}>
            {k}
          </button>
        ))}
        <button type="button" aria-label="Delete" onClick={() => setV((x) => x.slice(0, -1))}>
          ⌫
        </button>
        <button type="button" onClick={() => press("0")}>
          0
        </button>
        <button type="button" className="done" onClick={() => onDone(v)}>
          Done
        </button>
      </div>
    </div>
  );
}

function PinSheet({ onPin, onClose }: { onPin: (label: PinLabel, name?: string) => void; onClose: () => void }) {
  const [custom, setCustom] = useState<string | null>(null);
  return (
    <div className="sv-sheet" role="dialog" aria-modal="true" aria-label="Pin a landmark">
      <div className="sv-sheet-head">
        <span className="eyebrow soil">Pin a landmark here</span>
        <button type="button" className="sv-x" aria-label="Close" onClick={onClose}>
          <IconClose className="icon" />
        </button>
      </div>
      {custom === null ? (
        <div className="sv-pins">
          {PIN_LABELS.map((l) => (
            <button key={l} type="button" onClick={() => (l === "Custom" ? setCustom("") : onPin(l))}>
              {l}
            </button>
          ))}
        </div>
      ) : (
        <form
          className="sv-custom"
          onSubmit={(e) => {
            e.preventDefault();
            if (custom.trim()) onPin("Custom", custom);
          }}
        >
          <label className="ed-field">
            <span className="ed-label">What is here</span>
            <input autoFocus value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Garden centre door" />
          </label>
          <button type="submit" className="sv-big primary" disabled={!custom.trim()}>
            Drop pin
          </button>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- built

function Built({ survey, report, onOpen, onExport }: { survey: Survey; report: BuildReport; onOpen: () => void; onExport: () => void }) {
  return (
    <main className="sv-main">
      <h1 className="sv-h1">Draft map built</h1>
      <p className="sv-sub">
        {survey.name}: open it in the editor on the Mac to drag things into place. The survey stays attached, so the map can be derived again with a corrected stride.
      </p>
      <section className="sv-card sv-live" aria-label="The draft">
        <div>
          <span className="eyebrow soil">Aisles</span>
          <p className="sv-huge">
            <Num value={report.aisles} />
          </p>
        </div>
        <div>
          <span className="eyebrow soil">Categories</span>
          <p className="sv-huge">
            <Num value={report.categories} />
          </p>
        </div>
        <div>
          <span className="eyebrow soil">Shelves</span>
          <p className="sv-huge">
            <Num value={report.fixtures} />
          </p>
        </div>
      </section>
      {report.warnings.length > 0 && (
        <section className="sv-card" aria-label="Check in the editor">
          <span className="eyebrow soil">Check in the editor</span>
          <ul className="sv-warn">
            {report.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}
      <div className="sv-actions">
        <button type="button" className="sv-big ghost" onClick={onExport}>
          Export survey file
        </button>
        <button type="button" className="sv-big primary" onClick={onOpen}>
          Open in the editor
        </button>
      </div>
    </main>
  );
}
