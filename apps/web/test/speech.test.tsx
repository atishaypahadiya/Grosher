import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "../src/App.tsx";
import { isIosStandalone, splitSpeech, speechSupported } from "../src/lib/speech.ts";
import { dbClearMemoryFallback } from "../src/lib/db.ts";

// A fake recogniser the tests drive by hand.
class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = "";
  interimResults = false;
  continuous = false;
  maxAlternatives = 1;
  onresult: ((e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  started = false;
  stopped = false;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
    this.onend?.();
  }
  abort() {
    this.onend?.();
  }
  say(transcript: string, isFinal: boolean, index = 0) {
    // like the real API: results holds every result so far, the new one at its index
    const results: { isFinal: boolean; 0: { transcript: string } }[] = [];
    results[index] = { isFinal, 0: { transcript } };
    this.onresult?.({ resultIndex: index, results });
  }
}

beforeEach(() => {
  localStorage.clear();
  dbClearMemoryFallback();
  (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeRecognition;
});
afterEach(() => {
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

describe("voice entry", () => {
  test("splitSpeech: and, commas, pauses", () => {
    expect(splitSpeech("milk and eggs, two lemons. then bread")).toEqual(["milk", "eggs", "two lemons", "bread"]);
    expect(splitSpeech("  ")).toEqual([]);
  });

  test("hold to speak: interim text shows in the input, finals become items, release stops", async () => {
    render(<App />);
    const mic = screen.getByRole("button", { name: /hold to speak/i });
    fireEvent.pointerDown(mic);
    const r = FakeRecognition.last!;
    expect(r.started).toBe(true);
    expect(r.interimResults).toBe(true);
    expect(screen.getByTestId("listening")).toBeTruthy();
    r.say("milk and", false);
    await waitFor(() => expect((screen.getByLabelText(/add items/i) as HTMLInputElement).value).toBe("milk and"));
    r.say("milk and eggs", true, 0);
    await waitFor(() => expect(screen.getByText(/2 items/)).toBeTruthy());
    r.say("bread", true, 1);
    await waitFor(() => expect(screen.getByText(/3 items/)).toBeTruthy());
    fireEvent.pointerUp(mic);
    expect(r.stopped).toBe(true);
    await waitFor(() => expect(screen.queryByTestId("listening")).toBeNull());
    expect((screen.getByLabelText(/add items/i) as HTMLInputElement).value).toBe("");
  });

  test("permission denied shows a one-line note, never an error state", async () => {
    render(<App />);
    const mic = screen.getByRole("button", { name: /hold to speak/i });
    fireEvent.pointerDown(mic);
    const r = FakeRecognition.last!;
    r.onerror?.({ error: "not-allowed" });
    r.onend?.();
    expect(await screen.findByText(/microphone not allowed · type instead/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /hold to speak/i })).toBeTruthy();
  });

  test("the mic hides in iOS standalone mode and when the API is missing", () => {
    expect(isIosStandalone()).toBe(false);
    expect(speechSupported()).toBe(true);
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    expect(speechSupported()).toBe(false);
    render(<App />);
    expect(screen.queryByRole("button", { name: /hold to speak/i })).toBeNull();
  });
});
