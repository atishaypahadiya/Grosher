import { beforeEach, describe, expect, test } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { dbClearMemoryFallback, dbGet } from "../src/lib/db.ts";
import { cacheDish, cachedDish, dishAskerFor, dishKey, parseDishes, startUnknown, tableFirst, type DishAsker, type DishOutcome } from "../src/lib/meals.ts";
import { dbSet } from "../src/lib/db.ts";
import { DISH_TABLE_HASH } from "@grosher/stores/meals";
import { mergeIntoList } from "../src/lib/mealsMerge.ts";
import { DEFAULT_SETTINGS } from "../src/lib/settings.ts";
import { MealSheet } from "../src/components/MealSheet.tsx";

beforeEach(() => dbClearMemoryFallback());

const line = (name: string, quantity: number, unit: string, pantryStaple = false) => ({ name, quantity, unit, optional: false, pantryStaple });
const CARBONARA = [line("spaghetti", 200, "g"), line("egg yolk", 3, "piece"), line("parmesan cheese", 50, "g"), line("pancetta", 150, "g"), line("black pepper", 1, "tsp", true)];
/** answers each dish after `delayMs(dish)` (0 by default); records what it was asked and what was aborted */
const fakeAsker = (answer: (dish: string) => typeof CARBONARA | null, delayMs: (dish: string) => number = () => 0): DishAsker & { asked: string[]; aborted: string[] } => {
  const asked: string[] = [];
  const aborted: string[] = [];
  return {
    name: "ollama",
    asked,
    aborted,
    askOne: (dish, signal) =>
      new Promise((resolve) => {
        asked.push(dish);
        const t = setTimeout(() => resolve(answer(dish)), delayMs(dish));
        signal?.addEventListener("abort", () => (clearTimeout(t), aborted.push(dish), resolve(null)));
      }),
  };
};
/** every outcome, then the run's end */
const runAll = async (queries: string[], asker: DishAsker) => {
  const out: [string, DishOutcome][] = [];
  await startUnknown(queries, asker, (q, o) => out.push([q, o])).done;
  return out;
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
    const got = (await runAll(["pasta carbonara"], asker)).map(([q, o]) => `${q}:${typeof o === "object" ? `${o?.state.status}:${o?.planned.items.length}` : o}`);
    expect(got).toEqual(["pasta carbonara:model:5"]);
    expect((await cachedDish("Pasta  Carbonara"))?.ingredients).toHaveLength(5);
    expect(dishKey("Pasta Carbonara")).toBe("dish:pasta carbonara:2");
    await runAll(["Pasta carbonara"], asker);
    expect(asker.asked).toEqual(["pasta carbonara"]);
    // nothing usable: unanswered, and nothing cached
    expect(await runAll(["beef rendang"], fakeAsker(() => null))).toEqual([["beef rendang", "unanswered"]]);
    expect(await dbGet(dishKey("beef rendang"), "none")).toBe("none");
  });

  test("precedence: the table beats a cached model answer; an answer from another table version is dropped", async () => {
    // a phone that asked the model for rogan josh before it was in the table
    await cacheDish("rogan josh", CARBONARA, "an-older-table");
    const asker = fakeAsker(() => CARBONARA);
    render(<MealSheet settings={DEFAULT_SETTINGS} asker={asker} onAdd={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Dishes"), { target: { value: "rogan josh" } });
    fireEvent.click(screen.getByRole("button", { name: "Make the list" }));
    expect(screen.getByTestId("meal-dish").dataset.status).toBe("table");
    expect((screen.getByLabelText("Edit Lamb") as HTMLInputElement).value).toBe("Lamb 1 kg");
    expect(screen.queryByText("estimated")).toBeNull();
    await waitFor(async () => expect(await dbGet(dishKey("rogan josh"), "gone")).toBe("gone"));
    expect(asker.asked).toEqual([]);
    // even under this table's hash, a table dish never reads the cache
    await cacheDish("sarson ka saag", CARBONARA);
    expect(tableFirst(["sarson ka saag"]).states[0].status).toBe("table");
    // a dish the table does not know: a stale answer (another hash, or none from before the stamp) is asked again
    await cacheDish("beef rendang", CARBONARA, "an-older-table");
    await dbSet(dishKey("laksa"), { dish: "laksa", ingredients: CARBONARA, at: 1 });
    expect(await cachedDish("beef rendang")).toBeNull();
    expect(await cachedDish("laksa")).toBeNull();
    expect(await dbGet(dishKey("beef rendang"), "gone")).toBe("gone");
    const again = fakeAsker(() => CARBONARA);
    await runAll(["beef rendang"], again);
    expect(again.asked).toEqual(["beef rendang"]);
    expect((await cachedDish("beef rendang"))?.table).toBe(DISH_TABLE_HASH);
  });

  test("each dish lands on its own: a slow one holds up no other, three are asked at once, one can be cancelled", async () => {
    const slow = new Set(["beef rendang"]);
    const asker = fakeAsker(() => CARBONARA, (d) => (slow.has(d) ? 400 : 20));
    const order: string[] = [];
    const run = startUnknown(["beef rendang", "laksa", "pho", "bibimbap"], asker, (q, o) => order.push(`${q}:${typeof o === "object" ? "model" : o}`));
    await new Promise((r) => setTimeout(r, 5));
    expect(asker.asked).toEqual(["beef rendang", "laksa", "pho"]); // three in flight, the fourth waits its turn
    await new Promise((r) => setTimeout(r, 120));
    expect(order).toEqual(["laksa:model", "pho:model", "bibimbap:model"]); // the slow one has not held them up
    run.cancel("beef rendang");
    await run.done;
    expect(order).toEqual(["laksa:model", "pho:model", "bibimbap:model", "beef rendang:cancelled"]);
    expect(asker.aborted).toEqual(["beef rendang"]);
    expect(await dbGet(dishKey("beef rendang"), "none")).toBe("none");
    // stopping them all: nothing settles after
    const late: string[] = [];
    const all = startUnknown(["tom yum"], fakeAsker(() => CARBONARA, () => 50), (q) => late.push(q));
    all.cancelAll();
    await all.done;
    expect(late).toEqual([]);
  });

  test("into the list: a plain item gives way to the line with its quantity; nothing twice", () => {
    expect(mergeIntoList(["onions", "milk", "Basmati rice 1 kg"], ["Onions × 6", "Basmati rice 2 kg", "Toor dal 500 g"])).toEqual(["Onions × 6", "milk", "Basmati rice 1 kg", "Toor dal 500 g"]);
    expect(mergeIntoList([], ["Eggs pack of 6", "Eggs pack of 12"])).toEqual(["Eggs pack of 6"]);
  });
});

