import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AlertHistory, PriceHistory } from "./price-history";

afterEach(cleanup);

const stats = [
  {
    stats_date: "2026-10-01",
    min_price_eur: 60,
    max_price_eur: 95,
    avg_price_eur: 77.5,
    observations: 4,
  },
  {
    stats_date: "2026-10-02",
    min_price_eur: 89,
    max_price_eur: 240,
    avg_price_eur: 146,
    observations: 11,
  },
];

describe("PriceHistory", () => {
  it("shows the observed range, not an invented point", () => {
    render(<PriceHistory stats={stats} currency="EUR" currentPrice={95} />);
    expect(screen.getByText(/60\.00 – 95\.00 EUR/)).toBeTruthy();
    expect(screen.getByText(/89\.00 – 240\.00 EUR/)).toBeTruthy();
  });

  it("labels the average and says it is not a prediction", () => {
    render(<PriceHistory stats={stats} currency="EUR" currentPrice={95} />);
    expect(screen.getByText(/Histórico observado/)).toBeTruthy();
  });

  it("warns about the stored currency when the profile uses another one", () => {
    render(<PriceHistory stats={stats} currency="USD" currentPrice={95} />);
    expect(screen.getByText(/Histórico disponible en EUR/)).toBeTruthy();
  });

  it("stays silent about the currency when the profile is in EUR", () => {
    render(<PriceHistory stats={stats} currency="EUR" currentPrice={95} />);
    expect(screen.queryByText(/Histórico disponible en EUR/)).toBeNull();
  });

  it("asks for more runs instead of drawing empty bars", () => {
    render(
      <PriceHistory
        stats={[{ ...stats[0], observations: 0 }]}
        currency="EUR"
        currentPrice={null}
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
