import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RecentAlertsCard } from "./recent-alerts";

afterEach(cleanup);

const alert = (overrides: Partial<Parameters<typeof RecentAlertsCard>[0]["alerts"][number]> = {}) => ({
  id: "a1",
  route: "MAD → BCN",
  thresholdEur: 80,
  price: 60,
  status: "dispatched" as const,
  dispatchedAt: new Date().toISOString(),
  ...overrides,
});

describe("RecentAlertsCard", () => {
  it("shows the route, the price and the threshold in EUR", () => {
    render(<RecentAlertsCard alerts={[alert()]} />);
    expect(screen.getByText("MAD → BCN")).toBeTruthy();
    expect(screen.getByText(/60\.00 EUR/)).toBeTruthy();
    expect(screen.getByText(/umbral 80 EUR/)).toBeTruthy();
  });

  it("never claims a send that has not happened", () => {
    render(<RecentAlertsCard alerts={[alert()]} />);
    // Nothing is actually delivered until a channel exists (F6).
    expect(screen.getByText("Detectada")).toBeTruthy();
    expect(screen.queryByText("Enviada")).toBeNull();
  });

  it("shows the failed state as failed", () => {
    render(<RecentAlertsCard alerts={[alert({ status: "failed" })]} />);
    expect(screen.getByText("Fallida")).toBeTruthy();
  });

  it("invites to set a threshold when there are no alerts", () => {
    render(<RecentAlertsCard alerts={[]} />);
    expect(screen.getByText("Sin avisos todavía")).toBeTruthy();
  });
});
