import { beforeEach, describe, expect, test } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "../src/App.tsx";

beforeEach(() => localStorage.clear());

const add = (text: string) => {
  const input = screen.getByLabelText(/add items/i);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest("form")!);
};

describe("list screen", () => {
  test("adds typed and comma-separated items, places them, flags unknown ones", () => {
    render(<App />);
    add("milk");
    add("eggs, unicorn");
    expect(screen.getByText(/3 items · 2 placed/i)).toBeTruthy();
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText(/dairy · last/i)).toBeTruthy();
    expect(within(rows[2]).getByText(/not placed yet/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /route 2 items/i })).toBeTruthy();
    expect(screen.getByText(/shorter than walking your list in order|same as walking/i)).toBeTruthy();
  });

  test("removes an item and notes an unplaced one", () => {
    render(<App />);
    add("milk, unicorn");
    fireEvent.click(screen.getByRole("button", { name: /tell me where/i }));
    expect(screen.getByText(/^noted$/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^milk$/i }));
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(screen.getByText(/1 item · 0 placed/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: /route 0 items/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("empty list shows the muted call to action", () => {
    render(<App />);
    expect((screen.getByRole("button", { name: /route 0 items/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("trip mode", () => {
  test("list in, route, check off, reroute, checkout card, share and usual trip", () => {
    render(<App />);
    add("bread, milk, bananas, ice cream, ghee");
    fireEvent.click(screen.getByRole("button", { name: /route 4 items/i }));

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
    // one skipped item, one unplaced (ghee)
    expect(screen.getAllByTestId("improve-row")).toHaveLength(2);
    expect(screen.getByText(/where did you find the ghee/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /share card/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /save as usual trip/i }));
    expect(screen.getByRole("button", { name: /saved as usual/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(localStorage.getItem("grosher.trip")).toBeNull();

    // the usual trip reloads the list
    fireEvent.click(screen.getByRole("button", { name: /^milk$/i }));
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    fireEvent.click(screen.getByRole("button", { name: /usual trip/i }));
    expect(screen.getByText(/5 items · 5 placed/i)).toBeTruthy();
  });

  test("progress strip, back pauses, the list resumes", () => {
    render(<App />);
    add("milk, eggs, bread");
    fireEvent.click(screen.getByRole("button", { name: /route 3 items/i }));
    const bar = screen.getByRole("progressbar");
    expect(bar.querySelectorAll(".seg")).toHaveLength(3);
    expect(bar.querySelectorAll(".seg.current")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    expect(bar.querySelectorAll(".seg.done")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /flatten the map/i }));
    expect(localStorage.getItem("grosher.flat")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /back to the list/i }));
    fireEvent.click(screen.getByRole("button", { name: /resume trip · 2 left/i }));
    expect(screen.getByText(/next · 2 of 3/i)).toBeTruthy();
  });

  test("a trip survives a reload", () => {
    const { unmount } = render(<App />);
    add("milk, eggs");
    fireEvent.click(screen.getByRole("button", { name: /route 2 items/i }));
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    unmount();
    render(<App />);
    expect(screen.getByText(/next · 2 of 2/i)).toBeTruthy();
  });
});
