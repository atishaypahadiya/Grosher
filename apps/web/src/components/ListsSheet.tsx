// The Lists sheet: usual trips, saved lists and trip history. Tap loads a
// list onto the draft (confirming when the draft has unsaved items), swipe
// left reveals Delete, long-press renames.

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { List } from "../lib/lists.ts";
import type { TripRecord } from "../lib/history.ts";
import { clock } from "../lib/format.ts";
import { Num } from "./Num.tsx";
import { IconClose } from "./Icons.tsx";

export interface ListsSheetProps {
  lists: List[];
  history: TripRecord[];
  draftUnsaved: boolean;
  draftCount: number;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onSaveDraft: (name: string) => void;
  onOpenRecord: (record: TripRecord) => void;
  onClose: () => void;
}

const LONG_PRESS_MS = 500;
const SWIPE_PX = 60;

function ago(t: number | undefined, now = Date.now()): string {
  if (!t) return "never used";
  const d = Math.round((now - t) / 86_400_000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  if (d < 30) return `${Math.round(d / 7)} wk ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ListRow({ list, onLoad, onDelete, onRename }: { list: List; onLoad: () => void; onDelete: () => void; onRename: (name: string) => void }) {
  const [dx, setDx] = useState(0);
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(list.name);
  const start = useRef<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moved = useRef(false);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (renaming) return;
    start.current = { x: e.clientX, y: e.clientY };
    moved.current = false;
    clearTimer();
    timer.current = setTimeout(() => {
      if (!moved.current) {
        setRenaming(true);
        setName(list.name);
      }
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const d = e.clientX - start.current.x;
    if (Math.abs(d) > 6 || Math.abs(e.clientY - start.current.y) > 6) {
      moved.current = true;
      clearTimer();
    }
    if (d < 0) setDx(Math.max(-SWIPE_PX - 20, d));
    else if (open) setDx(Math.min(0, -SWIPE_PX + d));
  };
  const onPointerUp = () => {
    clearTimer();
    if (!start.current) return;
    const wasOpen = open;
    if (dx <= -SWIPE_PX / 2) {
      setOpen(true);
      setDx(-SWIPE_PX);
    } else {
      setOpen(false);
      setDx(0);
      if (!moved.current && !renaming && !wasOpen) onLoad();
    }
    start.current = null;
  };
  const lastUsed = list.usedAt?.length ? list.usedAt[list.usedAt.length - 1] : undefined;

  return (
    <li className={`ls-row${open ? " open" : ""}`} data-list-id={list.id} data-kind={list.kind}>
      <button type="button" className="ls-delete" onClick={onDelete} aria-label={`Delete ${list.name}`} tabIndex={open ? 0 : -1}>
        Delete
      </button>
      <div className="ls-main" style={{ transform: `translateX(${dx}px)` }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        {renaming ? (
          <form
            className="ls-rename"
            onSubmit={(e) => {
              e.preventDefault();
              onRename(name);
              setRenaming(false);
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label="List name" autoFocus onBlur={() => setRenaming(false)} />
          </form>
        ) : (
          <>
            <span className="ls-name">{list.name}</span>
            <span className="ls-meta">
              {list.items.length} {list.items.length === 1 ? "item" : "items"} · {ago(lastUsed)}
            </span>
          </>
        )}
      </div>
    </li>
  );
}

export function ListsSheet({ lists, history, draftUnsaved, draftCount, onLoad, onDelete, onRename, onSaveDraft, onOpenRecord, onClose }: ListsSheetProps) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState("");
  const usual = lists.filter((l) => l.kind === "usual");
  const saved = lists.filter((l) => l.kind === "saved");
  const tryLoad = (id: string) => (draftUnsaved ? setConfirm(id) : onLoad(id));
  const section = (title: string, items: List[]) =>
    items.length > 0 && (
      <section className="ls-section" aria-label={title}>
        <span className="eyebrow">{title}</span>
        <ul className="ls-rows">
          {items.map((l) => (
            <ListRow key={l.id} list={l} onLoad={() => tryLoad(l.id)} onDelete={() => onDelete(l.id)} onRename={(n) => onRename(l.id, n)} />
          ))}
        </ul>
      </section>
    );

  return (
    <div className="picker" role="dialog" aria-label="Lists">
      <div className="picker-sheet glass-deep sheet lists-sheet">
        <div className="picker-head">
          <div>
            <span className="eyebrow now">Lists</span>
            <h2 className="title">Your lists</h2>
          </div>
          <button type="button" className="pill circle" aria-label="Close" onClick={onClose}>
            <IconClose />
          </button>
        </div>

        {confirm && (
          <div className="ls-confirm" role="alertdialog" aria-label="Replace the draft?">
            <span>
              Replace the {draftCount} {draftCount === 1 ? "item" : "items"} on your list?
            </span>
            <div className="row">
              <button
                type="button"
                className="pill lime"
                onClick={() => {
                  onLoad(confirm);
                  setConfirm(null);
                }}
              >
                Replace
              </button>
              <button type="button" className="pill" onClick={() => setConfirm(null)}>
                Keep mine
              </button>
            </div>
          </div>
        )}

        <div className="ls-scroll">
          {draftCount > 0 &&
            (saving ? (
              <form
                className="ls-save"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (saveName.trim()) onSaveDraft(saveName);
                  setSaving(false);
                  setSaveName("");
                }}
              >
                <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Name this list" aria-label="Name this list" autoFocus />
                <button type="submit" className="pill lime">
                  Save
                </button>
              </form>
            ) : (
              <button type="button" className="pill ls-save-btn" onClick={() => setSaving(true)}>
                Save this list ({draftCount})
              </button>
            ))}
          {section("Usual trips", usual)}
          {section("Saved lists", saved)}
          {history.length > 0 && (
            <section className="ls-section" aria-label="History">
              <span className="eyebrow">History</span>
              <ul className="ls-rows">
                {history.map((r) => (
                  <li key={r.id} className="ls-row" data-record-id={r.id}>
                    <button type="button" className="ls-main ls-history" onClick={() => onOpenRecord(r)}>
                      <span className="ls-name">{new Date(r.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
                      <span className="ls-meta">
                        <Num value={clock(r.timeMs)} /> · {r.bought.length} items · {r.savedM > 0 ? `${Math.round((r.savedM / Math.max(1, r.baselineM)) * 100)}% shorter` : "no saving"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {usual.length + saved.length + history.length === 0 && <p className="muted">No lists yet. Save this one, or finish a trip and save it as your usual.</p>}
        </div>
      </div>
    </div>
  );
}
