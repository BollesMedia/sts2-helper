/**
 * @vitest-environment node
 *
 * Route-level tests for `/api/admin/tier-lists/refresh-logs/[sourceId]` (AR-12):
 * the per-source history route that lists the latest ~20 refresh-audit rows
 * for a specific source, newest first.
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

function ctx(sourceId: string) {
  return { params: Promise.resolve({ sourceId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  queryResult = { data: [], error: null };
});

describe("GET /api/admin/tier-lists/refresh-logs/[sourceId]", () => {
  it("returns { logs: [] } when there is no history", async () => {
    queryResult = { data: [], error: null };

    const req = new Request(
      "https://example.com/api/admin/tier-lists/refresh-logs/src-1",
    );
    const res = await GET(req, ctx("src-1"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ logs: [] });
  });

  it("applies .eq(source_id, sourceId) from params", async () => {
    const req = new Request(
      "https://example.com/api/admin/tier-lists/refresh-logs/src-1",
    );
    await GET(req, ctx("src-1"));

    const eqCall = calls.find((c) => c.method === "eq");
    expect(eqCall).toBeDefined();
    expect(eqCall?.args[0]).toBe("source_id");
    expect(eqCall?.args[1]).toBe("src-1");
  });

  it("applies limit(20) + order(started_at, desc)", async () => {
    const req = new Request(
      "https://example.com/api/admin/tier-lists/refresh-logs/src-1",
    );
    await GET(req, ctx("src-1"));

    const limitCall = calls.find((c) => c.method === "limit");
    expect(limitCall).toBeDefined();
    expect(limitCall?.args[0]).toBe(20);

    const orderCall = calls.find((c) => c.method === "order");
    expect(orderCall).toBeDefined();
    expect(orderCall?.args[0]).toBe("started_at");
    expect(orderCall?.args[1]).toEqual({ ascending: false });
  });

  it("returns multiple history rows", async () => {
    const logs = [
      {
        id: "log-1",
        source_id: "src-1",
        started_at: "2026-05-29T10:00:00Z",
        finished_at: "2026-05-29T10:00:30Z",
        status: "applied",
        trigger: "cron",
        sections_attempted: 1,
        sections_applied: 1,
        sections_queued: 0,
        error_detail: null,
        rejected_snapshot: null,
      },
      {
        id: "log-2",
        source_id: "src-1",
        started_at: "2026-05-29T09:00:00Z",
        finished_at: "2026-05-29T09:00:30Z",
        status: "partial",
        trigger: "cron",
        sections_attempted: 2,
        sections_applied: 1,
        sections_queued: 1,
        error_detail: null,
        rejected_snapshot: null,
      },
    ];
    queryResult = { data: logs, error: null };

    const req = new Request(
      "https://example.com/api/admin/tier-lists/refresh-logs/src-1",
    );
    const res = await GET(req, ctx("src-1"));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.logs).toHaveLength(2);
    expect(json.logs[0].id).toBe("log-1");
    expect(json.logs[1].id).toBe("log-2");
  });

  it("returns 500 on query error", async () => {
    queryResult = { data: [], error: { message: "query failed" } };

    const req = new Request(
      "https://example.com/api/admin/tier-lists/refresh-logs/src-1",
    );
    const res = await GET(req, ctx("src-1"));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      error: "Failed to load history",
    });
  });
});
