import { beforeEach, describe, expect, test } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { dbClearMemoryFallback, dbGet } from "../src/lib/db.ts";
import { cachedDish, dishAskerFor, dishKey, parseDishes, resolveUnknown, tableFirst, type DishAsker } from "../src/lib/meals.ts";
import { mergeIntoList } from "../src/lib/mealsMerge.ts";
import { DEFAULT_SETTINGS } from "../src/lib/settings.ts";
import { MealSheet } from "../src/components/MealSheet.tsx";

beforeEach(() => dbClearMemoryFallback());

const line = (name: string, quantity: number, unit: string, pantryStaple = false) => ({ name, quantity, unit, optional: false, pantryStaple });
const CARBONARA = [line("spaghetti", 200, "g"), line("egg yolk", 3, "piece"), line("parmesan cheese", 50, "g"), line("pancetta", 150, "g"), line("black pepper", 1, "tsp", true)];
const fakeAsker = (answer: (dish: string) => typeof CARBONARA | null): DishAsker & { asked: string[][] } => {
  const asked: string[][] = [];
  return { name: "ollama", asked, ask: async (dishes) => (asked.push(dishes), dishes.map((dish) => ({ dish, ingredients: answer(dish) }))) };
};

describe("cook mode: the plan", () => {
  test("dishes split on commas, 'and' only between dishes; the table answers first", () => {
    expect(parseDishes("mac and cheese, rajma and poha\nfish & chips")).toEqual(["mac and cheese", "rajma", "poha", "fish & chips"]);
    const t = tableFirst(["dal chawal", "Dal Chawal", "rajma", "pasta carbonara"]);
    expect(t.states.map((s) => [s.name, s.status])).toEqual([["Dal chawal", "table"], ["Rajma chawal", "table"], ["Pasta carbonara", "asking"]]);
    expect(t.unknown).toEqual(["pasta carbonara"]);
  });

  test("the model's answers are validated and cached; a cached dish never asks again", async () => {
    const asker = fakeAsker(() => CARBONARA);
    const got: string[] = [];
    await resolveUnknown(["pasta carbonara"], asker, (q, r) => got.push(`${q}:${r?.state.status}:${r?.planned.items.length}`));
    expect(got).toEqual(["pasta carbonara:model:5"]);
    expect((await cachedDish("Pasta  Carbonara"))?.ingredients).toHaveLength(5);
    expect(dishKey("Pasta Carbonara")).toBe("dish:pasta carbonara:2");
    await resolveUnknown(["Pasta carbonara"], asker, () => {});
    expect(asker.asked).toEqual([["pasta carbonara"]]);
    // nothing usable: unanswered, and nothing cached
    const empty = fakeAsker(() => null);
    const out: unknown[] = [];
    await resolveUnknown(["beef rendang"], empty, (_q, r) => out.push(r));
    expect(out).toEqual([null]);
    expect(await dbGet(dishKey("beef rendang"), "none")).toBe("none");
  });

  test("into the list: a plain item gives way to the line with its quantity; nothing twice", () => {
    expect(mergeIntoList(["onions", "milk", "Basmati rice 1 kg"], ["Onions × 6", "Basmati rice 2 kg", "Toor dal 500 g"])).toEqual(["Onions × 6", "milk", "Basmati rice 1 kg", "Toor dal 500 g"]);
    expect(mergeIntoList([], ["Eggs pack of 6", "Eggs pack of 12"])).toEqual(["Eggs pack of 6"]);
  });
});

describe("cook mode: the providers (local model only)", () => {
  test("direct Ollama: one call a dish with the shared schema; unreachable → every dish unanswered, not one timeout each", async () => {
    const sent: { url: string; body: { messages: { content: string }[]; format: { required: string[] }; think: boolean } }[] = [];
    const ok = (async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ message: { content: JSON.stringify({ ingredients: CARBONARA }) } }));
    }) as unknown as typeof fetch;
    const replies = await dishAskerFor({ ...DEFAULT_SETTINGS, provider: "ollama", ollamaUrl: "http://mac:11434/" }, ok).ask(["A", "B"]);
    expect(replies.map((r) => r.ingredients?.length)).toEqual([5, 5]);
    expect(sent.map((s) => [s.url, s.body.messages[1].content, s.body.format.required[0], s.body.think])).toEqual([
      ["http://mac:11434/api/chat", "Dish: A", "ingredients", false],
      ["http://mac:11434/api/chat", "Dish: B", "ingredients", false],
    ]);
    let calls = 0;
    const down = (async () => {
      calls++;
      throw new TypeError("offline");
    }) as typeof fetch;
    expect(await dishAskerFor({ ...DEFAULT_SETTINGS, provider: "ollama" }, down).ask(["A", "B", "C"])).toEqual([
      { dish: "A", ingredients: null },
      { dish: "B", ingredients: null },
      { dish: "C", ingredients: null },
    ]);
    expect(calls).toBe(1);
  });

  test("the worker: one POST /dishes for the batch; a degraded answer leaves those dishes unanswered", async () => {
    let body: unknown = null;
    const w = (async (url: string, init: RequestInit) => {
      body = { url, ...JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ degraded: true, results: [{ dish: "A", ingredients: CARBONARA }, { dish: "B", ingredients: null }] }));
    }) as unknown as typeof fetch;
    const replies = await dishAskerFor({ ...DEFAULT_SETTINGS, provider: "worker", workerUrl: "https://w.example/" }, w).ask(["A", "B"]);
    expect(body).toEqual({ url: "https://w.example/dishes", dishes: ["A", "B"] });
    expect(replies.map((r) => r.ingredients?.length ?? null)).toEqual([5, null]);
  });
});

describe("cook mode: the sheet", () => {
  test("dishes → review (by dish, merged, pantry unticked, model lines estimated) → edited lines onto the list", async () => {
    let added: string[] = [];
    render(<MealSheet settings={DEFAULT_SETTINGS} asker={fakeAsker((d) => (/carbonara/i.test(d) ? CARBONARA : null))} onAdd={(l) => (added = l)} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Dishes"), { target: { value: "dal chawal, pasta carbonara, beef rendang" } });
    fireEvent.click(screen.getByRole("button", { name: "More people" }));
    fireEvent.click(screen.getByRole("button", { name: "Make the list" }));
    await waitFor(() => expect(screen.queryByText("Asking the local model…")).toBeNull());
    const dishes = screen.getAllByTestId("meal-dish");
    expect(dishes.map((d) => d.dataset.status)).toEqual(["table", "model", "unanswered"]);
    expect(within(dishes[1]).getByText("estimated")).toBeTruthy();
    expect(within(dishes[2]).getByText(/Needs your laptop's model/)).toBeTruthy();
    // three people: dal chawal's 150 g of toor dal for two is 225 g, still one 500 g pack; one onion is two
    expect((screen.getByLabelText("Edit Onions") as HTMLInputElement).value).toBe("Onions × 2");
    expect((screen.getByLabelText("Edit Eggs") as HTMLInputElement).value).toBe("Eggs pack of 6");
    expect((screen.getByLabelText("Buy Salt 1 kg") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Buy Toor dal 500 g") as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText("Edit Onions"), { target: { value: "Red onions × 3" } });
    fireEvent.click(screen.getByLabelText("Remove Ghee"));
    fireEvent.click(screen.getByTestId("meal-add"));
    expect(added).toContain("Red onions × 3");
    expect(added).toContain("Toor dal 500 g");
    expect(added.some((l) => /^Ghee/.test(l))).toBe(false);
    expect(added.some((l) => /^Salt/.test(l))).toBe(false);
  });
});
