import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SearchForm } from "./search-form";

vi.mock("@/app/actions/search", () => ({ createSearch: async () => ({}) }));

describe("SearchForm", () => {
  it("starts as one-way and only enables the return date on round trip", async () => {
    const { container } = render(<SearchForm />);

    const returnDate = screen.getByLabelText("Regreso") as HTMLInputElement;
    const tripType = () =>
      (
        container.querySelector(
          'input[name="trip_type"][type="hidden"]',
        ) as HTMLInputElement
      ).value;
    const checkbox = screen.getByRole("checkbox", {
      name: "Ida y vuelta",
    }) as HTMLInputElement;

    expect(checkbox).not.toBeChecked();
    expect(returnDate).toBeDisabled();
    expect(tripType()).toBe("one_way");

    await userEvent.click(checkbox);

    expect(returnDate).toBeEnabled();
    expect(tripType()).toBe("round_trip");
  });
});
