// Render quality for captures. The app caps the canvas at 2× and draws the scene into the post-processing
// composer without multisampling: both are what a phone can afford. The media scripts (scripts/capture-*.mjs)
// ask for more: ?dpr=3 renders at the page's full pixel ratio (up to 3), ?msaa=4 multisamples the composer's
// target (the scene is drawn there, so the context's own antialias never reaches it). Nothing else reads them.

const param = (name: string): number | null => {
  if (typeof location === "undefined") return null;
  const v = Number(new URLSearchParams(location.search).get(name));
  return Number.isFinite(v) && v > 0 ? v : null;
};

/** the Canvas's dpr: [1, 2] (the app), or exactly ?dpr= (1–3) */
export const canvasDpr = (): number | [number, number] => {
  const d = param("dpr");
  return d ? Math.min(3, Math.max(1, d)) : [1, 2];
};

/** the composer's multisampling: 0 (the app), or ?msaa= (2, 4 or 8) */
export const composerSamples = (): number => {
  const m = param("msaa");
  return m ? Math.min(8, Math.round(m)) : 0;
};
