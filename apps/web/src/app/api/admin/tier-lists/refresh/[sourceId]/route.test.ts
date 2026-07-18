/**
 * @vitest-environment node
 *
 * Route-level tests for `/api/admin/tier-lists/refresh/[sourceId]` (AR-10).
 *
 * `runSourceRefresh` is tested on its own; here we stub it with a sentinel
 * `RefreshResult` and assert only on the route's two branches:
 *   source-not-found → 404 (no refresh), found → refresh once with the manual
 *   overrides (`trigger: "manual"`, `deferMvRefresh: false`).
 *
 * `withAdmin` is stubbed as a passthrough so we exercise the handler directly;
 * Supabase is a hand-rolled chainable stub whose `.single()` resolves to a
 * configurable `{ data, error }`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Module mocks (hoisted) ─────────────────────────────────────────────

// withAdmin → passthrough: call the wrapped handler with a fake auth context.
vi.mock("@/lib/api-admin-auth", () => ({
  withAdmin:
    (handler: (req: Request, auth: unknown, ctx: unknown) => unknown) =>
    (req: Request, ctx: unknown) =>
      handler(req, { userId: "admin-1" }, ctx),
}));

const runSourceRefresh = vi.fn();
vi.mock("@/lib/tier-refresh/run-source-refresh", () => ({
  runSourceRefresh: (...args: unknown[]) => runSourceRefresh(...args),
}));

// `.from(table).select("*").eq("id", sourceId).single()` resolves to a
// configurable result; the table + eq filter are recorded for assertions.
let singleResult: { data: unknown; error: unknown } = {
  data: null,
  error: null,
};
const recorded: { table: string | null; eqFilter: [string, unknown] | null } = {
  table: null,
  eqFilter: null,
};

vi.mock("@/lib/supabase/server", () => {
  function from(table: string) {
    recorded.table = table;
    const chain = {
      select() {
        return chain;
      },
      eq(column: string, value: unknown) {
        recorded.eqFilter = [column, value];
        return chain;
      },
      single() {
        return Promise.resolve(singleResult);
      },
    };
    return chain;
  }
  return {
    createServiceClient: () => ({ from }),
  };
});

import { POST } from "./route";

const SENTINEL = {
  status: "applied" as const,
  sectionsAttempted: 1,
  sectionsApplied: 1,
  sectionsQueued: 0,
};

function ctx(sourceId: string) {
  return { params: Promise.resolve({ sourceId }) };
}

function request() {
  return new Request("https://example.com/api/admin/tier-lists/refresh/src-1", {
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  singleResult = { data: null, error: null };
  recorded.table = null;
  recorded.eqFilter = null;
  runSourceRefresh.mockResolvedValue(SENTINEL);
});

describe("POST /api/admin/tier-lists/refresh/[sourceId]", () => {
  it("returns 404 and does not refresh when the source is missing", async () => {
    singleResult = { data: null, error: { message: "no rows" } };

    const res = await POST(request(), ctx("missing-id"));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Source not found" });
    expect(runSourceRefresh).not.toHaveBeenCalled();
    // Looked up the right table/row before bailing.
    expect(recorded.table).toBe("tier_list_sources");
    expect(recorded.eqFilter).toEqual(["id", "missing-id"]);
  });

  it("refreshes the source once with manual overrides and returns the result", async () => {
    const source = { id: "src-1", source_url: "https://example.com" };
    singleResult = { data: source, error: null };

    const res = await POST(request(), ctx("src-1"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(SENTINEL);

    expect(runSourceRefresh).toHaveBeenCalledTimes(1);
    const [, passedSource, options] = runSourceRefresh.mock.calls[0];
    expect(passedSource).toBe(source);
    expect(options).toEqual({ trigger: "manual", deferMvRefresh: false });
  });
});
