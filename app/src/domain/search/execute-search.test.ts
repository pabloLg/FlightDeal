import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Db } from "./execute-search";
import { runExecution, type SearchRow } from "./execute-search";

const search: SearchRow = {
  id: "search-1",
  profile_id: "profile-1",
  origin: "MAD",
  destination: "BCN",
  depart_date: "2026-10-15",
  return_date: null,
  trip_type: "one_way",
  cabin_class: "economy",
  stops: "any",
  adults: 1,
  alert_threshold_eur: null,
  date_flex_days: 0,
};

interface Recorded {
  table: string;
  patch?: Record<string, unknown>;
  rows?: unknown[];
}

function stubDb() {
  const recorded: Recorded[] = [];
  const empty = { data: null, error: null };

  const client = {
    from(table: string) {
      const chain: Record<string, unknown> = {
        update: (patch: Record<string, unknown>) => {
          recorded.push({ table, patch });
          return chain;
        },
        upsert: (rows: unknown[]) => {
          recorded.push({ table, rows });
          return Promise.resolve(empty);
        },
        insert: (rows: unknown[]) => {
          recorded.push({ table, rows });
          return Promise.resolve(empty);
        },
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve(empty),
        single: () => Promise.resolve(empty),
        then: (resolve: (value: typeof empty) => unknown) => Promise.resolve(empty).then(resolve),
      };
      return chain;
    },
  };

  return { db: client as unknown as Db, recorded };
}

const lastStatus = (recorded: Recorded[]) =>
  recorded.filter((r) => r.table === "search_executions" && r.patch).at(-1)?.patch;

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.SERPAPI_API_KEY = "";
  process.env.IGNAV_API_KEY = "";
  delete process.env.SERPAPI_API_KEY;
  delete process.env.IGNAV_API_KEY;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("runExecution with the failover chain", () => {
  it("marks the execution degraded and persists nothing when no source is usable", async () => {
    process.env.FLIGHT_SOURCES = "serpapi,ignav";
    const { db, recorded } = stubDb();

    await runExecution(db, search, "exec-1", "EUR");

    const patch = lastStatus(recorded);
    expect(patch).toMatchObject({
      status: "degraded",
      structure_check_passed: false,
      error_message: "no_sources_configured",
    });
    expect(recorded.some((r) => r.table === "flight_options")).toBe(false);
    expect(recorded.some((r) => r.table === "flight_prices")).toBe(false);
  });

  it("records why each source was skipped in raw_result", async () => {
    process.env.FLIGHT_SOURCES = "serpapi";
    const { db, recorded } = stubDb();

    await runExecution(db, search, "exec-1", "EUR");

    const patch = lastStatus(recorded);
    expect(patch?.raw_result).toMatchObject({
      skipped: ["serpapi:missing_api_key"],
      attempts: [],
    });
  });

  it("completes and persists options through the mock chain", async () => {
    process.env.FLIGHT_SOURCES = "mock";
    const { db, recorded } = stubDb();

    await runExecution(db, search, "exec-1", "EUR");

    const upserted = recorded.find((r) => r.table === "flight_options");
    expect(upserted?.rows).toHaveLength(3);
    expect(recorded.some((r) => r.table === "flight_prices")).toBe(true);
    expect(lastStatus(recorded)).toMatchObject({
      status: "completed",
      structure_check_passed: true,
      raw_result: { sourceId: "mock", optionCount: 3 },
    });
  });

  it("keeps the price history of a search across repeated runs", async () => {
    process.env.FLIGHT_SOURCES = "mock";
    const { db, recorded } = stubDb();

    await runExecution(db, search, "exec-1", "EUR");
    await runExecution(db, search, "exec-2", "EUR");

    const keys = recorded
      .filter((r) => r.table === "flight_options")
      .map((r) => (r.rows as { dedupe_key: string }[]).map((row) => row.dedupe_key));

    expect(keys[1]).toEqual(keys[0]);
  });
});
