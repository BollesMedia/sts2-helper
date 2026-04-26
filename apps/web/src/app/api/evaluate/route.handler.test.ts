/**
 * @vitest-environment node
 *
 * Route-level HTTP test for `/api/evaluate` (sts2-helper#88).
 *
 * The sibling `route.test.ts` exercises the AI SDK + zod + adapter boundary
 * that the route depends on, but it never touches the actual exported `POST`
 * handler. That leaves handler-level concerns — auth wrapping, response
 * shaping, request body validation, error envelope — uncovered.
 *
 * This file builds a real `Request`, calls the wrapped `POST` export end-to-end
 * via the `route-test-client` harness, and asserts on the returned status +
 * JSON body. `requireAuth` is mocked so the handler runs without Supabase auth;
 * `generateText` is mocked so the LLM call is replaced with a fixed narrator
 * payload. Everything else (scoring, branch derivation, response assembly)
 * runs for real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { callRoute } from "@/lib/__tests__/route-test-client";
import type { EnrichedPath } from "@sts2/shared/evaluation/map/enrich-paths";
import type { RunState } from "@sts2/shared/evaluation/map/run-state";

// ─── Module mocks (hoisted) ─────────────────────────────────────────────

// Bypass auth entirely. `withAuth` injects the resolved auth context as the
// handler's second positional arg in production (see
// `apps/web/src/lib/api-auth.ts`). The passthrough mirrors that signature so
// route handlers that destructure `userId` from the second arg (e.g.
// /api/run, /api/choice) don't crash when this mock is reused for them. Rest
// args (Next 16 dynamic-route ctx) are forwarded so `[id]` routes work too.
vi.mock("@/lib/api-auth", () => ({
  withAuth:
    <THandler extends (...args: unknown[]) => unknown>(handler: THandler) =>
    (req: Request, ...rest: unknown[]) =>
      handler(req, { userId: "test-user" }, ...rest),
  requireAuth: vi.fn(async () => ({ userId: "test-user" })),
}));

// Stub Supabase entirely. The map-coach branch only touches it for
// fire-and-forget `logUsage` calls and the cached boss/keyword loaders, which
// already swallow errors. A no-op chainable client keeps everything quiet.
vi.mock("@/lib/supabase/server", () => {
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  Object.assign(chain, {
    from: passthrough,
    select: passthrough,
    eq: passthrough,
    in: passthrough,
    order: passthrough,
    not: passthrough,
    single: () => Promise.resolve({ data: null, error: null }),
    then: (resolve: (val: { data: null; error: null }) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve),
  });
  return {
    createServiceClient: () => chain,
  };
});

vi.mock("@/lib/usage-logger", () => ({
  logUsage: vi.fn(async () => undefined),
}));

vi.mock("@/evaluation/run-history-context", () => ({
  getRunHistoryContext: vi.fn(async () => ""),
}));

vi.mock("@/evaluation/strategy/character-strategies", () => ({
  getCharacterStrategy: vi.fn(async () => null),
}));

// Replace `generateText` so the LLM call returns a fixed narrator payload.
// `Output` and `NoObjectGeneratedError` keep their real implementations so the
// handler's structured-output wiring runs unchanged.
vi.mock("ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("ai")>();
  return {
    ...real,
    generateText: vi.fn(),
  };
});

// `@ai-sdk/anthropic` reaches for env vars on import — stub it.
vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: () => ({ provider: "mock" }),
}));

// ─── Fixtures ───────────────────────────────────────────────────────────

function makeRunState(overrides: Partial<RunState> = {}): RunState {
  return {
    hp: { current: 60, max: 80, ratio: 0.75 },
    gold: 100,
    act: 1,
    floor: 5,
    floorsRemainingInAct: 11,
    ascension: 10,
    deck: { size: 15, archetype: null, avgUpgradeRatio: 0, removalCandidates: 6 },
    relics: { combatRelevant: [], pathAffecting: [] },
    riskCapacity: {
      hpBufferAbsolute: 36,
      expectedDamagePerFight: 16,
      fightsBeforeDanger: 2,
      verdict: "moderate",
    },
    eliteBudget: { actTarget: [2, 3], eliteFloorsFought: [], remaining: 2, shouldSeek: true },
    goldMath: { current: 100, removalAffordable: true, shopVisitsAhead: 1, projectedShopBudget: 220 },
    monsterPool: { currentPool: "easy", fightsUntilHardPool: 3 },
    bossPreview: {
      candidates: [],
      dangerousMatchups: [],
      preBossRestFloor: 16,
      hpEnteringPreBossRest: 40,
      preBossRestRecommendation: "heal",
    },
    ...overrides,
  };
}

function makeEnrichedPath(id: string, eliteFloor: number): EnrichedPath {
  return {
    id,
    nodes: [
      { floor: 6, type: "monster", nodeId: "1,6" },
      { floor: 7, type: "rest", nodeId: "1,7" },
      { floor: eliteFloor, type: "elite", nodeId: "1,8" },
      { floor: 9, type: "monster", nodeId: "1,9" },
    ],
    patterns: [],
    aggregates: {
      elitesTaken: 1,
      monstersTaken: 2,
      restsTaken: 1,
      shopsTaken: 0,
      hardPoolFightsOnPath: 0,
      totalFights: 3,
      projectedHpEnteringPreBossRest: 40,
      fightBudgetStatus: "within_budget",
      hpProjectionVerdict: "safe",
    },
  };
}

const validNarratorOutput = {
  headline: "Take the rest-then-elite line.",
  reasoning: "Rest before the elite preserves HP for the post-elite chain.",
  teaching_callouts: [
    {
      pattern: "rest_before_elite",
      explanation: "Rest immediately before an elite turns one fight from risky to comfortable.",
    },
  ],
};

function buildMapBody(overrides: Record<string, unknown> = {}) {
  return {
    type: "map" as const,
    evalType: "map",
    mapPrompt: "Map state placeholder for the narrator step.",
    runId: "run-test",
    gameVersion: "test-version",
    context: {
      character: "Ironclad",
      archetypes: [],
      primaryArchetype: null,
      act: 1,
      floor: 5,
      ascension: 10,
      deckSize: 15,
      hpPercent: 0.75,
      gold: 100,
      energy: 3,
      relicIds: [],
      hasScaling: false,
      curseCount: 0,
      deckCards: [],
      drawSources: [],
      scalingSources: [],
      curseNames: [],
      relics: [],
      potionNames: [],
      upgradeCount: 0,
      deckMaturity: 0,
      relicCount: 0,
    },
    mapCompliance: {
      nodes: [],
      nextOptions: [],
      boss: { col: 0, row: 16 },
      currentPosition: { col: 1, row: 5 },
      enrichedPaths: [makeEnrichedPath("A", 8), makeEnrichedPath("B", 8)],
      runState: makeRunState(),
      cardRemovalCost: 75,
    },
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("/api/evaluate POST — map-coach route handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: returns a 200 with a fully assembled map-coach response", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValue({
      output: validNarratorOutput,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    } as unknown as Awaited<ReturnType<typeof generateText>>);

    const { POST } = await import("./route");

    const { status, json } = await callRoute<{
      headline: string;
      confidence: number;
      macro_path: { floors: { floor: number; node_type: string; node_id: string }[]; summary: string };
      key_branches: unknown[];
      teaching_callouts: { pattern: string; explanation: string }[];
      compliance: { scoredPaths: { id: string; score: number }[] };
    }>(POST, { body: buildMapBody() });

    expect(status).toBe(200);
    // Headline + reasoning come straight from the narrator (the LLM step).
    expect(json.headline).toBe(validNarratorOutput.headline);
    // Scorer ran for real on the supplied paths — at least one path scored.
    expect(json.compliance.scoredPaths.length).toBeGreaterThan(0);
    // Confidence is clamped into [0, 1] by the sanitizer.
    expect(json.confidence).toBeGreaterThanOrEqual(0);
    expect(json.confidence).toBeLessThanOrEqual(1);
    // Macro path is assembled from the winning candidate's nodes — summary is
    // the deterministic node-type chain from `narratorInput.chosenPath`, NOT
    // the LLM's reasoning text.
    expect(json.macro_path.floors.length).toBeGreaterThan(0);
    expect(json.macro_path.summary).toMatch(/elite/);
    // Narrator callouts flow into teaching_callouts on the wire.
    expect(json.teaching_callouts[0].pattern).toBe("rest_before_elite");
    expect(json.teaching_callouts[0].explanation).toBe(
      validNarratorOutput.teaching_callouts[0].explanation,
    );
    // The LLM was actually called by the handler — proves the harness hit
    // the route, not just the mocked supabase layer.
    expect(vi.mocked(generateText)).toHaveBeenCalledTimes(1);
  }, 20_000);

  it("sad path: returns 400 with an error detail when mapCompliance is missing", async () => {
    const { POST } = await import("./route");

    const { mapCompliance: _omit, ...badBody } = buildMapBody();
    void _omit;

    const { status, json } = await callRoute<{ error: string }>(POST, { body: badBody });

    expect(status).toBe(400);
    expect(json.error).toMatch(/missing map compliance inputs/i);
  }, 20_000);
});
