import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ListsSheet } from "../src/components/ListsSheet.tsx";
import { newList, withDraft } from "../src/lib/lists.ts";

const lists = withDraft([{ ...newList("demo", "usual", "Sunday trip", ["milk", "eggs"], 1), usedAt: [Date.now() - 86_400_000] }, newList("demo", "saved", "Party", ["chips", "soda", "ice cream"], 2)], "demo");

describe("ListsSheet", () => {
  test("shows usual and saved lists with counts; tap loads, confirming when the draft is unsaved", () => {
    const onLoad = vi.fn();
    render(<ListsSheet lists={lists} history={[]} draftUnsaved draftCount={2} onLoad={onLoad} onDelete={() => {}} onRename={() => {}} onSaveDraft={() => {}} onOpenRecord={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/2 items · yesterday/)).toBeTruthy();
    expect(screen.getByText(/3 items · never used/)).toBeTruthy();
    const row = screen.getByText("Party").closest(".ls-main")!;
    fireEvent.pointerDown(row, { clientX: 100, clientY: 10 });
    fireEvent.pointerUp(row, { clientX: 100, clientY: 10 });
    expect(onLoad).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /replace/i }));
    expect(onLoad).toHaveBeenCalledWith(lists[2].id);
  });

  test("swipe left reveals Delete; long-press renames", async () => {
    const onDelete = vi.fn();
    const onRename = vi.fn();
    render(<ListsSheet lists={lists} history={[]} draftUnsaved={false} draftCount={0} onLoad={() => {}} onDelete={onDelete} onRename={onRename} onSaveDraft={() => {}} onOpenRecord={() => {}} onClose={() => {}} />);
    const row = screen.getByText("Party").closest(".ls-main")!;
    fireEvent.pointerDown(row, { clientX: 200, clientY: 10 });
    fireEvent.pointerMove(row, { clientX: 120, clientY: 10 });
    fireEvent.pointerUp(row, { clientX: 120, clientY: 10 });
    const li = row.closest("li")!;
    expect(li.classList.contains("open")).toBe(true);
    fireEvent.click(within(li).getByRole("button", { name: /delete party/i }));
    expect(onDelete).toHaveBeenCalledWith(lists[2].id);
    const sunday = screen.getByText("Sunday trip").closest(".ls-main")!;
    fireEvent.pointerDown(sunday, { clientX: 50, clientY: 10 });
    await waitFor(() => expect(screen.getByLabelText(/list name/i)).toBeTruthy(), { timeout: 1500 });
    fireEvent.change(screen.getByLabelText(/list name/i), { target: { value: "Sunday big shop" } });
    fireEvent.submit(screen.getByLabelText(/list name/i).closest("form")!);
    expect(onRename).toHaveBeenCalledWith(lists[1].id, "Sunday big shop");
  });
});
