import { describe, expect, it } from "vitest";

import { splitPostData } from "./booking-links";

describe("splitPostData", () => {
  it("splits the field name from the opaque payload", () => {
    expect(splitPostData("u=ADowPOLviSx9")).toEqual({
      name: "u",
      value: "ADowPOLviSx9",
    });
  });

  it("keeps the payload byte-intact (further = stay inside the value)", () => {
    expect(splitPostData("u=a=b=c")?.value).toBe("a=b=c");
  });

  it("rejects bodies without a field", () => {
    expect(splitPostData("")).toBeNull();
    expect(splitPostData("noequals")).toBeNull();
  });
});
