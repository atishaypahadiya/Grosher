// Share card export: rasterise the off-screen 1080×1920 card, then hand it to
// the share sheet if the browser has one, else download it.

import { toPng } from "html-to-image";

export async function renderCardPng(node: HTMLElement): Promise<Blob> {
  if (document.fonts?.ready) await document.fonts.ready;
  // The live node sits off-screen; the clone must not inherit that offset.
  const dataUrl = await toPng(node, {
    width: 1080,
    height: 1920,
    pixelRatio: 1,
    cacheBust: true,
    style: { position: "static", left: "0", top: "0", zIndex: "auto" },
  });
  return (await fetch(dataUrl)).blob();
}

export async function shareOrDownload(blob: Blob, filename: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const file = new File([blob], filename, { type: "image/png" });
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch {
      return "cancelled";
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return "downloaded";
}
