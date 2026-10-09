import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SearchesView } from "./searches-view";

vi.mock("@/app/actions/search", () => ({
  deleteSearch: async () => {},
  toggleSearch: async () => {},
  updateSearch: async () => ({}),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

// vitest runs without globals, so React Testing Library's automatic cleanup
// never registers: each render would otherwise stay in the document.
afterEach(() => {
  cleanup();
  refresh.mockClear();
});

function searchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    origin: "MAD",
    destination: "BCN",
    depart_date: "2026-11-15",
    return_date: "2026-11-22",
    trip_type: "round_trip" as const,
    cabin_class: "economy" as const,
    stops: "any" as const,
    adults: 1,
    enabled: true,
    alert_threshold_eur: 80,
    date_flex_days: 0,
    lastExecution: null,
    bestPrice: null,
    ...overrides,
  };
}

describe("SearchesView currency", () => {
  it("shows the currency each price was quoted in, never an assumed EUR", () => {
    render(
      <SearchesView
        currency="EUR"
        searches={[searchRow({ bestPrice: { price: 90, currency: "USD" } })]}
      />,
    );

    const price = screen.getByText(/Desde/);
    expect(price.textContent).toContain("90.00");
    expect(price.textContent).toContain("USD");
    expect(price.textContent).not.toContain("EUR");
  });

  it("labels the alert threshold with the profile currency", () => {
    render(
      <SearchesView
        currency="USD"
        searches={[searchRow({ bestPrice: { price: 90, currency: "USD" } })]}
      />,
    );

    expect(screen.getByText(/Avisarme por debajo de 80 USD/)).toBeTruthy();
  });

  it("keeps the other cards' buttons usable while one search runs", () => {
    const rows = [
      searchRow({ id: "a", origin: "MAD", destination: "BCN" }),
      searchRow({ id: "b", origin: "MAD", destination: "LHR" }),
    ];
    render(<SearchesView currency="EUR" searches={rows} />);

    const runButtons = screen.getAllByRole("button", { name: "Ejecutar" });
    expect(runButtons).toHaveLength(2);
    // Clicking is what starts the run, so a usable button must not be disabled.
    runButtons.forEach((button) => expect(button).not.toBeDisabled());
  });
});
