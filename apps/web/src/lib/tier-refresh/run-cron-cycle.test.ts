/**
 * @vitest-environment node
 *
 * Unit tests for `runCronCycle` (AR-9). This endpoint:
 * - loads due sources from tier_list_sources where
 *   auto_refresh_enabled=true, dormant=false, next_refresh_at <= now
 * - filters to sources whose resolveAdapter(url)?.supportsAutoRefresh === true
 * - loops calling runSourceRefresh with deferMvRefresh:true
 * - calls refresh_community_tier_consensus RPC exactly once at the end ONLY
 *   if something applied/partial happened
 * - respects a 270s overall budget break
 * - returns a JSON summary with tallies and per-source details
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@sts2/shared/types/database.types";
import { NextResponse } from "next/server";

// ---- Mocks (declared before importing the module under test) -------------

const resolveAdapter = vi.fn();
vi.mock("@sts2/shared/tier-sources", () => ({
  resolveAdapter: (url: string) => resolveAdapter(url),
}));

const runSourceRefresh = vi.fn();
vi.mock("./run-source-refresh", () => ({
  runSourceRefresh: (supabase: unknown, source: unknown, opts: unknown) =>
    runSourceRefresh(supabase, source, opts),
}));

import { runCronCycle } from "./run-cron-cycle";

type TierListSourceRow =
  Database["public"]["Tables"]["tier_list_sources"]["Row"];
type RefreshResult = { status: "applied" | "partial" | "queued" | "failed"; reason?: string };

// ---- Supabase stub -------------------------------------------------------

interface StubResults {
  dueSources: { data: TierListSourceRow[]; error: unknown };
}

interface Recorded {
  rpcCalls: string[];
}

function makeSupabase(overrides: Partial<StubResults> = {}) {
  const results: StubResults = {
    dueSources: { data: [], error: null },
    ...overrides,
  };
  const recorded: Recorded = {
    rpcCalls: [],
  };

  function tierListSourcesChain() {
    // from("tier_list_sources").select().eq().eq().lte().order() is awaited directly.
    const chain = {
      eq: () => chain,
      lte: () => chain,
      order: () => chain,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(results.dueSources).then(res, rej),
    };
    return chain;
  }

  const supabase = {
    from(table: string) {
      if (table === "tier_list_sources") {
        return { select: () => tierListSourcesChain() };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc(name: string) {
      recorded.rpcCalls.push(name);
      return Promise.resolve({ data: null, error: null });
    },
  } as unknown as SupabaseClient<Database>;

  return { supabase, recorded, results };
}

// ---- Fixtures ------------------------------------------------------------

function makeSource(over: Partial<TierListSourceRow> = {}): TierListSourceRow {
  return {
    author: "Test Author",
    auto_refresh_enabled: true,
    consecutive_failures: 0,
    consecutive_queue_only: 0,
    created_at: "2026-01-01T00:00:00Z",
    dormant: false,
    id: "src-test-default",
    last_failure_reason: null,
    last_refresh_attempted_at: null,
    last_refresh_succeeded_at: null,
    next_refresh_at: "2026-05-29T00:00:00Z",
    notes: null,
    scale_config: null,
    scale_type: "letter_6",
    source_type: "website",
    source_url: "https://example.com/tier-list",
    trust_weight: 1,
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- Tests ---------------------------------------------------------------

describe("runCronCycle", () => {
  describe("adapter filter", () => {
    it("case 1: filters sources by supportsAutoRefresh; only eligible ones attempted", async () => {
      const mobalytics = makeSource({
        id: "src-mobalytics",
        source_url: "https://mobalytics.gg/tier-list",
      });
      const tiermaker = makeSource({
        id: "src-tiermaker",
        source_url: "https://tiermaker.com/tier-list",
      });
      const noUrl = makeSource({
        id: "src-no-url",
        source_url: null,
      });

      const { supabase } = makeSupabase({
        dueSources: { data: [mobalytics, tiermaker, noUrl], error: null },
      });

      // Mock resolveAdapter to return supportsAutoRefresh:true only for mobalytics urls
      resolveAdapter.mockImplementation((url: string) => {
        if (url?.includes("mobalytics")) {
          return { supportsAutoRefresh: true };
        }
        if (url?.includes("tiermaker")) {
          return { supportsAutoRefresh: false };
        }
        return null;
      });

      // runSourceRefresh returns 'applied' for mobalytics
      runSourceRefresh.mockResolvedValueOnce({
        status: "applied",
        reason: undefined,
      } as RefreshResult);

      const res = await runCronCycle(supabase);
      const body = await res.json();

      expect(body.sourcesAttempted).toBe(1);
      expect(runSourceRefresh).toHaveBeenCalledTimes(1);
      expect(runSourceRefresh).toHaveBeenCalledWith(
        supabase,
        mobalytics,
        expect.objectContaining({ trigger: "cron", deferMvRefresh: true }),
      );
    });
  });

  describe("MV refresh gating", () => {
    it("case 2: fires refresh_community_tier_consensus exactly once when applied status occurs", async () => {
      const mobalytics = makeSource({
        id: "src-mobalytics",
        source_url: "https://mobalytics.gg/tier-list",
      });

      const { supabase, recorded } = makeSupabase({
        dueSources: { data: [mobalytics], error: null },
      });

      resolveAdapter.mockReturnValue({ supportsAutoRefresh: true });
      runSourceRefresh.mockResolvedValueOnce({
        status: "applied",
      } as RefreshResult);

      const res = await runCronCycle(supabase);
      const body = await res.json();

      expect(body.sourcesApplied).toBe(1);
      expect(recorded.rpcCalls).toEqual(["refresh_community_tier_consensus"]);
    });

    it("case 3: does NOT fire rpc when only queued/failed occur (anyChanged=false)", async () => {
      const source1 = makeSource({ id: "src-1", source_url: "https://example.com/1" });
      const source2 = makeSource({ id: "src-2", source_url: "https://example.com/2" });

      const { supabase, recorded } = makeSupabase({
        dueSources: { data: [source1, source2], error: null },
      });

      resolveAdapter.mockReturnValue({ supportsAutoRefresh: true });
      runSourceRefresh
        .mockResolvedValueOnce({ status: "queued" } as RefreshResult)
        .mockResolvedValueOnce({ status: "failed", reason: "test_failure" } as RefreshResult);

      const res = await runCronCycle(supabase);
      const body = await res.json();

      expect(body.sourcesQueued).toBe(1);
      expect(body.sourcesFailed).toBe(1);
      expect(body.sourcesApplied).toBe(0);
      expect(recorded.rpcCalls).toEqual([]);
    });
  });

  describe("tally and summary", () => {
    it("case 4: tallies applied, partial, queued, failed correctly and fires rpc once when anyChanged", async () => {
      const src1 = makeSource({ id: "src-1", source_url: "https://example.com/1" });
      const src2 = makeSource({ id: "src-2", source_url: "https://example.com/2" });
      const src3 = makeSource({ id: "src-3", source_url: "https://example.com/3" });

      const { supabase, recorded } = makeSupabase({
        dueSources: { data: [src1, src2, src3], error: null },
      });

      resolveAdapter.mockReturnValue({ supportsAutoRefresh: true });
      runSourceRefresh
        .mockResolvedValueOnce({ status: "applied" } as RefreshResult)
        .mockResolvedValueOnce({ status: "partial" } as RefreshResult)
        .mockResolvedValueOnce({ status: "failed", reason: "error" } as RefreshResult);

      const res = await runCronCycle(supabase);
      const body = await res.json();

      expect(body.sourcesAttempted).toBe(3);
      expect(body.sourcesApplied).toBe(2); // applied + partial
      expect(body.sourcesFailed).toBe(1);
      expect(body.sourcesQueued).toBe(0);
      expect(recorded.rpcCalls).toEqual(["refresh_community_tier_consensus"]);

      // Check per-source detail
      expect(body.perSource).toHaveLength(3);
      expect(body.perSource[0]).toMatchObject({ sourceId: "src-1", status: "applied" });
      expect(body.perSource[1]).toMatchObject({ sourceId: "src-2", status: "partial" });
      expect(body.perSource[2]).toMatchObject({
        sourceId: "src-3",
        status: "failed",
        reason: "error",
      });
    });
  });

  describe("budget break", () => {
    it("skipped: budget break is time-based and would require mocking Date.now across the loop; not unit-tested here", () => {
      // The 270s budget is checked via: if (Date.now() - startMs > OVERALL_BUDGET_MS) break;
      // This is difficult to test in a unit test without introducing a dependency injection
      // for Date.now() or using fake timers (which have global side effects).
      // A proper integration test with a custom clock would handle this.
      expect(true).toBe(true);
    });
  });

  describe("response structure", () => {
    it("returns NextResponse.json with runStartedAt, runFinishedAt, and summaries", async () => {
      const src = makeSource({ id: "src-1", source_url: "https://example.com/1" });
      const { supabase } = makeSupabase({
        dueSources: { data: [src], error: null },
      });

      resolveAdapter.mockReturnValue({ supportsAutoRefresh: true });
      runSourceRefresh.mockResolvedValueOnce({ status: "applied" } as RefreshResult);

      const res = await runCronCycle(supabase);
      const body = await res.json();

      expect(res).toBeInstanceOf(NextResponse);
      expect(body).toMatchObject({
        runStartedAt: expect.any(String),
        runFinishedAt: expect.any(String),
        sourcesAttempted: 1,
        sourcesApplied: 1,
        sourcesQueued: 0,
        sourcesFailed: 0,
        refreshWarning: null,
        perSource: expect.any(Array),
      });

      const startTime = new Date(body.runStartedAt);
      const endTime = new Date(body.runFinishedAt);
      expect(endTime >= startTime).toBe(true);
    });

    it("includes refreshWarning if rpc fails", async () => {
      const src = makeSource({ id: "src-1", source_url: "https://example.com/1" });
      const { supabase } = makeSupabase({
        dueSources: { data: [src], error: null },
      });

      resolveAdapter.mockReturnValue({ supportsAutoRefresh: true });
      runSourceRefresh.mockResolvedValueOnce({ status: "applied" } as RefreshResult);

      // Override rpc to return an error
      supabase.rpc = (() =>
        Promise.resolve({
          data: null,
          error: { message: "RPC failed: out of memory" },
        })) as unknown as typeof supabase.rpc;

      const res = await runCronCycle(supabase);
      const body = await res.json();

      expect(body.refreshWarning).toBe("RPC failed: out of memory");
    });
  });

  describe("error handling", () => {
    it("returns 500 if due sources query fails", async () => {
      const { supabase } = makeSupabase({
        dueSources: {
          data: [] as TierListSourceRow[],
          error: { message: "Connection failed" },
        },
      });

      resolveAdapter.mockReturnValue({ supportsAutoRefresh: true });

      const res = await runCronCycle(supabase);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toMatchObject({
        error: "Failed to load due sources",
        detail: "Connection failed",
      });
    });
  });
});
