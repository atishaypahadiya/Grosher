// Where surveys live: the survey itself in IndexedDB (survey:<storeId>), its photos beside it
// (survey-photo:<id>), the stride in localStorage (grosher.calibration, per phone, not per store), and the
// draft a survey built (grosher.surveydraft.<storeId>: what the editor resets to; its edits autosave under
// grosher.editor.<storeId> as for any store). The file is the survey with its photos inline, for AirDrop.

import { dbGet, dbSet } from "../lib/db.ts";
import { load, save } from "../lib/storage.ts";
import type { Draft } from "../editor/model.ts";
import { parseSurveyFile, type Calibration, type Survey, type SurveyFile } from "./model.ts";
import { fromDataUrl, loadPhoto, savePhoto, toDataUrl } from "./photos.ts";

export const CAL_KEY = "grosher.calibration";
export const ACTIVE_KEY = "grosher.survey.active";
export const builtKey = (storeId: string) => `grosher.surveydraft.${storeId}`;
export const editorKey = (storeId: string) => `grosher.editor.${storeId}`;

export const loadCalibration = () => load<Calibration | null>(CAL_KEY, null);
export const saveCalibration = (c: Calibration) => save(CAL_KEY, c);

export const loadSurvey = (storeId: string) => dbGet<Survey | null>(`survey:${storeId}`, null);
export const saveSurvey = (s: Survey) => dbSet(`survey:${s.storeId}`, s);
export const activeStoreId = () => load<string | null>(ACTIVE_KEY, null);
export const setActiveStoreId = (id: string | null) => save(ACTIVE_KEY, id);

/** the survey's draft goes to the editor: the built one (what Reset returns to) and the working copy */
export function saveBuiltDraft(draft: Draft) {
  save(builtKey(draft.store.storeId), draft);
  save(editorKey(draft.store.storeId), draft);
}
export const loadBuiltDraft = (storeId: string) => load<Draft | null>(builtKey(storeId), null);

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

/** One JSON file: the survey and every photo as a data: URL. */
export async function surveyFile(s: Survey): Promise<File> {
  const photoData: Record<string, string> = {};
  for (const p of s.photos) {
    const stored = await loadPhoto(p.id);
    if (stored) photoData[p.id] = await toDataUrl(stored.blob);
  }
  const body: SurveyFile = { ...s, photoData };
  return new File([JSON.stringify(body)], `grosher-survey-${s.storeId}-${day(s.updatedAt)}.json`, { type: "application/json" });
}

/** The share sheet where there is one (AirDrop to the Mac in one tap), a download elsewhere. */
export async function shareOrDownload(file: File): Promise<"shared" | "downloaded" | "cancelled"> {
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title: file.name });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return "downloaded";
}

/** A survey file → saved here (survey and photos), replacing this store's survey. */
export async function importSurvey(file: File): Promise<Survey> {
  const { survey, photoData } = parseSurveyFile(JSON.parse(await file.text()));
  for (const [id, url] of Object.entries(photoData)) {
    const p = survey.photos.find((x) => x.id === id);
    await savePhoto(id, { blob: await fromDataUrl(url), w: p?.w ?? 0, h: p?.h ?? 0 });
  }
  await saveSurvey(survey);
  return survey;
}
