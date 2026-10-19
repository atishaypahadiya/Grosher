import { beforeEach, describe, expect, test } from "vitest";
import { load } from "../src/lib/storage.ts";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "../src/App.tsx";
import { demoSupercenter } from "@grosher/stores";
import { dbClearMemoryFallback, dbGet } from "../src/lib/db.ts";
import { saveLearning, type Learning } from "../src/lib/learning.ts";

beforeEach(() => {
  localStorage.clear();
  dbClearMemoryFallback();
});

const add = (text: string) => {
  const input = screen.getByLabelText(/add items/i);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest("form")!);
};
// the first render in a file loads the 7 MB catalog chunk and builds its index: allow for it
const find = (re: RegExp) => screen.findByText(re, {}, { timeout: 10_000 });
const findButton = (re: RegExp) => screen.findByRole("button", { name: re }, { timeout: 10_000 });

describe("list screen", () => {
  test("resolves typed and comma-separated items with a source glyph, flags unknown ones", async () => {
    render(<App bundle={demoSupercenter} />);
    add("milk");
    add("egs, unicorn");
    expect(await find(/3 items · 2 placed/i)).toBeTruthy();
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0].getAttribute("data-source")).toBe("exact");
    expect(within(rows[0]).getByText(/dairy · last/i)).toBeTruthy();
    expect(rows[1].getAttribute("data-source")).toBe("fuzzy"); // egs → Eggs
    expect(within(rows[1]).getByText(/^Eggs$/)).toBeTruthy();
    expect(rows[2].getAttribute("data-source")).toBe("unknown");
    expect(within(rows[2]).getByText(/needs a place/i, { selector: ".sub" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /route 2 items/i })).toBeTruthy();
  });

  test("an unknown item the resolver can place becomes an amber guess with its department", async () => {
    render(<App bundle={demoSupercenter} />);
    add("zorbo milk");
    expect(await find(/probably/i, )).toBeTruthy();
    const row = within(screen.getByRole("list")).getAllByRole("listitem")[0];
    await waitFor(() => expect(row.getAttribute("data-source")).toBe("llm"));
    expect(within(row).getByText(/probably .*plant milk/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /route 1 item/i })).toBeTruthy();
  });

  test("Tell me where opens the picker; Remove drops a row", async () => {
    render(<App bundle={demoSupercenter} />);
    add("milk, unicorn");
    fireEvent.click(await findButton(/tell me where/i));
    expect(screen.getByRole("dialog", { name: /where is unicorn/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^milk$/i }));
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(await find(/1 item · 0 placed/i)).toBeTruthy();
  });

  test("empty list shows the disabled call to action", () => {
    render(<App bundle={demoSupercenter} />);
    expect((screen.getByRole("button", { name: /route 0 items/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("trip mode", () => {
  test("checking off a model guess moves the guess up its ladder; it writes no memory, so never \"yours\"", async () => {
    render(<App bundle={demoSupercenter} />);
    add("zorbo milk");
    const row = () => within(screen.getByRole("list")).getAllByRole("listitem")[0];
    await waitFor(() => expect(row().getAttribute("data-source")).toBe("llm"), { timeout: 10_000 });
    fireEvent.click(await findButton(/route 1 item/i));
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    await waitFor(async () => {
      const l = await dbGet<Learning | null>("learning:demo-supercenter", null);
      expect(l?.pending.find((p) => /zorbo/i.test(p.name))?.confirms).toBe(1);
      expect(l?.memory.some((m) => /zorbo/i.test(m.name))).toBe(false);
    });
  });

  test("list in, route, check off, reroute, checkout card, share and usual trip", async () => {
    render(<App bundle={demoSupercenter} />);
    add("bread, milk, bananas, ice cream, unicorn");
    fireEvent.click(await findButton(/route 4 items/i));

    expect(screen.getByText(/next · 1 of 4/i)).toBeTruthy();
    expect(document.querySelector('[data-landmark="you"]')).not.toBeNull();
    expect(document.querySelectorAll("[data-stop]")).toHaveLength(4);
    const first = screen.getByRole("heading", { level: 2 }).textContent;

    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    expect(screen.getByText(/next · 2 of 4/i)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2 }).textContent).not.toBe(first);
    expect(document.querySelectorAll("[data-stop]")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: /not here/i }));
    expect(screen.getByText(/next · 3 of 4/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /add item/i }));
    fireEvent.change(screen.getByPlaceholderText(/coffee/i), { target: { value: "Coffee" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(screen.getByText(/next · 3 of 5/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));

    expect(screen.getByText(/trip done/i)).toBeTruthy();
    const card = screen.getAllByLabelText(/trip card/i)[0];
    expect(within(card).getByText(/4 of 5 items · lane/i)).toBeTruthy();
    expect(within(card).getByText(/walked/i)).toBeTruthy();
    expect(within(card).getByText(/vs list in order/i)).toBeTruthy();
    expect(within(card).getByText(/aisles? never entered/i)).toBeTruthy();
    expect(screen.getAllByTestId("improve-row")).toHaveLength(2);
    expect(screen.getByText(/where did you find the unicorn/i)).toBeTruthy();
    // Pick aisle opens the picker
    fireEvent.click(screen.getAllByRole("button", { name: /pick aisle/i })[0]);
    const dialog = screen.getByRole("dialog", { name: /where is/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /^close$/i }));
    expect(screen.getByRole("button", { name: /share card/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /save as usual trip/i }));
    expect(screen.getByRole("button", { name: /saved as usual/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(localStorage.getItem("grosher.trip.demo-supercenter")).toBeNull();

    // the usual trip was saved from the bought items; load it from the Lists sheet, replacing the draft
    fireEvent.click((await screen.findAllByRole("button", { name: /^lists$/i }))[0]);
    const sheet = screen.getByRole("dialog", { name: /^lists$/i });
    const row = within(sheet).getByText(/ trip$/).closest(".ls-main")!;
    fireEvent.pointerDown(row, { clientX: 100, clientY: 10 });
    fireEvent.pointerUp(row, { clientX: 100, clientY: 10 });
    fireEvent.click(within(sheet).getByRole("button", { name: /replace/i }));
    expect(await find(/4 items · 4 placed/i)).toBeTruthy();
  });

  test("progress strip, back pauses, the list resumes", async () => {
    render(<App bundle={demoSupercenter} />);
    add("milk, eggs, bread");
    fireEvent.click(await findButton(/route 3 items/i));
    const bar = screen.getByRole("progressbar");
    expect(bar.querySelectorAll(".seg")).toHaveLength(3);
    expect(bar.querySelectorAll(".seg.current")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    expect(bar.querySelectorAll(".seg.done")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /flatten the map/i }));
    expect(load("grosher.flat", false)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /back to the list/i }));
    fireEvent.click(await findButton(/resume trip · 2 left/i));
    expect(screen.getByText(/next · 2 of 3/i)).toBeTruthy();
  });

  test("a trip survives a reload", async () => {
    const { unmount } = render(<App bundle={demoSupercenter} />);
    add("milk, eggs");
    fireEvent.click(await findButton(/route 2 items/i));
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    unmount();
    render(<App bundle={demoSupercenter} />);
    expect(await find(/next · 2 of 2/i)).toBeTruthy();
  });
});

describe("editor", () => {
  test("#/edit opens the editor with stats, tools, layers and the inspector", () => {
    location.hash = "#/edit";
    render(<App bundle={demoSupercenter} />);
    expect(screen.getByText(/nodes · .* edges · .* locations · 13 textures · 0 unreachable/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /shelf location/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /preview in 3d/i })).toBeTruthy();
    expect(screen.getByRole("group", { name: /layers/i }).querySelectorAll("button")).toHaveLength(8);
    fireEvent.click(screen.getByRole("button", { name: /^validate$/i }));
    expect(screen.getByText(/map is valid/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^done$/i }));
    expect(screen.getByText(/tap a node, location, corridor or fixture/i)).toBeTruthy();
    location.hash = "";
  });
});

describe("history", () => {
  test("a finished trip is recorded, shows vs your last trip on the next one, and reopens read-only from the sheet", async () => {
    const run = async (items: string) => {
      add(items);
      fireEvent.click(await findButton(/route [1-9]\d* items?/i));
      while (screen.queryByRole("button", { name: /got it/i })) fireEvent.click(screen.getByRole("button", { name: /got it/i }));
      await find(/trip done/i);
    };
    render(<App bundle={demoSupercenter} />);
    await run("milk, eggs");
    expect(screen.queryByTestId("vs-last")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    fireEvent.click(await findButton(/^milk$/i));
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    fireEvent.click(await findButton(/^eggs$/i));
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    await run("bread, bananas, rice");
    expect(screen.getAllByTestId("vs-last")[0].textContent).toMatch(/your last trip/i);
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    fireEvent.click((await screen.findAllByRole("button", { name: /^lists$/i }))[0]);
    const sheet = screen.getByRole("dialog", { name: /^lists$/i });
    const rows = within(within(sheet).getByRole("region", { name: /history/i })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    fireEvent.click(within(rows[1]).getByRole("button"));
    expect(screen.getAllByLabelText(/trip card/i)[0].textContent).toMatch(/2 of 2 items/);
    expect(screen.getByRole("button", { name: /share card/i })).toBeTruthy();
    expect(screen.queryByText(/make the map better/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(await screen.findAllByRole("button", { name: /^lists$/i })).toBeTruthy();
  });
});

describe("brand memory", () => {
  test("a confirmed full form is offered when a shorter form is typed; tapping accepts it", async () => {
    render(<App bundle={demoSupercenter} />);
    add("Chobani greek yogurt");
    fireEvent.click(await findButton(/route 1 item/i));
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    await find(/trip done/i);
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    fireEvent.click(await findButton(/greek yogurt/i));
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    add("yogurt");
    const chip = await screen.findByTestId("suggest", {}, { timeout: 10_000 });
    expect(chip.textContent).toBe("Chobani greek yogurt?");
    fireEvent.click(chip);
    expect(await find(/1 item · 1 placed/i)).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("suggest")).toBeNull());
    expect(within(screen.getByRole("list")).getAllByRole("listitem")[0].textContent).toMatch(/greek yogurt/i);
  });
});

describe("usual-trip prediction", () => {
  test("with an empty draft and a usual trip, the list offers today's usual trip; Load fills the draft", async () => {
    render(<App bundle={demoSupercenter} />);
    add("milk, eggs, bread");
    fireEvent.click(await findButton(/route 3 items/i));
    while (screen.queryByRole("button", { name: /got it/i })) fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    await find(/trip done/i);
    fireEvent.click(screen.getByRole("button", { name: /save as usual trip/i }));
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    for (const name of ["milk", "eggs", "bread"]) {
      fireEvent.click(await findButton(new RegExp(`^${name}$`, "i")));
      fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    }
    const row = await screen.findByTestId("usual-row");
    const weekday = new Date().toLocaleDateString("en-US", { weekday: "long" });
    expect(row.textContent).toMatch(new RegExp(`Your usual ${weekday} trip · 3 items`));
    fireEvent.click(within(row).getByRole("button", { name: /load/i }));
    expect(await find(/3 items · 3 placed/i)).toBeTruthy();
    expect(screen.queryByTestId("usual-row")).toBeNull();
  });
});

describe("settings", () => {
  test("the gear opens the resolver settings; switching to the worker is saved per device", async () => {
    render(<App bundle={demoSupercenter} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^settings$/i })[0]);
    const dialog = screen.getByRole("dialog", { name: /settings/i });
    expect(within(dialog).getByRole("radio", { name: /local ollama/i }).getAttribute("aria-checked")).toBe("true");
    expect(within(dialog).getByLabelText(/^model$/i)).toBeTruthy();
    expect(within(dialog).getByLabelText(/sign model/i)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("radio", { name: /worker/i }));
    const url = within(dialog).getByLabelText(/resolver url/i) as HTMLInputElement;
    fireEvent.change(url, { target: { value: "https://r.example/" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));
    expect(screen.queryByRole("dialog", { name: /settings/i })).toBeNull();
    expect(load("grosher.resolver", null)).toMatchObject({ provider: "worker", workerUrl: "https://r.example" });
    // the choice survives a reload and Reset puts the defaults back
    fireEvent.click(screen.getAllByRole("button", { name: /^settings$/i })[0]);
    const again = screen.getByRole("dialog", { name: /settings/i });
    expect(within(again).getByRole("radio", { name: /worker/i }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(again).getByRole("button", { name: /reset to defaults/i }));
    expect(localStorage.getItem("grosher.resolver")).toBeNull();
  });
});

describe("confidence bands", () => {
  test("the list shows all three bands; the trip sheet flags a guess; a missed guess is asked about at checkout", async () => {
    // ghee: a memory row at .65 → likely; milk: catalog → confirmed; zorbo milk: llm → guess
    await saveLearning("demo-supercenter", { pending: [], llm: [], memory: [{ name: "ghee", locationId: "A7-L11", confidence: 0.65, confirms: 1, lastConfirmed: Date.now() }] });
    render(<App bundle={demoSupercenter} />);
    add("milk, ghee, zorbo milk");
    const list = screen.getByRole("list");
    await waitFor(() => expect(within(list).getAllByRole("listitem").map((li) => li.getAttribute("data-band"))).toEqual(["confirmed", "likely", "guess"]), { timeout: 10_000 });
    const rows = within(list).getAllByRole("listitem");
    expect(within(rows[0]).getByTitle(/confirmed · 100%/i).style.opacity).toBe("1");
    expect(within(rows[1]).getByTitle(/likely · 65%/i).style.opacity).toBe("0.8");
    expect(within(rows[2]).getByText(/^probably /i).className).toContain("guess");

    fireEvent.click(await findButton(/route 3 items/i));
    // walk to the guess (route order is the solver's): skip through until the sheet shows the guess line
    for (let i = 0; i < 3 && !screen.queryByTestId("trip-guess"); i++) fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    expect(screen.getByTestId("trip-guess").textContent).toMatch(/probably here · tell me if not/i);
    fireEvent.click(screen.getByRole("button", { name: /not here/i }));
    while (!screen.queryByText(/trip done/i)) fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    const ask = screen.getAllByTestId("improve-row").find((r) => /zorbo milk/i.test(r.textContent ?? ""))!;
    expect(within(ask).getByText(/a guess that was wrong/i)).toBeTruthy();
  });
});

describe("reset banner", () => {
  const flag = { id: "t_9", storeId: "demo-supercenter", date: new Date("2026-10-15T10:00:00").getTime(), reason: "aisle" as const, aisle: "A4", items: ["Paneer", "Ghee"], misses: 4, placed: 8 };

  test("a flagged store shows the banner; Dismiss hides it until a new flag; Review opens the editor on the aisle", () => {
    localStorage.setItem("grosher.reset.demo-supercenter", JSON.stringify({ flag, dismissedId: null }));
    const { unmount } = render(<App bundle={demoSupercenter} />);
    const banner = screen.getByTestId("reset-banner");
    expect(banner.textContent).toMatch(/Demo Supercenter may have moved things · 4 misses on Thursday/);
    fireEvent.click(within(banner).getByRole("button", { name: /review/i }));
    expect(location.hash).toMatch(/^#\/edit\?aisle=A4&items=Paneer%2CGhee/);
    unmount();
    location.hash = "";
    localStorage.setItem("grosher.reset.demo-supercenter", JSON.stringify({ flag, dismissedId: null }));
    render(<App bundle={demoSupercenter} />);
    fireEvent.click(within(screen.getByTestId("reset-banner")).getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByTestId("reset-banner")).toBeNull();
    expect(load<{ dismissedId: string }>("grosher.reset.demo-supercenter", { dismissedId: "" }).dismissedId).toBe("t_9");
  });

  test("the editor opened from the banner highlights the aisle and lists the items", () => {
    location.hash = "#/edit?aisle=A4&items=Paneer%2CGhee&misses=4&date=0";
    try {
      render(<App bundle={demoSupercenter} />);
      const panel = screen.getByTestId("ed-focus");
      expect(panel.textContent).toMatch(/Possibly reset · A4/);
      expect(within(panel).getByText("Paneer")).toBeTruthy();
      expect(within(panel).getByText("Ghee")).toBeTruthy();
      expect(screen.getAllByTestId("focus-aisle").length).toBeGreaterThan(0);
      fireEvent.click(within(panel).getByRole("button", { name: /close review/i }));
      expect(screen.queryByTestId("ed-focus")).toBeNull();
      expect(screen.queryAllByTestId("focus-aisle")).toHaveLength(0);
    } finally {
      location.hash = "";
    }
  });

  test("a finished trip with enough misses raises the flag", async () => {
    render(<App bundle={demoSupercenter} />);
    add("milk, bananas, rice, ice cream");
    fireEvent.click(await findButton(/route 4 items/i));
    fireEvent.click(screen.getByRole("button", { name: /not here/i }));
    while (!screen.queryByText(/trip done/i)) fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    await waitFor(() => expect(load<{ flag?: unknown }>("grosher.reset.demo-supercenter", {}).flag).toMatchObject({ reason: "share", misses: 1, placed: 4 }));
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(screen.getByTestId("reset-banner").textContent).toMatch(/1 miss on/);
  });
});

describe("picker on the guess", () => {
  test("Tell me where opens on the map's guess; It's here confirms in one tap; an unknown has no guess", async () => {
    render(<App bundle={demoSupercenter} />);
    add("zorbo milk, unicorn");
    const list = screen.getByRole("list");
    await waitFor(() => expect(within(list).getAllByRole("listitem")[0].getAttribute("data-band")).toBe("guess"), { timeout: 10_000 });
    const rows = within(list).getAllByRole("listitem");
    // the guess row: select it, Tell me where is behind the chip? the row's chip is the guess; use the unknown first
    fireEvent.click(within(rows[1]).getByRole("button", { name: /tell me where/i }));
    const unknownDialog = screen.getByRole("dialog", { name: /where is unicorn/i });
    expect(within(unknownDialog).queryByTestId("its-here")).toBeNull();
    expect(within(unknownDialog).getByText(/nothing picked yet/i)).toBeTruthy();
    fireEvent.click(within(unknownDialog).getByRole("button", { name: /^close$/i }));
    // the guess row through the checkout's Pick aisle path is the same picker; open it directly via the row's chip menu
    fireEvent.click(within(rows[0]).getByRole("button", { name: /zorbo milk/i }));
    const guessLoc = (await import("../src/lib/learning.ts")).loadLearning;
    void guessLoc;
    // the picker for a placed item is reached from the trip's checkout ("Pick aisle"); exercise the component contract here
    const { PickerSheet } = await import("../src/components/PickerSheet.tsx");
    let confirmedAt: string | null = null;
    let picked: string | null = null;
    const { unmount } = render(<PickerSheet store={demoSupercenter.store} itemName="Zorbo milk" guessLocationId="DAIRY-L5" onConfirm={(id) => (confirmedAt = id)} onPick={(id) => (picked = id)} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: /where is zorbo milk/i });
    expect(within(dialog).getByText(/map's guess · /i)).toBeTruthy();
    fireEvent.click(within(dialog).getByTestId("its-here"));
    expect(confirmedAt).toBe("DAIRY-L5");
    expect(picked).toBeNull();
    unmount();
  });

  test("Pick aisle at checkout opens on the guess and It's here confirms the memory", async () => {
    render(<App bundle={demoSupercenter} />);
    add("zorbo milk, milk");
    await waitFor(() => expect(within(screen.getByRole("list")).getAllByRole("listitem")[0].getAttribute("data-band")).toBe("guess"), { timeout: 10_000 });
    fireEvent.click(await findButton(/route 2 items/i));
    // skip the guess when it comes up, collect the rest
    while (!screen.queryByText(/trip done/i)) {
      if (screen.queryByTestId("trip-guess")) fireEvent.click(screen.getByRole("button", { name: /not here/i }));
      else fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    }
    fireEvent.click(screen.getAllByRole("button", { name: /pick aisle/i })[0]);
    const dialog = screen.getByRole("dialog", { name: /where is zorbo milk/i });
    expect(within(dialog).getByTestId("its-here")).toBeTruthy();
    fireEvent.click(within(dialog).getByTestId("its-here"));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    // confirmed: the row now resolves from memory at .8 → confirmed band
    await waitFor(() => expect(within(screen.getByRole("list")).getAllByRole("listitem")[0].getAttribute("data-source")).toBe("memory"), { timeout: 10_000 });
    expect(within(screen.getByRole("list")).getAllByRole("listitem")[0].getAttribute("data-band")).toBe("confirmed");
  });
});

describe("editor categories", () => {
  test("the Categories layer labels every slot, the tool picks a category, Validate reports the counts", async () => {
    location.hash = "#/edit";
    try {
      render(<App bundle={demoSupercenter} />);
      await screen.findByText(/map v/i);
      expect(screen.getByText(/298 categories/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: /^categories$/i }));
      expect(document.querySelectorAll("[data-category]").length).toBe(298);
      fireEvent.click(screen.getByRole("button", { name: /^category$/i }));
      const picker = screen.getByTestId("category-picker");
      fireEvent.change(within(picker).getByLabelText(/search categories/i), { target: { value: "ghee" } });
      const ghee = within(picker).getByRole("button", { name: /ghee & indian cooking oils/i });
      fireEvent.click(ghee);
      expect(ghee.getAttribute("aria-pressed")).toBe("true");
      expect(picker.textContent).toMatch(/now at A7-L11 · tap the slot/);
      fireEvent.click(screen.getByRole("button", { name: /^validate$/i }));
      expect(screen.getByText(/298 categories · 298 with a slot · 0 slots without a category/)).toBeTruthy();
    } finally {
      location.hash = "";
    }
  });
});
