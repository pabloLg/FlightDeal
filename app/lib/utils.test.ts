import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

describe("cn", () => {
  it("joins truthy class names", () => {
    expect(cn("a", "b", false && "c", undefined, "d")).toBe("a b d");
  });

  it("resolves tailwind-merge conflicts", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});