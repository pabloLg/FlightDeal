import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PriceArea } from "./price-area";

afterEach(cleanup);

const days = [
  { date: "2026-10-07", min: 120, observations: 4 },
  { date: "2026-10-09", min: 150, observations: 2 },
  { date: "2026-10-13", min: 130, observations: 6 },
];

describe("PriceArea", () => {
  it("draws one marker per observed day, never interpolating", () => {
    render(<PriceArea days={days} habitual={140} />);
    expect(screen.getAllByTestId("price-area-point")).toHaveLength(3);
  });

  it("labels the price axis in euros", () => {
    render(<PriceArea days={days} habitual={140} />);
    expect(screen.getAllByText(/€$/).length).toBeGreaterThan(1);
  });

  it("asks for more data instead of drawing a single point", () => {
    render(<PriceArea days={[days[0]]} habitual={null} />);
    expect(screen.getByText(/Hacen falta al menos dos días/)).toBeTruthy();
    expect(screen.queryAllByTestId("price-area-point")).toHaveLength(0);
  });
});
