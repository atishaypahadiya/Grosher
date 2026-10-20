import { beforeEach, describe, expect, test } from "vitest";
import { load } from "../src/lib/storage.ts";
import { DEFAULT_SETTINGS, loadSettings, mixedContent, resetSettings, sanitize, saveSettings, SETTINGS_KEY } from "../src/lib/settings.ts";

beforeEach(() => localStorage.clear());

describe("resolver settings", () => {
  test("defaults come from the build; nothing stored → defaults", () => {
    expect(["ollama", "worker"]).toContain(DEFAULT_SETTINGS.provider);
    expect(DEFAULT_SETTINGS.ollamaUrl).not.toMatch(/\/$/);
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  test("save → load round-trips, trims slashes, reset clears", () => {
    const saved = saveSettings({ provider: "worker", ollamaUrl: "http://10.0.0.9:11434/", model: " qwen3:14b ", workerUrl: "https://r.example/", visionModel: " qwen2.5vl:3b ", guard: "strict" });
    expect(saved).toEqual({ provider: "worker", ollamaUrl: "http://10.0.0.9:11434", model: "qwen3:14b", workerUrl: "https://r.example", visionModel: "qwen2.5vl:3b", guard: "strict" });
    expect(loadSettings()).toEqual(saved);
    expect(load(SETTINGS_KEY, null)).toEqual(saved);
    expect(resetSettings()).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  test("garbage in storage falls back field by field", () => {
    localStorage.setItem(SETTINGS_KEY, "{not json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(sanitize({ provider: "claude", ollamaUrl: 42, model: "", workerUrl: "https://ok.example" })).toEqual({ ...DEFAULT_SETTINGS, workerUrl: "https://ok.example" });
    // the off-list guard: Gentle unless it is one of the three
    expect(DEFAULT_SETTINGS.guard).toBe("gentle");
    expect(sanitize({ guard: "nag" }).guard).toBe("gentle");
    expect(sanitize({ guard: "off" }).guard).toBe("off");
  });

  test("mixed content: https page + plain-http Ollama on the LAN", () => {
    const s = { provider: "ollama" as const, ollamaUrl: "http://10.0.0.9:11434", model: "qwen3:8b", workerUrl: "/api", visionModel: "qwen2.5vl:7b", guard: "gentle" as const };
    expect(mixedContent(s, "https:")).toBe(true);
    expect(mixedContent(s, "http:")).toBe(false);
    expect(mixedContent({ ...s, ollamaUrl: "http://localhost:11434" }, "https:")).toBe(false); // localhost is a secure context
    expect(mixedContent({ ...s, provider: "worker" }, "https:")).toBe(false);
  });
});
