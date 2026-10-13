import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AlertHistory, PriceHistory } from "./price-history";

afterEach(cleanup);

const days = [
  { date: "2026-10-01", min: 60, max: 95, avg: 77.5, observations: 4 },
  { date: "2026-10-02", min: 89, max: 240, avg: 146, observations: 11 },
];

describe("PriceHistory", () => {
  it("summarises the combined observed range, not an invented point", () => {
    render(
      <PriceHistory
        days={days}
        currency="EUR"
        currentPrice={95}
        habitual={90}
        searchCount={2}
      />,
    );
    expect(screen.getByText(/mínimo del período 60\.00 EUR/)).toBeTruthy();
    expect(screen.getByText(/rango 60\.00–240\.00 EUR/)).toBeTruthy();
    expect(screen.getByText(/2 búsquedas de esta ruta combinadas/)).toBeTruthy();
  });

  it("compares the current price against the route's usual minimum", () => {
    render(
      <PriceHistory
        days={days}
        currency="EUR"
        currentPrice={45}
        habitual={90}
        searchCount={1}
      />,
    );
    expect(screen.getByText(/50% frente al habitual/)).toBeTruthy();
  });

  it("says the history is not a prediction", () => {
    render(
      <PriceHistory
        days={days}
        currency="EUR"
        currentPrice={95}
        habitual={90}
        searchCount={1}
      />,
    );
    expect(screen.getByText(/Histórico observado/)).toBeTruthy();
  });

  it("warns about the stored currency when the profile uses another one", () => {
    render(
      <PriceHistory
        days={days}
        currency="USD"
        currentPrice={95}
        habitual={90}
        searchCount={1}
      />,
    );
    expect(screen.getByText(/Histórico disponible en EUR/)).toBeTruthy();
  });

  it("stays silent about the currency when the profile is in EUR", () => {
    render(
      <PriceHistory
        days={days}
        currency="EUR"
        currentPrice={95}
        habitual={90}
        searchCount={1}
      />,
    );
    expect(screen.queryByText(/Histórico disponible en EUR/)).toBeNull();
  });

  it("asks for more runs instead of drawing an empty line", () => {
    render(
      <PriceHistory
        days={[]}
        currency="EUR"
        currentPrice={null}
        habitual={null}
        searchCount={1}
      />,
    );
    expect(screen.getByText(/Sin observaciones todavía/)).toBeTruthy();
  });
});

describe("AlertHistory", () => {
  const dispatch = (status: "dispatched" | "delivered" | "failed") => ({
    id: `a-${status}`,
    price_eur: 60,
    status,
    dispatched_at: new Date("2026-10-01T10:00:00Z").toISOString(),
    alerts_edge: { threshold_eur: 80, provider: "telegram" },
  });

  it("explains the condition with the threshold", () => {
    render(
      <AlertHistory
        dispatches={[dispatch("dispatched")]}
        thresholdEur={80}
      />,
    );
    expect(screen.getByText(/baja de 80 EUR/)).toBeTruthy();
    expect(screen.getByText(/60\.00 EUR/)).toBeTruthy();
  });

  it("never claims a send that has not happened", () => {
    render(<AlertHistory dispatches={[dispatch("dispatched")]} thresholdEur={80} />);
    expect(screen.getByText("Detectada")).toBeTruthy();
    expect(screen.queryByText("Enviada")).toBeNull();
  });

  it("reports failures as failures", () => {
    render(<AlertHistory dispatches={[dispatch("failed")]} thresholdEur={80} />);
    expect(screen.getByText("Fallida")).toBeTruthy();
  });
});
