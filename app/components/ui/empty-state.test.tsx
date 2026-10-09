import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EmptyState } from "./empty-state";
import { PriceTag } from "./price-tag";

// vitest runs without globals, so RTL's automatic cleanup never registers.
afterEach(cleanup);

describe("EmptyState", () => {
  it("renders title, body and action", () => {
    render(
      <EmptyState
        title="Sin resultados"
        body="Prueba con otras fechas."
        action={<button type="button">Crear búsqueda</button>}
      />,
    );

    expect(screen.getByText("Sin resultados")).toBeTruthy();
    expect(screen.getByText("Prueba con otras fechas.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Crear búsqueda" })).toBeTruthy();
  });
});

describe("PriceTag", () => {
  it("always shows the currency it was quoted in", () => {
    render(<PriceTag price={103} currency="USD" />);
    expect(screen.getByText(/103\.00/)).toBeTruthy();
    expect(screen.getByText("USD")).toBeTruthy();
  });

  it("rounds to whole units on the large size", () => {
    render(<PriceTag price={94.99} currency="EUR" size="lg" />);
    expect(screen.getByText(/95/)).toBeTruthy();
  });

  it("renders a placeholder instead of a broken number", () => {
    render(<PriceTag price={Number.NaN} currency="EUR" />);
    expect(screen.getByText(/—/)).toBeTruthy();
  });
});
