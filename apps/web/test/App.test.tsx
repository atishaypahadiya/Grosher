import { beforeEach, describe, expect, test } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "../src/App.tsx";
import { dbClearMemoryFallback } from "../src/lib/db.ts";

beforeEach(() => {
  localStorage.clear();
  dbClearMemoryFallback();
});

const add = (text: string) => {
  const input = screen.getByLabelText(/add items/i);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest("form")!);
};
const find = (re: RegExp) => screen.findByText(re, {}, { timeout: 3000 });
const findButton = (re: RegExp) => screen.findByRole("button", { name: re }, { timeout: 3000 });

describe("list screen", () => {
  test("resolves typed and comma-separated items with a source glyph, flags unknown ones", async () => {
    render(<App />);
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
    expect(within(rows[2]).getByText(/not placed yet/i, { selector: ".sub" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /route 2 items/i })).toBeTruthy();
  });

  test("an unknown item the resolver can place becomes an amber guess with its department", async () => {
    render(<App />);
    add("oat milk");
    expect(await find(/probably/i, )).toBeTruthy();
    const row = within(screen.getByRole("list")).getAllByRole("listitem")[0];
    await waitFor(() => expect(row.getAttribute("data-source")).toBe("llm"));
    expect(within(row).getByText(/probably .*plant milk/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /route 1 item/i })).toBeTruthy();
  });

  test("Tell me where opens the picker; Remove drops a row", async () => {
    render(<App />);
    add("milk, unicorn");
    fireEvent.click(await findButton(/tell me where/i));
    expect(screen.getByRole("dialog", { name: /where is unicorn/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^milk$/i }));
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(await find(/1 item · 0 placed/i)).toBeTruthy();
  });

  test("empty list shows the disabled call to action", () => {
    render(<App />);
    expect((screen.getByRole("button", { name: /route 0 items/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("trip mode", () => {
  test("list in, route, check off, reroute, checkout card, share and usual trip", async () => {
    render(<App />);
    add("bread, milk, bananas, ice cream, ghee");
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
    expect(screen.getByText(/where did you find the ghee/i)).toBeTruthy();
    // Pick aisle opens the picker
    fireEvent.click(screen.getAllByRole("button", { name: /pick aisle/i })[0]);
    const dialog = screen.getByRole("dialog", { name: /where is/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /^close$/i }));
    expect(screen.getByRole("button", { name: /share card/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /save as usual trip/i }));
    expect(screen.getByRole("button", { name: /saved as usual/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(localStorage.getItem("grosher.trip")).toBeNull();

    fireEvent.click(await findButton(/^milk$/i));
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    fireEvent.click(screen.getByRole("button", { name: /usual trip/i }));
    expect(await find(/5 items · 5 placed/i)).toBeTruthy();
  });

  test("progress strip, back pauses, the list resumes", async () => {
    render(<App />);
    add("milk, eggs, bread");
    fireEvent.click(await findButton(/route 3 items/i));
    const bar = screen.getByRole("progressbar");
    expect(bar.querySelectorAll(".seg")).toHaveLength(3);
    expect(bar.querySelectorAll(".seg.current")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    expect(bar.querySelectorAll(".seg.done")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /flatten the map/i }));
    expect(localStorage.getItem("grosher.flat")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /back to the list/i }));
    fireEvent.click(await findButton(/resume trip · 2 left/i));
    expect(screen.getByText(/next · 2 of 3/i)).toBeTruthy();
  });

  test("a trip survives a reload", async () => {
    const { unmount } = render(<App />);
    add("milk, eggs");
    fireEvent.click(await findButton(/route 2 items/i));
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    unmount();
    render(<App />);
    expect(screen.getByText(/next · 2 of 2/i)).toBeTruthy();
  });
});

describe("editor", () => {
  test("#/edit opens the editor with stats, tools, layers and the inspector", () => {
    location.hash = "#/edit";
    render(<App />);
    expect(screen.getByText(/nodes · .* edges · .* locations · 9 textures · 0 unreachable/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /shelf location/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /preview in 3d/i })).toBeTruthy();
    expect(screen.getByRole("group", { name: /layers/i }).querySelectorAll("button")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: /^validate$/i }));
    expect(screen.getByText(/map is valid/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^done$/i }));
    expect(screen.getByText(/tap a node, location, corridor or fixture/i)).toBeTruthy();
    location.hash = "";
  });
});
