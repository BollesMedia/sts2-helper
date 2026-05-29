/**
 * @vitest-environment node
 *
 * Route-level tests for `/api/admin/tier-lists/accept-pending/[id]` (AR-11).
 *
 * `withAdmin` is stubbed as a passthrough so the handler runs directly; Supabase
 * is a hand-rolled chainable stub whose `.single()` resolves to a configurable
 * lookup result and whose `update/eq/is` chain is awaitable. Every call is
 * recorded so we can assert the deactivate-then-promote ordering and the rpc.
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

let lookupResult: { data: unknown; error: unknown } = { data: null, error: null };
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
        return Promise.resolve(lookupResult);
      },
      // Thenable: awaiting an update().eq()... chain resolves to a success.
      then(
        resolve: (v: { data: null; error: unknown }) => unknown,
        reject?: (e: unknown) => unknown,
      ) {
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
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

import { POST } from "./route";

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function request() {
  return new Request(
    "https://example.com/api/admin/tier-lists/accept-pending/list-1",
    { method: "POST" },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  lookupResult = { data: null, error: null };
  rpcError = null;
  calls.length = 0;
  rpcCalls.length = 0;
});

describe("POST /api/admin/tier-lists/accept-pending/[id]", () => {
  it("returns 404 when the row is missing", async () => {
    lookupResult = { data: null, error: { message: "no rows" } };

    const res = await POST(request(), ctx("missing"));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Tier list not found" });
    // No mutation or rpc on the not-found path.
    expect(calls.some((c) => c.method === "update")).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });

  it("returns 409 when the row is not pending", async () => {
    lookupResult = {
      data: {
        id: "list-1",
        source_id: "src-1",
        game_version: "v1.0",
        character: "ironclad",
        review_status: "none",
      },
      error: null,
    };

    const res = await POST(request(), ctx("list-1"));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "Not a pending row" });
    expect(calls.some((c) => c.method === "update")).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });

  it("deactivates prior active rows, promotes the draft, and refreshes the MV", async () => {
    lookupResult = {
      data: {
        id: "list-1",
        source_id: "src-1",
        game_version: "v1.0",
        character: "ironclad",
        review_status: "pending",
      },
      error: null,
    };

    const res = await POST(request(), ctx("list-1"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      refreshWarning: null,
    });

    const updates = calls.filter(
      (c) => c.table === "tier_lists" && c.method === "update",
    );
    // First update is the deactivation, second is the promotion.
    expect(updates).toHaveLength(2);
    expect(updates[0].args[0]).toEqual({ is_active: false });
    expect(updates[1].args[0]).toEqual({
      is_active: true,
      review_status: "none",
    });

    // Deactivation is scoped to source/active/version/character via eq.
    const deactivateIdx = calls.indexOf(updates[0]);
    const promoteIdx = calls.indexOf(updates[1]);
    expect(deactivateIdx).toBeLessThan(promoteIdx);
    const eqColsBeforePromote = calls
      .slice(deactivateIdx, promoteIdx)
      .filter((c) => c.method === "eq")
      .map((c) => c.args[0]);
    expect(eqColsBeforePromote).toContain("source_id");
    expect(eqColsBeforePromote).toContain("is_active");
    expect(eqColsBeforePromote).toContain("game_version");
    expect(eqColsBeforePromote).toContain("character");

    expect(rpcCalls).toEqual(["refresh_community_tier_consensus"]);
  });

  it("uses .is() for null game_version/character scope on deactivation", async () => {
    lookupResult = {
      data: {
        id: "list-1",
        source_id: "src-1",
        game_version: null,
        character: null,
        review_status: "pending",
      },
      error: null,
    };

    await POST(request(), ctx("list-1"));

    const isCols = calls.filter((c) => c.method === "is").map((c) => c.args[0]);
    expect(isCols).toContain("game_version");
    expect(isCols).toContain("character");
  });

  it("surfaces a refreshWarning when the MV refresh fails", async () => {
    lookupResult = {
      data: {
        id: "list-1",
        source_id: "src-1",
        game_version: "v1.0",
        character: "ironclad",
        review_status: "pending",
      },
      error: null,
    };
    rpcError = { message: "refresh boom" };

    const res = await POST(request(), ctx("list-1"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      refreshWarning: "refresh boom",
    });
  });
});
