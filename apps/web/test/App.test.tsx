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
