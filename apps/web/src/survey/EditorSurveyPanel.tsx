// In the editor, for a store that has a survey on this device: the raw walk stays attached. Fix the stride
// and derive the draft again (it replaces the edits since the last build, so it asks first), or export the
// survey file.

import { useEffect, useState } from "react";
import type { StoreBundle } from "@grosher/stores";
import { buildDraft, derive } from "./derive.ts";
import type { Survey } from "./model.ts";
import { loadSurvey, saveBuiltDraft, saveSurvey, shareOrDownload, surveyFile } from "./store.ts";

export function EditorSurveyPanel({ bundle, reference, onRebuilt }: { bundle: StoreBundle; reference: { categories: StoreBundle["categories"]; departments: NonNullable<StoreBundle["store"]["departments"]> }; onRebuilt?: () => void }) {
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [stride, setStride] = useState("");
  useEffect(() => {
    let live = true;
    loadSurvey(bundle.store.storeId).then((s) => {
      if (!live || !s) return;
      setSurvey(s);
      setStride((s.calibration?.strideM ?? 0.7).toFixed(2));
    });
    return () => {
      live = false;
    };
  }, [bundle.store.storeId]);
  if (!survey) return null;
  const d = derive(survey);
  const value = Number(stride);
  const valid = Number.isFinite(value) && value >= 0.3 && value <= 1.5;
  return (
    <section className="ed-section ed-survey" aria-label="Survey">
      <span className="eyebrow soil">Survey · attached</span>
      <p className="ed-sub">
        {d.aisles.length} aisles · {Math.round(d.walkedM)} m walked · {survey.photos.filter((p) => p.status === "done").length}/{survey.photos.length} signs read · {survey.motion ? "steps" : "timed"}
      </p>
      <label className="ed-field">
        <span className="ed-label">Stride, metres a step</span>
        <input type="number" inputMode="decimal" step="0.01" min="0.3" max="1.5" value={stride} onChange={(e) => setStride(e.target.value)} />
      </label>
      <div className="ed-add">
        <button
          type="button"
          className="btn-soil"
          disabled={!valid}
          onClick={() => {
            if (!confirm(`Derive ${survey.name} again at ${value.toFixed(2)} m a step? Edits to this draft since the last build are replaced.`)) return;
            const next: Survey = { ...survey, calibration: { ...(survey.calibration ?? { distanceM: 10, steps: null, durationMs: 0, paceMps: 1.1, at: Date.now() }), strideM: value } };
            const { draft } = buildDraft(next, derive(next), reference);
            saveBuiltDraft(draft);
            void saveSurvey(next);
            onRebuilt?.();
          }}
        >
          Re-derive
        </button>
        <button type="button" className="pill-s" onClick={async () => void shareOrDownload(await surveyFile(survey))}>
          Export survey
        </button>
      </div>
    </section>
  );
}
