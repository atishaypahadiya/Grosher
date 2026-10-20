// Settings the shopper can change at runtime (the gear on the list screen): which LLM provider answers,
// where it is, which model; and the off-list guard on a trip (lib/guard.ts). Stored in localStorage
// (versioned, lib/persist.ts); the resolver's defaults come from the VITE_ variables at build time.
//
//   ollama  straight to an Ollama over http (dev: localhost on the Mac; Ollama listens on loopback only).
//           An installed app served over https cannot call plain http, so
//           this is a development path.
//   worker  the Cloudflare worker (apps/resolver), which reaches the Mac's
//           model through its tunnel, or Claude. Production.

import { load, remove, save } from "./storage.ts";
import { GUARD_MODES, type GuardMode } from "./guard.ts";

export type ProviderName = "ollama" | "worker";

export interface ResolverSettings {
  provider: ProviderName;
  ollamaUrl: string;
  model: string;
  workerUrl: string;
  /** survey mode's aisle signs, on the direct Ollama path (the worker uses its OLLAMA_VISION_MODEL) */
  visionModel: string;
  /** the off-list guard on a trip: off, gentle (the default), strict */
  guard: GuardMode;
}

export const SETTINGS_KEY = "grosher.resolver";
export const OLLAMA_DEFAULT_MODEL = "qwen3:8b";
export const VISION_DEFAULT_MODEL = "qwen2.5vl:7b";

const env = import.meta.env as Record<string, string | undefined>;
const trimUrl = (s: string) => s.trim().replace(/\/$/, "");

/** the build-time defaults: VITE_RESOLVER_PROVIDER (worker | anthropic | ollama), VITE_OLLAMA_URL, VITE_OLLAMA_MODEL, VITE_RESOLVER_URL, VITE_VISION_MODEL */
export const DEFAULT_SETTINGS: ResolverSettings = {
  provider: env.VITE_RESOLVER_PROVIDER === "worker" || env.VITE_RESOLVER_PROVIDER === "anthropic" ? "worker" : "ollama",
  ollamaUrl: trimUrl(env.VITE_OLLAMA_URL ?? "http://localhost:11434"),
  model: (env.VITE_OLLAMA_MODEL ?? OLLAMA_DEFAULT_MODEL).trim(),
  workerUrl: trimUrl(env.VITE_RESOLVER_URL ?? "/api"),
  visionModel: (env.VITE_VISION_MODEL ?? VISION_DEFAULT_MODEL).trim(),
  guard: "gentle",
};

/** anything stored is coerced back onto the defaults field by field */
export function sanitize(raw: unknown, defaults: ResolverSettings = DEFAULT_SETTINGS): ResolverSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof ResolverSettings, unknown>>;
  const str = (v: unknown, d: string) => (typeof v === "string" && v.trim() ? trimUrl(v) : d);
  return {
    provider: o.provider === "worker" || o.provider === "ollama" ? o.provider : defaults.provider,
    ollamaUrl: str(o.ollamaUrl, defaults.ollamaUrl),
    model: str(o.model, defaults.model),
    workerUrl: str(o.workerUrl, defaults.workerUrl),
    visionModel: str(o.visionModel, defaults.visionModel),
    guard: GUARD_MODES.includes(o.guard as GuardMode) ? (o.guard as GuardMode) : defaults.guard,
  };
}

export function loadSettings(): ResolverSettings {
  const raw = load<unknown>(SETTINGS_KEY, null);
  return raw ? sanitize(raw) : DEFAULT_SETTINGS;
}

/** private mode: the choice lasts the session */
export function saveSettings(s: ResolverSettings): ResolverSettings {
  const clean = sanitize(s);
  save(SETTINGS_KEY, clean);
  return clean;
}

export function resetSettings(): ResolverSettings {
  remove(SETTINGS_KEY);
  return DEFAULT_SETTINGS;
}

/** a page served over https cannot fetch a plain-http Ollama (mixed content) */
export const mixedContent = (s: ResolverSettings, pageProtocol = typeof location !== "undefined" ? location.protocol : "http:") =>
  s.provider === "ollama" && pageProtocol === "https:" && /^http:\/\//i.test(s.ollamaUrl) && !/^http:\/\/localhost(:|\/|$)/i.test(s.ollamaUrl);
