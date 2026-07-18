/**
 * @vitest-environment node
 *
 * Route-level tests for `/api/admin/tier-lists/refresh-logs` (AR-12): the
 * feed route that lists the latest ~10 refresh-audit rows across all sources
 * or filtered by ?sourceId=.
 *
 * `withAdmin` is a passthrough; Supabase is a hand-rolled chainable stub.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api-admin-auth", () => ({
  withAdmin:
    (handler: (req: Request, auth: unknown, ctx: unknown) => unknown) =>
    (req: Request, ctx: unknown) =>
      handler(req, { userId: "admin-1" }, ctx),
}));

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

let calls: RecordedCall[] = [];
let queryResult: { data: unknown[]; error: unknown } = {
  data: [],
  error: null,
};

vi.mock("@/lib/supabase/server", () => {
  function builder(table: string) {
    const chain = {
      select(cols: unknown) {
        calls.push({ table, method: "select", args: [cols] });
        return chain;
      },
      order(col: unknown, opts: unknown) {
        calls.push({ table, method: "order", args: [col, opts] });
        return chain;
      },
      limit(n: unknown) {
        calls.push({ table, method: "limit", args: [n] });
        return chain;
      },
      eq(col: unknown, val: unknown) {
        calls.push({ table, method: "eq", args: [col, val] });
        return chain;
      },
      then(
        resolve: (v: { data: unknown[]; error: unknown }) => unknown,
        reject?: (e: unknown) => unknown,
      ) {
        return Promise.resolve(queryResult).then(resolve, reject);
      },
    };
    return chain;
  }

  return {
    createServiceClient: () => ({
      from(table: string) {
        calls.push({ table, method: "from", args: [] });
        return builder(table);
      },
    }),
  };
});

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  queryResult = { data: [], error: null };
});

describe("GET /api/admin/tier-lists/refresh-logs", () => {
  it("returns { logs: [] } when there are no refresh logs", async () => {
    queryResult = { data: [], error: null };

    const req = new Request(
      "https://example.com/api/admin/tier-lists/refresh-logs",
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ logs: [] });
  });

  it("applies limit(10) + order(started_at, desc) + select", async () => {
    const req = new Request(
      "https://example.com/api/admin/tier-lists/refresh-logs",
    );
    await GET(req);

    expect(calls.some((c) => c.method === "from")).toBe(true);
    expect(calls.some((c) => c.method === "select")).toBe(true);

    const orderCall = calls.find((c) => c.method === "order");
    expect(orderCall).toBeDefined();
    expect(orderCall?.args[0]).toBe("started_at");
    expect(orderCall?.args[1]).toEqual({ ascending: false });

    const limitCall = calls.find((c) => c.method === "limit");
    expect(limitCall).toBeDefined();
    expect(limitCall?.args[0]).toBe(10);
  });

  it("applies .eq(source_id, x) when ?sourceId=x is present", async () => {
    const req = new Request(
      "https://example.com/api/admin/tier-lists/refresh-logs?sourceId=src-123",
    );
    await GET(req);

    const eqCall = calls.find((c) => c.method === "eq");
    expect(eqCall).toBeDefined();
    expect(eqCall?.args[0]).toBe("source_id");
    expect(eqCall?.args[1]).toBe("src-123");
  });

  it("omits .eq() when ?sourceId= is absent", async () => {
    const req = new Request(
      "https://example.com/api/admin/tier-lists/refresh-logs",
    );
    await GET(req);

    const eqCall = calls.find((c) => c.method === "eq");
    expect(eqCall).toBeUndefined();
  });

  it("returns rows with source metadata joined", async () => {
    const log1 = {
      id: "log-1",
      source_id: "src-1",
      started_at: "2026-05-29T00:00:00Z",
      finished_at: "2026-05-29T00:00:30Z",
      status: "applied",
      trigger: "cron",
      sections_attempted: 1,
      sections_applied: 1,
      sections_queued: 0,
      error_detail: null,
      source: { id: "src-1", author: "TestAuthor" },
    };
    queryResult = { data: [log1], error: null };

    const req = new Request(
      "https://example.com/api/admin/tier-lists/refresh-logs",
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.logs).toHaveLength(1);
    expect(json.logs[0]).toMatchObject({
      id: "log-1",
      source_id: "src-1",
      status: "applied",
      source: { author: "TestAuthor" },
    });
  });

  it("returns 500 on query error", async () => {
    queryResult = { data: [], error: { message: "query failed" } };

    const req = new Request(
      "https://example.com/api/admin/tier-lists/refresh-logs",
    );
    const res = await GET(req);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      error: "Failed to load refresh logs",
    });
  });
});
