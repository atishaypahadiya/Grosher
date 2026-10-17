// Hold-to-speak on the add pill, on the Web Speech API (webkitSpeechRecognition
// on Safari). Interim results stream to the input; each final result is a
// chunk, split further on "and", commas and semicolons.
//
// iOS standalone (home-screen) web apps: the constructor exists but, in our
// reading of WebKit's behaviour, recognition does not start there. Until that
// is verified on a device, the mic is hidden in that context and keyboard
// dictation carries voice entry. VITE_SPEECH_STANDALONE=1 shows it anyway.

interface ResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ResultLike> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function ctor(): (new () => RecognitionLike) | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function isIosStandalone(): boolean {
  if (typeof navigator === "undefined") return false;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = (navigator as { standalone?: boolean }).standalone === true || (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches);
  return ios && standalone;
}

export function speechSupported(): boolean {
  if (!ctor()) return false;
  const allowStandalone = (import.meta.env as Record<string, string | undefined>).VITE_SPEECH_STANDALONE === "1";
  return allowStandalone || !isIosStandalone();
}

/** "milk and eggs, two lemons" → ["milk", "eggs", "two lemons"] */
export function splitSpeech(text: string): string[] {
  return text
    .split(/[,;\n]+|\band\b|\bthen\b/i)
    .map((s) => s.trim().replace(/[.!?]+$/, ""))
    .filter(Boolean);
}

export type SpeechStop = "ended" | "denied" | "unavailable" | "error";

export interface ListenHandlers {
  /** the words heard so far in the current phrase, before they are final */
  onInterim: (text: string) => void;
  /** a finished phrase (a pause), already split into items */
  onItems: (items: string[]) => void;
  onEnd: (why: SpeechStop) => void;
}

/** Starts listening; returns a stop function. */
export function listen(h: ListenHandlers): () => void {
  const C = ctor();
  if (!C) {
    h.onEnd("unavailable");
    return () => {};
  }
  const r = new C();
  r.lang = navigator.language || "en-US";
  r.interimResults = true;
  r.continuous = true;
  r.maxAlternatives = 1;
  let why: SpeechStop = "ended";
  let delivered = 0;
  r.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      const text = res[0]?.transcript ?? "";
      if (res.isFinal) {
        if (i >= delivered) {
          delivered = i + 1;
          const items = splitSpeech(text);
          if (items.length) h.onItems(items);
        }
      } else interim += text;
    }
    h.onInterim(interim.trim());
  };
  r.onerror = (e) => {
    why = e.error === "not-allowed" || e.error === "service-not-allowed" ? "denied" : e.error === "aborted" ? "ended" : "error";
  };
  r.onend = () => h.onEnd(why);
  try {
    r.start();
  } catch {
    h.onEnd("error");
    return () => {};
  }
  return () => r.stop();
}