describe("cook mode: the providers (local model only)", () => {
  test("direct Ollama: one call a dish with the shared compact schema; unreachable → null at once", async () => {
    const sent: { url: string; body: { messages: { content: string }[]; format: { required: string[] }; think: boolean; options: { num_predict: number } } }[] = [];
    const ok = (async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ message: { content: JSON.stringify({ ingredients: [{ name: "spaghetti", amount: "200 g" }, { name: "egg yolk", amount: "3 piece" }] }) } }));
    }) as unknown as typeof fetch;
    const asker = dishAskerFor({ ...DEFAULT_SETTINGS, provider: "ollama", ollamaUrl: "http://mac:11434/" }, ok);
    expect(await asker.askOne("A")).toEqual([line("spaghetti", 200, "g"), line("egg yolk", 3, "piece")]);
    expect(sent.map((s) => [s.url, s.body.messages[1].content, s.body.format.required[0], s.body.think, s.body.options.num_predict])).toEqual([["http://mac:11434/api/chat", "Dish: A", "ingredients", false, 240]]);
    const down = (async () => {
      throw new TypeError("offline");
    }) as typeof fetch;
    expect(await dishAskerFor({ ...DEFAULT_SETTINGS, provider: "ollama" }, down).askOne("A")).toBeNull();
  });

  test("the worker: one POST /dishes a dish; a degraded answer is null", async () => {
    const bodies: unknown[] = [];
    const w = (async (url: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body));
      bodies.push({ url, ...b });
      return new Response(JSON.stringify(b.dishes[0] === "B" ? { degraded: true, results: [{ dish: "B", ingredients: null }] } : { results: [{ dish: b.dishes[0], ingredients: CARBONARA }] }));
    }) as unknown as typeof fetch;
    const asker = dishAskerFor({ ...DEFAULT_SETTINGS, provider: "worker", workerUrl: "https://w.example/" }, w);
    const [a, b] = await Promise.all([asker.askOne("A"), asker.askOne("B")]);
    expect(bodies).toEqual([{ url: "https://w.example/dishes", dishes: ["A"] }, { url: "https://w.example/dishes", dishes: ["B"] }]);
    expect([a?.length, b]).toEqual([5, null]);
  });
});

describe("cook mode: the sheet", () => {
  test("dishes → review (by dish, merged, pantry unticked, model lines estimated) → edited lines onto the list", async () => {
    let added: string[] = [];
    render(<MealSheet settings={DEFAULT_SETTINGS} asker={fakeAsker((d) => (/carbonara/i.test(d) ? CARBONARA : null))} onAdd={(l) => (added = l)} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Dishes"), { target: { value: "dal chawal, pasta carbonara, beef rendang" } });
    fireEvent.click(screen.getByRole("button", { name: "More people" }));
    fireEvent.click(screen.getByRole("button", { name: "Make the list" }));
    await waitFor(() => expect(screen.queryByText(/Estimating/)).toBeNull());
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

  test("the table's dishes show at once; a model dish shows Estimating… until it lands, and Cancel stops it", async () => {
    const asker = fakeAsker((d) => (/carbonara/i.test(d) ? CARBONARA : null), (d) => (/rendang/i.test(d) ? 10_000 : 60));
    render(<MealSheet settings={DEFAULT_SETTINGS} asker={asker} onAdd={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Dishes"), { target: { value: "dal chawal, pasta carbonara, beef rendang" } });
    fireEvent.click(screen.getByRole("button", { name: "Make the list" }));
    const status = () => screen.getAllByTestId("meal-dish").map((d) => d.dataset.status);
    expect(status()).toEqual(["table", "asking", "asking"]);
    expect(screen.getAllByText("Estimating… with the local model")).toHaveLength(2);
    expect((screen.getByLabelText("Edit Toor dal") as HTMLInputElement).value).toBe("Toor dal 500 g"); // the table's lines, before any answer
    await waitFor(() => expect(status()).toEqual(["table", "model", "asking"]));
    expect((screen.getByLabelText("Edit Eggs") as HTMLInputElement).value).toBe("Eggs pack of 6");
    fireEvent.click(screen.getByRole("button", { name: "Stop estimating Beef rendang" }));
    expect(status()).toEqual(["table", "model", "cancelled"]);
    expect(asker.aborted).toEqual(["beef rendang"]);
    expect(screen.getByText(/Stopped · add its ingredients by hand/)).toBeTruthy();
    expect(screen.getByTestId("meal-add").textContent).toMatch(/^Add \d+ to list$/);
  });
});
