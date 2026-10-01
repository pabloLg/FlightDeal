import { describe, expect, it } from "vitest";

import { isAuthorized } from "./bearer-auth";

describe("isAuthorized", () => {
  it("rejects everything when no secret is configured", () => {
    expect(isAuthorized("Bearer undefined", undefined)).toBe(false);
    expect(isAuthorized("Bearer anything", undefined)).toBe(false);
    expect(isAuthorized("Bearer ", undefined)).toBe(false);
  });

  it("accepts only the exact bearer header", () => {
    expect(isAuthorized("Bearer s3cret", "s3cret")).toBe(true);
    expect(isAuthorized("bearer s3cret", "s3cret")).toBe(false);
    expect(isAuthorized("Bearer s3cret ", "s3cret")).toBe(false);
    expect(isAuthorized("Bearer other", "s3cret")).toBe(false);
    expect(isAuthorized(null, "s3cret")).toBe(false);
  });
});
