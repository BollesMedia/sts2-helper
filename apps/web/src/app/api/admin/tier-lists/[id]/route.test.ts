/**
 * @vitest-environment node
 *
 * Route-level tests for `/api/admin/tier-lists/[id]` (AR-11): the DELETE
 * (reject) handler and the PATCH `auto_refresh_enabled` source flag.
 *
 * `withAdmin` is a passthrough; Supabase is a hand-rolled chainable stub.
 * `.single()` resolves to a per-table configurable lookup result; the
 * `update/insert/delete/eq/is` chain is awaitable and resolves to a configurable
 * write result. Every call is recorded so we can assert ordering + payloads.
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

// Per-table `.single()` results and write (`then`) results. Defaults to success.
let singleByTable: Record<string, { data: unknown; error: unknown }> = {};
let writeError: unknown = null;
let rpcError: unknown = null;
const calls: RecordedCall[] = [];
const rpcCalls: string[] = [];

vi.mock("@/lib/supabase/server", () => {
  function builder(table: string) {
    const chain = {
      update(payload: unknown) {
        calls.push({ table, method: "update", args: [payload] });
        return chain;
      },
      insert(payload: unknown) {
        calls.push({ table, method: "insert", args: [payload] });
        return chain;
      },
      delete() {
        calls.push({ table, method: "delete", args: [] });
        return chain;
      },
      select(cols: unknown) {
        calls.push({ table, method: "select", args: [cols] });
        return chain;
      },
      eq(col: unknown, val: unknown) {
        calls.push({ table, method: "eq", args: [col, val] });
        return chain;
      },
      is(col: unknown, val: unknown) {
        calls.push({ table, method: "is", args: [col, val] });
        return chain;
      },
      single() {
        calls.push({ table, method: "single", args: [] });
        return Promise.resolve(
          singleByTable[table] ?? { data: null, error: null },
        );
      },
      // Thenable: awaiting an insert / delete / update().eq() chain resolves to
      // the configurable write result.
      then(
        resolve: (v: { data: null; error: unknown }) => unknown,
        reject?: (e: unknown) => unknown,
      ) {
        return Promise.resolve({ data: null, error: writeError }).then(
          resolve,
          reject,
        );
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
      rpc(name: string) {
        rpcCalls.push(name);
        return Promise.resolve({ data: null, error: rpcError });
      },
    }),
  };
});

import { DELETE, PATCH } from "./route";

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  singleByTable = {};
  writeError = null;
  rpcError = null;
  calls.length = 0;
  rpcCalls.length = 0;
});

// ─── DELETE (reject) ────────────────────────────────────────────────────

function deleteRequest() {
  return new Request("https://example.com/api/admin/tier-lists/list-1", {
    method: "DELETE",
  });
}

describe("DELETE /api/admin/tier-lists/[id]", () => {
  it("returns 404 when the row is missing (no audit, no delete)", async () => {
    singleByTable = { tier_lists: { data: null, error: { message: "no rows" } } };

    const res = await DELETE(deleteRequest(), ctx("missing"));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Tier list not found" });
    expect(calls.some((c) => c.method === "insert")).toBe(false);
    expect(calls.some((c) => c.method === "delete")).toBe(false);
  });

  it("writes an audit row with rejected_snapshot before deleting", async () => {
    singleByTable = {
      tier_lists: {
        data: {
          id: "list-1",
          source_id: "src-1",
          character: "ironclad",
          game_version: "v1.0",
          review_status: "pending",
          entry_count: 42,
          gate_failure_reasons: [{ gate: "min_cards", value: 3 }],
        },
        error: null,
      },
    };

    const res = await DELETE(deleteRequest(), ctx("list-1"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });

    const auditInsert = calls.find(
      (c) => c.table === "tier_list_refresh_logs" && c.method === "insert",
    );
    expect(auditInsert).toBeDefined();
    expect(auditInsert?.args[0]).toMatchObject({
      source_id: "src-1",
      status: "failed",
      trigger: "manual",
      sections_attempted: 0,
      sections_applied: 0,
      sections_queued: 0,
      rejected_snapshot: {
        tierListId: "list-1",
        character: "ironclad",
        game_version: "v1.0",
        entry_count: 42,
        gate_failure_reasons: [{ gate: "min_cards", value: 3 }],
      },
    });

    // The audit insert happens before the delete.
    const deleteCall = calls.find(
      (c) => c.table === "tier_lists" && c.method === "delete",
    );
    expect(deleteCall).toBeDefined();
    expect(calls.indexOf(auditInsert!)).toBeLessThan(calls.indexOf(deleteCall!));
  });

  it("still deletes when the audit insert fails (best-effort)", async () => {
    singleByTable = {
      tier_lists: {
        data: {
          id: "list-1",
          source_id: "src-1",
          character: null,
          game_version: null,
          review_status: "pending",
          entry_count: 0,
          gate_failure_reasons: null,
        },
        error: null,
      },
    };
    // Both the audit insert and the delete go through the same `then` path; a
    // write error here means audit logging "failed" but the route swallows it.
    writeError = { message: "audit boom" };

    const res = await DELETE(deleteRequest(), ctx("list-1"));

    // Delete also reports writeError → 500, but the key assertion is the route
    // attempted the delete after a failed audit (didn't bail on audit failure).
    const auditInsert = calls.find(
      (c) => c.table === "tier_list_refresh_logs" && c.method === "insert",
    );
    const deleteCall = calls.find(
      (c) => c.table === "tier_lists" && c.method === "delete",
    );
    expect(auditInsert).toBeDefined();
    expect(deleteCall).toBeDefined();
    expect(res.status).toBe(500);
  });
});

// ─── PATCH auto_refresh_enabled ─────────────────────────────────────────

function patchRequest(body: unknown) {
  return new Request("https://example.com/api/admin/tier-lists/list-1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("PATCH /api/admin/tier-lists/[id] — auto_refresh_enabled", () => {
  it("accepts auto_refresh_enabled and applies it to the source update", async () => {
    singleByTable = {
      tier_lists: { data: { id: "list-1", source_id: "src-1" }, error: null },
    };

    const res = await PATCH(
      patchRequest({ source: { auto_refresh_enabled: true } }),
      ctx("list-1"),
    );

    expect(res.status).toBe(200);

    const sourceUpdate = calls.find(
      (c) => c.table === "tier_list_sources" && c.method === "update",
    );
    expect(sourceUpdate).toBeDefined();
    expect(sourceUpdate?.args[0]).toMatchObject({ auto_refresh_enabled: true });
    // The route does NOT set next_refresh_at — the DB trigger covers that.
    expect(sourceUpdate?.args[0]).not.toHaveProperty("next_refresh_at");
  });

  it("rejects a non-boolean auto_refresh_enabled with 400", async () => {
    const res = await PATCH(
      patchRequest({ source: { auto_refresh_enabled: "yes" } }),
      ctx("list-1"),
    );

    expect(res.status).toBe(400);
    // No DB lookup/update on a schema-invalid body.
    expect(calls.some((c) => c.method === "update")).toBe(false);
  });
});
