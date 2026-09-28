import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import { parseReturnLegs } from "./rpc-return-legs";

const fixturePath = path.join(__dirname, "fixtures", "mad-bcn-return-legs.txt");

// Real capture of the GetShoppingResults RPC after selecting outbound UX 7703
// (MAD 15:10 -> BCN 16:35) on the MAD -> BCN round trip of 2026-10-01/08.
function readFixture(): string {
  return fs.readFileSync(fixturePath, "utf8");
}

describe("parseReturnLegs", () => {
  it("reports the outbound flight the return list belongs to", () => {
    const payload = parseReturnLegs(readFixture());
    expect(payload?.selectedOutbound).toEqual([
      {
        airline: "UX",
        flightNumber: "7703",
        departAirport: "MAD",
        arriveAirport: "BCN",
        departAt: "2026-10-01T15:10:00",
        arriveAt: "2026-10-01T16:35:00",
        durationMin: 85,
      },
    ]);
  });

  it("parses the 3 return options with round-trip prices", () => {
    const payload = parseReturnLegs(readFixture());
    expect(payload?.options).toHaveLength(3);
    expect(payload?.options.map((option) => option.price)).toEqual([103, 103, 126]);
    expect(payload?.options[0].outboundLegs[0]).toMatchObject({
      airline: "UX",
      flightNumber: "7706",
      departAirport: "BCN",
      arriveAirport: "MAD",
      departAt: "2026-10-08T11:50:00",
      durationMin: 90,
    });
  });

  it("returns null for a body without results (fail-closed, no enrichment)", () => {
    expect(parseReturnLegs("not a frame stream")).toBeNull();
    expect(parseReturnLegs("123\n[[\"wrb.fr\",null,null]]")).toBeNull();
  });
});
