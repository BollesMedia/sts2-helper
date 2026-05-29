/**
 * @vitest-environment node
 *
 * Integration tests for the `runSourceRefresh` orchestrator (AR-8). This is the
 * crux of the auto-refresh feature: it composes fetch → adapter parse →
 * per-section card matching → quality gate → apply-or-queue → backoff
 * bookkeeping → audit log → MV refresh.
 *
 * Strategy: mock the I/O-bound / already-tested units (`fetchSourceHtml`, the
 * adapter registry, `matchSection`, `applySection`) so each test controls one
 * branch, but use the REAL `./quality-gate` and `./backoff` so the gate +
 * backoff math is exercised end-to-end. Supabase is a hand-rolled chainable
 * stub whose terminal `.select()` shapes (cards / prior tier_lists /
 * game_versions) and recorded writes (source update, audit-log insert, rpc)
 * are configurable per test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@sts2/shared/types/database.types";

// ---- Mocks (declared before importing the module under test) -------------

const fetchSourceHtml = vi.fn();
vi.mock("./fetch-source-html", () => ({
  fetchSourceHtml: (url: string) => fetchSourceHtml(url),
}));

const parse = vi.fn();
const resolveAdapter = vi.fn();
vi.mock("@sts2/shared/tier-sources", () => ({
  resolveAdapter: (url: string) => resolveAdapter(url),
}));

const matchSection = vi.fn();
vi.mock("./match-cards", () => ({
  matchSection: (...args: unknown[]) => matchSection(...args),
}));

const applySection = vi.fn();
vi.mock("./apply-sections", () => ({
  applySection: (...args: unknown[]) => applySection(...args),
}));

import { runSourceRefresh } from "./run-source-refresh";
import type { ScrapedSection } from "@sts2/shared/tier-sources";
import type { MatchedCard } from "./match-cards";

type TierListSourceRow =
  Database["public"]["Tables"]["tier_list_sources"]["Row"];

// ---- Supabase stub -------------------------------------------------------

interface PriorRow {
  character: string | null;
  entry_count: number;
  game_version: string | null;
}

interface StubResults {
  cards: { data: unknown[]; error: unknown };
  priorLists: { data: PriorRow[]; error: unknown };
  gameVersion: { data: { version: string; released_at: string } | null; error: unknown };
}

interface Recorded {
  sourceUpdate: Record<string, unknown> | null;
  auditInsert: Record<string, unknown> | null;
  rpcCalled: string[];
}

function makeSupabase(overrides: Partial<StubResults> = {}) {
  const results: StubResults = {
    cards: { data: [], error: null },
    priorLists: { data: [], error: null },
    gameVersion: { data: { version: "0.4.0", released_at: "2026-05-01" }, error: null },
    ...overrides,
  };
  const recorded: Recorded = {
    sourceUpdate: null,
    auditInsert: null,
    rpcCalled: [],
  };

  function cardsChain() {
    // from("cards").select(...) is awaited directly.
    return {
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(results.cards).then(res, rej),
    };
  }

  function tierListsChain() {
    // from("tier_lists").select().eq().eq() is awaited directly.
    const chain = {
      eq: () => chain,
      is: () => chain,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(results.priorLists).then(res, rej),
    };
    return chain;
  }

  function gameVersionsChain() {
    // from("game_versions").select().not().lte().order().limit() → maybeSingle/await.
    const chain = {
      not: () => chain,
      lte: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve(results.gameVersion),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(results.gameVersion).then(res, rej),
    };
    return chain;
  }

  function sourceUpdateChain() {
    const chain = {
      eq: () => Promise.resolve({ data: null, error: null }),
    };
    return chain;
  }

  const supabase = {
    from(table: string) {
      if (table === "cards") {
        return { select: () => cardsChain() };
      }
      if (table === "tier_lists") {
        return { select: () => tierListsChain() };
      }
      if (table === "game_versions") {
        return { select: () => gameVersionsChain() };
      }
      if (table === "tier_list_sources") {
        return {
          update(payload: Record<string, unknown>) {
            recorded.sourceUpdate = payload;
            return sourceUpdateChain();
          },
        };
      }
      if (table === "tier_list_refresh_logs") {
        return {
          insert(payload: Record<string, unknown>) {
            recorded.auditInsert = payload;
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc(name: string) {
      recorded.rpcCalled.push(name);
      return Promise.resolve({ data: null, error: null });
    },
  } as unknown as SupabaseClient<Database>;

  return { supabase, recorded, results };
}

// ---- Fixtures ------------------------------------------------------------

const NOW = new Date("2026-05-29T12:00:00.000Z");

function makeSource(over: Partial<TierListSourceRow> = {}): TierListSourceRow {
  return {
    author: "Mobalytics",
    auto_refresh_enabled: true,
    consecutive_failures: 0,
    consecutive_queue_only: 0,
    created_at: "2026-01-01T00:00:00Z",
    dormant: false,
    id: "src-mobalytics",
    last_failure_reason: null,
    last_refresh_attempted_at: null,
    last_refresh_succeeded_at: null,
    next_refresh_at: null,
    notes: null,
    scale_config: null,
    scale_type: "letter_6",
    source_type: "website",
    source_url: "https://mobalytics.gg/slay-the-spire-2/tier-list",
    trust_weight: 1,
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function section(detectedCharacter: string | null, n: number): ScrapedSection {
  return {
    detectedCharacter,
    scaleType: "letter_6",
    cards: Array.from({ length: n }, (_, i) => ({
      tier: "A",
      imageUrl: `https://mobalytics.gg/card-${i}.png`,
      name: `Card ${i}`,
    })),
    warnings: [],
  };
}

/** A perfectly-matched result: every card resolves to a cardId. */
function fullMatch(n: number): { matched: MatchedCard[]; warnings: string[] } {
  return {
    matched: Array.from({ length: n }, (_, i) => ({
      tier: "A",
      imageUrl: `https://mobalytics.gg/card-${i}.png`,
      name: `Card ${i}`,
      cardId: `card-${i}`,
      confidence: 1,
      source: "alt" as const,
      distance: null,
    })),
    warnings: [],
  };
}

