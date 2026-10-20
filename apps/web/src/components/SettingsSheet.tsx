// Settings: the item resolver's provider (direct Ollama for dev, the worker for production), its URL and,
// for Ollama, the model; and the off-list guard on a trip (lib/guard.ts). Saved per device in localStorage;
// defaults from the build. Deep glass, like the other sheets.

import { useState, type FormEvent } from "react";
import { DEFAULT_SETTINGS, mixedContent, type ProviderName, type ResolverSettings } from "../lib/settings.ts";
import type { GuardMode } from "../lib/guard.ts";
import { IconClose } from "./Icons.tsx";

export interface SettingsSheetProps {
  settings: ResolverSettings;
  onSave: (s: ResolverSettings) => void;
  onReset: () => void;
  onClose: () => void;
}

const GUARDS: { id: GuardMode; label: string; note: string }[] = [
  { id: "off", label: "Off", note: "No nudges on a trip." },
  { id: "gentle", label: "Gentle", note: "A quiet nudge when you drift off your route: once a leg, never in a queue or at a counter." },
  { id: "strict", label: "Strict", note: "Sooner, and up to twice a leg." },
];

const PROVIDERS: { id: ProviderName; label: string; note: string }[] = [
  { id: "ollama", label: "Local Ollama", note: "Straight to Ollama on this Mac (localhost): for development on the Mac. Ollama listens on the Mac only, so a phone uses the worker." },
  { id: "worker", label: "Worker", note: "Through the Cloudflare worker, which reaches the Mac's model over its tunnel. Works from the installed app." },
];

export function SettingsSheet({ settings, onSave, onReset, onClose }: SettingsSheetProps) {
  const [draft, setDraft] = useState<ResolverSettings>(settings);
  const set = <K extends keyof ResolverSettings>(k: K, v: ResolverSettings[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave(draft);
  };
  const current = PROVIDERS.find((p) => p.id === draft.provider) ?? PROVIDERS[0];
  const mixed = mixedContent(draft);
  const changed = JSON.stringify(draft) !== JSON.stringify(DEFAULT_SETTINGS);

  return (
    <div className="picker" role="dialog" aria-label="Settings">
      <form className="picker-sheet glass-deep sheet st-sheet" onSubmit={submit}>
        <div className="picker-head">
          <div>
            <span className="eyebrow now">Settings</span>
            <h2 className="title">Item resolver</h2>
          </div>
          <button type="button" className="pill circle" aria-label="Close" onClick={onClose}>
            <IconClose />
          </button>
        </div>

        <div className="st-seg" role="radiogroup" aria-label="Provider">
          {PROVIDERS.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={draft.provider === p.id} className={`pill${draft.provider === p.id ? " white" : ""}`} onClick={() => set("provider", p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        <p className="st-note">{current.note}</p>

        {draft.provider === "ollama" ? (
          <>
            <label className="st-field">
              <span className="eyebrow">Ollama URL</span>
              <input type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={draft.ollamaUrl} onChange={(e) => set("ollamaUrl", e.target.value)} placeholder="http://192.168.1.20:11434" />
            </label>
            <label className="st-field">
              <span className="eyebrow">Model</span>
              <input type="text" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={draft.model} onChange={(e) => set("model", e.target.value)} placeholder="qwen3:8b" />
            </label>
            <label className="st-field">
              <span className="eyebrow">Sign model (survey)</span>
              <input type="text" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={draft.visionModel} onChange={(e) => set("visionModel", e.target.value)} placeholder="qwen2.5vl:7b" />
            </label>
            {mixed && <p className="st-note warn">This page is https, so the browser blocks a plain-http Ollama on the LAN. Use the worker from the installed app.</p>}
          </>
        ) : (
          <label className="st-field">
            <span className="eyebrow">Resolver URL</span>
            <input type="text" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={draft.workerUrl} onChange={(e) => set("workerUrl", e.target.value)} placeholder="https://grosher-resolver.example.workers.dev" />
          </label>
        )}

        <h2 className="title st-section">Off-list guard</h2>
        <div className="st-seg" role="radiogroup" aria-label="Off-list guard">
          {GUARDS.map((g) => (
            <button key={g.id} type="button" role="radio" aria-checked={draft.guard === g.id} className={`pill${draft.guard === g.id ? " white" : ""}`} onClick={() => set("guard", g.id)}>
              {g.label}
            </button>
          ))}
        </div>
        <p className="st-note">{(GUARDS.find((g) => g.id === draft.guard) ?? GUARDS[1]).note}</p>
        <p className="st-note">Your phone's motion stays on this phone: it is never sent anywhere, and only this trip's counts are kept.</p>

        <div className="picker-foot">
          <button type="button" className="pill ghost" disabled={!changed} onClick={onReset}>
            Reset to defaults
          </button>
          <button type="submit" className="pill lime">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
