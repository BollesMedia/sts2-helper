/**
 * @vitest-environment node
 *
 * Route-level tests for `/api/cron/refresh-tier-lists` (AR-9).
 *
 * The cycle itself (`runCronCycle`) is tested separately; here we stub it with
 * a sentinel Response and assert only on the route's guard ladder:
 *   auth → kill-switch → row-level claim → cycle → release-in-finally.
 *
 * Supabase is a hand-rolled chainable stub. The claim path
 * (`update().eq().or().select()`) resolves to a configurable result; the
 * release path (`update().eq().eq()`) is awaited in the `finally` block and its
 * filter is recorded so we can assert the lease is released keyed on
 * `claimed_by`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Module mocks (hoisted) ─────────────────────────────────────────────

const runCronCycle = vi.fn();
vi.mock("@/lib/tier-refresh/run-cron-cycle", () => ({
  runCronCycle: (...args: unknown[]) => runCronCycle(...args),
}));

// Records every `.update(payload)` plus the filters applied afterwards, so a
// test can distinguish the claim write (claimed_by: <id>) from the release
// write (claimed_by: null) and assert the release filter.
interface UpdateRecord {
  payload: Record<string, unknown>;
  eqFilters: Array<[string, unknown]>;
  orFilter: string | null;
}

const recorded: { updates: UpdateRecord[] } = { updates: [] };
let claimResult: { data: Array<{ id: string }> | null } = { data: null };

vi.mock("@/lib/supabase/server", () => {
  function from() {
    return {
      update(payload: Record<string, unknown>) {
        const record: UpdateRecord = { payload, eqFilters: [], orFilter: null };
        recorded.updates.push(record);

        // The release path (`update().eq().eq()`) is awaited directly; the
        // claim path (`update().eq().or().select()`) resolves to claimResult.
        const releaseResult = Promise.resolve({ data: [], error: null });
        const chain = {
          eq(column: string, value: unknown) {
            record.eqFilters.push([column, value]);
            return chain;
          },
          or(filter: string) {
            record.orFilter = filter;
            return chain;
          },
          select() {
            return Promise.resolve(claimResult);
          },
          then: (
            resolve: (v: { data: unknown[]; error: null }) => unknown,
            reject?: (e: unknown) => unknown,
          ) => releaseResult.then(resolve, reject),
        };
        return chain;
      },
    };
  }
  return {
    createServiceClient: () => ({ from }),
  };
});

import { GET } from "./route";

const SENTINEL = new Response(JSON.stringify({ sentinel: true }), {
  status: 200,
});

function request(headers: Record<string, string> = {}) {
  return new Request("https://example.com/api/cron/refresh-tier-lists", {
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  recorded.updates = [];
  claimResult = { data: null };
  vi.stubEnv("CRON_SECRET", "test-secret");
  runCronCycle.mockResolvedValue(SENTINEL);
});

describe("GET /api/cron/refresh-tier-lists", () => {
  it("returns 401 when the Authorization header is missing or wrong", async () => {
    const missing = await GET(request());
    expect(missing.status).toBe(401);

    const wrong = await GET(request({ authorization: "Bearer nope" }));
    expect(wrong.status).toBe(401);

    expect(runCronCycle).not.toHaveBeenCalled();
  });

  it("no-ops with { disabled: true } when the kill switch is set", async () => {
    vi.stubEnv("TIER_LIST_AUTO_REFRESH_DISABLED", "true");

    const res = await GET(request({ authorization: "Bearer test-secret" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ disabled: true });
    expect(runCronCycle).not.toHaveBeenCalled();
  });

  it("skips when the claim is already held (stale lease not yet expired)", async () => {
    claimResult = { data: [] };

    const res = await GET(request({ authorization: "Bearer test-secret" }));

    await expect(res.json()).resolves.toEqual({
      skipped: "run_already_in_progress",
    });
    expect(runCronCycle).not.toHaveBeenCalled();
    // The claim was attempted with the stale-lease `.or(...)` filter.
    expect(recorded.updates).toHaveLength(1);
    expect(recorded.updates[0].orFilter).toContain("claimed_at.is.null");
  });

  it("runs the cycle once and releases the claim in finally on the happy path", async () => {
    claimResult = { data: [{ id: "singleton" }] };

    const res = await GET(request({ authorization: "Bearer test-secret" }));

    expect(res).toBe(SENTINEL);
    expect(runCronCycle).toHaveBeenCalledTimes(1);

    // Two writes: the claim, then the release.
    expect(recorded.updates).toHaveLength(2);

    const release = recorded.updates[1];
    expect(release.payload).toEqual({ claimed_at: null, claimed_by: null });
    // Release is keyed on the same invocation that claimed the lease.
    const claimedByFilter = release.eqFilters.find(
      ([col]) => col === "claimed_by",
    );
    expect(claimedByFilter).toBeDefined();
    expect(release.eqFilters).toContainEqual(["id", "singleton"]);
  });
});