/** A poorly-matched result: only `hits` of `n` cards resolve. */
function partialMatch(
  n: number,
  hits: number,
): { matched: MatchedCard[]; warnings: string[] } {
  return {
    matched: Array.from({ length: n }, (_, i) => ({
      tier: "A",
      imageUrl: `https://mobalytics.gg/card-${i}.png`,
      name: `Card ${i}`,
      cardId: i < hits ? `card-${i}` : null,
      confidence: i < hits ? 1 : 0,
      source: i < hits ? ("alt" as const) : ("none" as const),
      distance: null,
    })),
    warnings: [],
  };
}

const adapter = {
  id: "mobalytics",
  label: "Mobalytics",
  supportsAutoRefresh: true,
  canHandle: () => true,
  parse: (html: string, url: string) => parse(html, url),
};

beforeEach(() => {
  vi.clearAllMocks();
  resolveAdapter.mockReturnValue(adapter);
});

// ---- Tests ---------------------------------------------------------------

describe("runSourceRefresh — fetch failure", () => {
  it("status 'failed', source +1d & failures incremented, audit 'failed', no rpc", async () => {
    fetchSourceHtml.mockResolvedValue({ ok: false, reason: "http_403" });
    const { supabase, recorded } = makeSupabase();
    const source = makeSource({ consecutive_failures: 0 });

    const result = await runSourceRefresh(supabase, source, {
      trigger: "cron",
      deferMvRefresh: false,
      now: NOW,
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("http_403");
    expect(result.sectionsAttempted).toBe(0);
    expect(applySection).not.toHaveBeenCalled();

    // Backoff: first failure → +1 day, failures = 1.
    expect(recorded.sourceUpdate).toMatchObject({
      consecutive_failures: 1,
      next_refresh_at: new Date(NOW.getTime() + 86_400_000).toISOString(),
      last_failure_reason: "http_403",
      last_refresh_attempted_at: NOW.toISOString(),
      last_refresh_succeeded_at: null,
    });

    expect(recorded.auditInsert).toMatchObject({
      source_id: "src-mobalytics",
      status: "failed",
      trigger: "cron",
      sections_attempted: 0,
      sections_applied: 0,
      sections_queued: 0,
    });

    expect(recorded.rpcCalled).toEqual([]);
  });

  it("missing source_url → status 'failed' reason 'no_source_url'", async () => {
    const { supabase, recorded } = makeSupabase();
    const source = makeSource({ source_url: null });

    const result = await runSourceRefresh(supabase, source, {
      trigger: "manual",
      deferMvRefresh: false,
      now: NOW,
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("no_source_url");
    expect(fetchSourceHtml).not.toHaveBeenCalled();
    expect(recorded.auditInsert).toMatchObject({ status: "failed" });
  });
});

describe("runSourceRefresh — no data", () => {
  it("adapter returns 0 sections → status 'no_data'", async () => {
    fetchSourceHtml.mockResolvedValue({ ok: true, html: "<html></html>" });
    parse.mockReturnValue({ adapterId: "mobalytics", sections: [], warnings: [] });
    const { supabase, recorded } = makeSupabase();

    const result = await runSourceRefresh(supabase, makeSource(), {
      trigger: "cron",
      deferMvRefresh: false,
      now: NOW,
    });

    expect(result.status).toBe("no_data");
    expect(result.sectionsAttempted).toBe(0);
    expect(applySection).not.toHaveBeenCalled();
    expect(recorded.auditInsert).toMatchObject({ status: "no_data" });
    // no_data is a failure-class outcome → failure backoff (+1d, failures=1).
    expect(recorded.sourceUpdate).toMatchObject({
      consecutive_failures: 1,
      last_failure_reason: "no_data",
    });
    expect(recorded.rpcCalled).toEqual([]);
  });

  it("no adapter resolves → status 'failed' reason 'no_adapter'", async () => {
    fetchSourceHtml.mockResolvedValue({ ok: true, html: "<html></html>" });
    resolveAdapter.mockReturnValue(null);
    const { supabase } = makeSupabase();

    const result = await runSourceRefresh(supabase, makeSource(), {
      trigger: "cron",
      deferMvRefresh: false,
      now: NOW,
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("no_adapter");
  });
});

describe("runSourceRefresh — applied", () => {
  it("two clean sections → 'applied', applySection x2 queue:false, counters reset (+7d)", async () => {
    fetchSourceHtml.mockResolvedValue({ ok: true, html: "<html></html>" });
    parse.mockReturnValue({
      adapterId: "mobalytics",
      sections: [section("ironclad", 50), section("silent", 50)],
      warnings: [],
    });
    // Both sections match fully (100% match-rate, no warnings).
    matchSection
      .mockResolvedValueOnce(fullMatch(50))
      .mockResolvedValueOnce(fullMatch(50));
    applySection.mockResolvedValue({ listId: "list-x", entryCount: 50 });

    const { supabase, recorded } = makeSupabase({
      priorLists: { data: [], error: null },
    });
    const source = makeSource({ consecutive_failures: 2, consecutive_queue_only: 1 });

    const result = await runSourceRefresh(supabase, source, {
      trigger: "cron",
      deferMvRefresh: false,
      now: NOW,
    });

    expect(result.status).toBe("applied");
    expect(result.sectionsAttempted).toBe(2);
    expect(result.sectionsApplied).toBe(2);
    expect(result.sectionsQueued).toBe(0);

    expect(applySection).toHaveBeenCalledTimes(2);
    for (const call of applySection.mock.calls) {
      const input = call[1] as Record<string, unknown>;
      expect(input.queue).toBe(false);
      // scaleType/scaleConfig must reach applySection or normalized_tier breaks.
      expect(input.scaleType).toBe("letter_6");
      expect(input).toHaveProperty("scaleConfig");
      const list = input.list as Record<string, unknown>;
      expect(list.game_version).toBe("0.4.0");
      expect(list.published_at).toBe("2026-05-29");
    }
    // entries built from matched cards with a cardId.
    const firstInput = applySection.mock.calls[0][1] as Record<string, unknown>;
    const entries = firstInput.entries as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(50);
    expect(entries[0]).toEqual({
      card_id: "card-0",
      raw_tier: "A",
      extraction_confidence: 1,
    });

    // Applied → counters reset, +7d.
    expect(recorded.sourceUpdate).toMatchObject({
      consecutive_failures: 0,
      consecutive_queue_only: 0,
      dormant: false,
      next_refresh_at: new Date(NOW.getTime() + 7 * 86_400_000).toISOString(),
      last_refresh_succeeded_at: NOW.toISOString(),
      last_failure_reason: null,
    });

    expect(recorded.auditInsert).toMatchObject({
      status: "applied",
      sections_attempted: 2,
      sections_applied: 2,
      sections_queued: 0,
    });

    expect(recorded.rpcCalled).toEqual(["refresh_community_tier_consensus"]);
  });

  it("deferMvRefresh:true does NOT call the MV refresh rpc", async () => {
    fetchSourceHtml.mockResolvedValue({ ok: true, html: "<html></html>" });
    parse.mockReturnValue({
      adapterId: "mobalytics",
      sections: [section("ironclad", 50)],
      warnings: [],
    });
    matchSection.mockResolvedValue(fullMatch(50));
    applySection.mockResolvedValue({ listId: "list-x", entryCount: 50 });

    const { supabase, recorded } = makeSupabase();

    const result = await runSourceRefresh(supabase, makeSource(), {
      trigger: "cron",
      deferMvRefresh: true,
      now: NOW,
    });

    expect(result.status).toBe("applied");
    expect(recorded.rpcCalled).toEqual([]);
  });
});

describe("runSourceRefresh — partial", () => {
  it("one section fails match-rate gate → 'partial', one queue:false + one queue:true", async () => {
    fetchSourceHtml.mockResolvedValue({ ok: true, html: "<html></html>" });
    parse.mockReturnValue({
      adapterId: "mobalytics",
      sections: [section("ironclad", 50), section("silent", 50)],
      warnings: [],
    });
    // Section 0 matches fully (applies); section 1 only 40/50 = 80% < 95% (queues).
    matchSection
      .mockResolvedValueOnce(fullMatch(50))
      .mockResolvedValueOnce(partialMatch(50, 40));
    applySection.mockResolvedValue({ listId: "list-x", entryCount: 50 });

    const { supabase, recorded } = makeSupabase({
      priorLists: { data: [], error: null },
    });

    const result = await runSourceRefresh(supabase, makeSource(), {
      trigger: "cron",
      deferMvRefresh: false,
      now: NOW,
    });

    expect(result.status).toBe("partial");
    expect(result.sectionsApplied).toBe(1);
    expect(result.sectionsQueued).toBe(1);

    const queueFlags = applySection.mock.calls.map(
      (c) => (c[1] as Record<string, unknown>).queue,
    );
    expect(queueFlags.filter((q) => q === false)).toHaveLength(1);
    expect(queueFlags.filter((q) => q === true)).toHaveLength(1);

    // The queued section carries gate failure reasons.
    const queuedCall = applySection.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>).queue === true,
    );
    const queuedInput = queuedCall![1] as Record<string, unknown>;
    expect(queuedInput.gateFailureReasons).toMatchObject({
      perSection: expect.any(Object),
      sourceLevel: expect.any(Object),
    });

    // Partial also resets counters (+7d) like applied.
    expect(recorded.sourceUpdate).toMatchObject({
      consecutive_failures: 0,
      consecutive_queue_only: 0,
      last_refresh_succeeded_at: NOW.toISOString(),
    });
    // Partial triggers MV refresh.
    expect(recorded.rpcCalled).toEqual(["refresh_community_tier_consensus"]);
  });
});

describe("runSourceRefresh — coverage failure queues all", () => {
  it("prior character missing this run → all sections queue:true, status 'queued'", async () => {
    fetchSourceHtml.mockResolvedValue({ ok: true, html: "<html></html>" });
    // Only ironclad present this run; prior had ironclad + silent → coverage fails.
    parse.mockReturnValue({
      adapterId: "mobalytics",
      sections: [section("ironclad", 100)],
      warnings: [],
    });
    // Even though this section matches fully, coverage-fail forces it to queue.
    matchSection.mockResolvedValue(fullMatch(100));
    applySection.mockResolvedValue({ listId: "list-x", entryCount: 100 });

    const { supabase, recorded } = makeSupabase({
      priorLists: {
        data: [
          { character: "ironclad", entry_count: 100, game_version: "0.3.5" },
          { character: "silent", entry_count: 100, game_version: "0.3.5" },
        ],
        error: null,
      },
    });
    const source = makeSource({ consecutive_queue_only: 0 });

    const result = await runSourceRefresh(supabase, source, {
      trigger: "cron",
      deferMvRefresh: false,
      now: NOW,
    });

    expect(result.status).toBe("queued");
    expect(result.sectionsApplied).toBe(0);
    expect(result.sectionsQueued).toBe(1);

    expect(applySection).toHaveBeenCalledTimes(1);
    const input = applySection.mock.calls[0][1] as Record<string, unknown>;
    expect(input.queue).toBe(true);

    // Queued → consecutive_queue_only incremented, +7d, NOT dormant yet.
    expect(recorded.sourceUpdate).toMatchObject({
      consecutive_queue_only: 1,
      dormant: false,
      next_refresh_at: new Date(NOW.getTime() + 7 * 86_400_000).toISOString(),
    });
    // queued is not a success → no last_refresh_succeeded_at bump, no rpc.
    expect(recorded.sourceUpdate).toMatchObject({
      last_refresh_succeeded_at: null,
    });
    expect(recorded.rpcCalled).toEqual([]);
  });
});

describe("runSourceRefresh — all sections fail to apply", () => {
  it("23505 on the only section → status 'failed' reason 'all_sections_failed' (0/0)", async () => {
    fetchSourceHtml.mockResolvedValue({ ok: true, html: "<html></html>" });
    parse.mockReturnValue({
      adapterId: "mobalytics",
      sections: [section("ironclad", 50)],
      warnings: [],
    });
    matchSection.mockResolvedValue(fullMatch(50)); // passes gate → would apply
    applySection.mockRejectedValue({ code: "23505" }); // …but the insert collides

    const { supabase, recorded } = makeSupabase();

    const result = await runSourceRefresh(supabase, makeSource(), {
      trigger: "cron",
      deferMvRefresh: false,
      now: NOW,
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("all_sections_failed");
    expect(result.sectionsApplied).toBe(0);
    expect(result.sectionsQueued).toBe(0);
    expect(result.sectionsAttempted).toBe(1);

    // Failure backoff applies (failures incremented, +1d on first failure).
    expect(recorded.sourceUpdate).toMatchObject({
      consecutive_failures: 1,
      last_failure_reason: "all_sections_failed",
      last_refresh_succeeded_at: null,
    });
    expect(recorded.auditInsert).toMatchObject({
      status: "failed",
      sections_attempted: 1,
      sections_applied: 0,
      sections_queued: 0,
    });
    expect(recorded.rpcCalled).toEqual([]);
  });
});
