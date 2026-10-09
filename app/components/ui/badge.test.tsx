import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge } from "./badge";

describe("Badge", () => {
  it("renders its children and the neutral tone by default", () => {
    render(<Badge>Completada</Badge>);
    const badge = screen.getByText("Completada");
    expect(badge.className).toContain("bg-muted");
  });

  it("maps each state to its own tone", () => {
    render(
      <>
        <Badge variant="ok">ok</Badge>
        <Badge variant="warn">warn</Badge>
        <Badge variant="danger">danger</Badge>
        <Badge variant="info">info</Badge>
      </>,
    );

    expect(screen.getByText("ok").className).toContain("text-savings");
    expect(screen.getByText("warn").className).toContain("text-opportunity");
    expect(screen.getByText("danger").className).toContain("text-destructive");
    expect(screen.getByText("info").className).toContain("text-brand-dark");
  });

  it("exposes the help text for screen readers, not only on hover", () => {
    render(<Badge variant="warn" title="Fuente degradada" dot>Degradada</Badge>);
    expect(screen.getByTitle("Fuente degradada")).toBeTruthy();
    expect(screen.getByText("Degradada").querySelector("span")).toBeTruthy();
  });
});
