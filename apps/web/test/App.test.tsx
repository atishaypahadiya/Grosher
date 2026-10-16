import { beforeEach, describe, expect, test } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "../src/App.tsx";

beforeEach(() => localStorage.clear());

describe("list screen", () => {
  test("plans a route from typed items and reports the ones it cannot find", () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText(/your list/i), { target: { value: "milk\neggs\nunicorn\nBananas" } });
    fireEvent.click(screen.getByRole("button", { name: /plan route/i }));

    expect(screen.getByText(/not found in this store: unicorn/i)).toBeTruthy();
    expect(screen.getByText(/3 stops/)).toBeTruthy();
    const legs = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(legs).toHaveLength(3);
    // route drawn on the map with three numbered stops
    expect(document.querySelectorAll("[data-stop]")).toHaveLength(3);
    expect(screen.getByRole("button", { name: /start trip/i })).toBeTruthy();
  });

  test("asks for an item when the list is empty", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /plan route/i }));
    expect(screen.getByText(/add at least one item/i)).toBeTruthy();
  });
});

describe("trip mode", () => {
  test("list in, route, check off, reroute, checkout card", () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText(/your list/i), { target: { value: "bread\nmilk\nbananas\nice cream" } });
    fireEvent.click(screen.getByRole("button", { name: /plan route/i }));
    fireEvent.click(screen.getByRole("button", { name: /start trip/i }));

    expect(screen.getByText(/stop 1 of 4/i)).toBeTruthy();
    expect(document.querySelector('[data-landmark="you"]')).not.toBeNull();
    expect(document.querySelectorAll("[data-stop]")).toHaveLength(4);
    const first = screen.getByRole("heading", { level: 2 }).textContent;

    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    expect(screen.getByText(/stop 2 of 4/i)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2 }).textContent).not.toBe(first);
    expect(document.querySelectorAll("[data-stop]")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: /not here/i }));
    expect(screen.getByText(/stop 3 of 4/i)).toBeTruthy();

    // forgot coffee: added mid-trip, rerouted
    fireEvent.change(screen.getByPlaceholderText(/coffee/i), { target: { value: "Coffee" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(screen.getByText(/stop 3 of 5/i)).toBeTruthy();
    expect(document.querySelectorAll("[data-stop]")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));

    const card = screen.getByTestId("checkout-card");
    expect(within(card).getByText(/4 in the cart/i)).toBeTruthy();
    expect(within(card).getByText(/not found on the shelf/i)).toBeTruthy();
    expect(within(card).getByText(/^saved$/i)).toBeTruthy();
    expect(document.querySelectorAll("[data-stop]")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /finish trip/i }));
    expect(screen.getByRole("button", { name: /plan route/i })).toBeTruthy();
    expect(localStorage.getItem("grosher.trip")).toBeNull();
  });

  test("a trip survives a reload", () => {
    const { unmount } = render(<App />);
    fireEvent.change(screen.getByLabelText(/your list/i), { target: { value: "milk\neggs" } });
    fireEvent.click(screen.getByRole("button", { name: /plan route/i }));
    fireEvent.click(screen.getByRole("button", { name: /start trip/i }));
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    unmount();
    render(<App />);
    expect(screen.getByText(/stop 2 of 2/i)).toBeTruthy();
  });
});
