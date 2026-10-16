// Hold-to-speak on the add pill, where the browser offers speech recognition.

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

function ctor(): (new () => RecognitionLike) | undefined {
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const speechSupported = () => typeof window !== "undefined" && !!ctor();

/** Starts listening; returns a stop function. onText fires once with everything heard. */
export function listen(onText: (text: string) => void, onEnd: () => void): () => void {
  const C = ctor();
  if (!C) {
    onEnd();
    return () => {};
  }
  const r = new C();
  r.lang = navigator.language || "en-US";
  r.interimResults = false;
  r.continuous = true;
  const parts: string[] = [];
  r.onresult = (e) => {
    for (let i = 0; i < e.results.length; i++) parts[i] = e.results[i][0]?.transcript ?? "";
  };
  r.onend = () => {
    const text = parts.join(" ").trim();
    if (text) onText(text);
    onEnd();
  };
  r.onerror = () => onEnd();
  r.start();
  return () => r.stop();
}
