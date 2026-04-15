import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types";
import {
  getCommunityTierSignals,
  classifyByTime,
  classifyByVersion,
  buildSignal,
  computeStaleness,
  normalizeCharacter,
  type ConsensusRow,
  type GameVersionMeta,
} from "./community-tier";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

function makeRow(overrides: Partial<ConsensusRow> = {}): ConsensusRow {
  return {
    card_id: "STRIKE",
    character_scope: "any",
    source_count: 3,
    weighted_tier: 4,
    tier_stddev: 0.3,
    most_recent_published: daysAgo(10),
    game_versions: ["1.0"],
    ...overrides,
  };
}

function makeVersionMeta(
  overrides: Partial<GameVersionMeta> = {},
): GameVersionMeta {
  return {
    version: "1.0",
    released_at: daysAgo(10),
    is_major_balance_patch: false,
    ...overrides,
  };
}

/** Build a minimal Supabase mock that chains .from().select().in().in() */
function makeSupabaseMock(options: {
  consensusRows?: ConsensusRow[];
  gameVersionRows?: Array<{
    version: string;
    released_at: string | null;
    is_major_balance_patch: boolean;
  }>;
  consensusError?: { message: string };
}): SupabaseClient<Database> {
  const { consensusRows = [], gameVersionRows = [], consensusError } = options;

  const makeChainable = (finalData: unknown, finalError?: { message: string }) => {
    const chain: Record<string, unknown> = {};
    const then = (resolve: (v: { data: unknown; error: unknown }) => void) =>
      resolve({ data: finalData, error: finalError ?? null });

    const methods = ["select", "in", "eq", "is", "single"];
    for (const m of methods) {
      chain[m] = () => ({ ...chain, then });
    }
    chain["then"] = then;
    return chain;
  };

  const fromMock = (table: string) => {
    if (table === "community_tier_consensus") {
      return makeChainable(consensusRows, consensusError);
    }
    if (table === "game_versions") {
      return makeChainable(gameVersionRows);
    }
    return makeChainable([]);
  };

  return { from: fromMock } as unknown as SupabaseClient<Database>;
}

// ---------------------------------------------------------------------------
// getCommunityTierSignals
// ---------------------------------------------------------------------------

describe("getCommunityTierSignals", () => {
  it("returns empty Map when cardIds is empty", async () => {
    const supabase = makeSupabaseMock({});
    const result = await getCommunityTierSignals(supabase, [], null, null);
    expect(result.size).toBe(0);
  });

  it("returns empty Map when Supabase returns an error", async () => {
    const supabase = makeSupabaseMock({
      consensusError: { message: "db error" },
    });
    const result = await getCommunityTierSignals(
      supabase,
      ["STRIKE"],
      null,
      null,
    );
    expect(result.size).toBe(0);
  });

  it("returns empty Map when no rows returned", async () => {
    const supabase = makeSupabaseMock({ consensusRows: [] });
    const result = await getCommunityTierSignals(
      supabase,
      ["STRIKE"],
      null,
      null,
    );
    expect(result.size).toBe(0);
  });

  it("maps a valid 'any' row to a signal", async () => {
    const supabase = makeSupabaseMock({
      consensusRows: [makeRow()],
      gameVersionRows: [
        {
          version: "1.0",
          released_at: daysAgo(10),
          is_major_balance_patch: false,
        },
      ],
    });
    const result = await getCommunityTierSignals(
      supabase,
      ["STRIKE"],
      null,
      "1.0",
    );
    expect(result.has("STRIKE")).toBe(true);
    const signal = result.get("STRIKE")!;
    expect(signal.sourceCount).toBe(3);
    expect(signal.consensusTierLetter).toBe("B"); // weighted_tier: 4
    expect(signal.agreement).toBe("strong"); // stddev 0.3 < 0.5
    expect(signal.staleness).toBe("fresh");
  });

  it("excludes cards with source_count 0", async () => {
    const supabase = makeSupabaseMock({
      consensusRows: [makeRow({ source_count: 0 })],
    });
    const result = await getCommunityTierSignals(
      supabase,
      ["STRIKE"],
      null,
      null,
    );
    expect(result.size).toBe(0);
  });

  it("excludes cards with null card_id", async () => {
    const supabase = makeSupabaseMock({
      consensusRows: [makeRow({ card_id: null })],
    });
    const result = await getCommunityTierSignals(
      supabase,
      ["STRIKE"],
      null,
      null,
    );
    expect(result.size).toBe(0);
  });

  it("handles multiple cards", async () => {
    const supabase = makeSupabaseMock({
      consensusRows: [
        makeRow({ card_id: "STRIKE" }),
        makeRow({ card_id: "DEFEND", weighted_tier: 2 }),
      ],
    });
    const result = await getCommunityTierSignals(
      supabase,
      ["STRIKE", "DEFEND"],
      null,
      null,
    );
    expect(result.size).toBe(2);
    expect(result.get("DEFEND")?.consensusTierLetter).toBe("D");
  });
});

// ---------------------------------------------------------------------------
// classifyByTime
// ---------------------------------------------------------------------------

describe("classifyByTime", () => {
  it("null publishedAt → 'fresh' (no date, no penalty)", () => {
    expect(classifyByTime(null)).toBe("fresh");
  });

  it("invalid date string → 'fresh'", () => {
    expect(classifyByTime("not-a-date")).toBe("fresh");
  });

  it("published today → 'fresh'", () => {
    expect(classifyByTime(daysAgo(0))).toBe("fresh");
  });

  it("published 100 days ago → 'fresh'", () => {
    expect(classifyByTime(daysAgo(100))).toBe("fresh");
  });

  it("published 179 days ago → 'fresh' (just under AGING_DAYS threshold)", () => {
    expect(classifyByTime(daysAgo(179))).toBe("fresh");
  });

  it("published 200 days ago → 'aging'", () => {
    expect(classifyByTime(daysAgo(200))).toBe("aging");
  });

  it("published 364 days ago → 'aging' (just under STALE_DAYS threshold)", () => {
    expect(classifyByTime(daysAgo(364))).toBe("aging");
  });

  it("published 400 days ago → 'excluded'", () => {
    expect(classifyByTime(daysAgo(400))).toBe("excluded");
  });

  it("published 366 days ago → 'excluded'", () => {
    expect(classifyByTime(daysAgo(366))).toBe("excluded");
  });
});

// ---------------------------------------------------------------------------
// classifyByVersion
// ---------------------------------------------------------------------------

describe("classifyByVersion", () => {
  it("no currentGameVersion → 'fresh'", () => {
    expect(classifyByVersion(["1.0"], null, new Map())).toBe("fresh");
  });

  it("no listVersions → 'fresh'", () => {
    expect(classifyByVersion(null, "1.0", new Map())).toBe("fresh");
  });

  it("empty listVersions → 'fresh'", () => {
    expect(classifyByVersion([], "1.0", new Map())).toBe("fresh");
  });

  it("currentGameVersion has no metadata → 'fresh'", () => {
    const meta = new Map<string, GameVersionMeta>();
    // version present in map but no released_at
    meta.set("1.0", makeVersionMeta({ released_at: null }));
    expect(classifyByVersion(["1.0"], "1.0", meta)).toBe("fresh");
  });

  it("list version matches current version → 'fresh'", () => {
    const meta = new Map<string, GameVersionMeta>();
    const date = daysAgo(30);
    meta.set("1.0", makeVersionMeta({ version: "1.0", released_at: date }));
    expect(classifyByVersion(["1.0"], "1.0", meta)).toBe("fresh");
  });

  it("list version is older but no balance patch between → 'aging'", () => {
    const meta = new Map<string, GameVersionMeta>();
    meta.set("0.9", makeVersionMeta({ version: "0.9", released_at: daysAgo(60) }));
    meta.set("1.0", makeVersionMeta({ version: "1.0", released_at: daysAgo(10) }));
    // No balance patches
    expect(classifyByVersion(["0.9"], "1.0", meta)).toBe("aging");
  });

  it("list version is older AND a balance patch exists between → 'stale'", () => {
    const meta = new Map<string, GameVersionMeta>();
    meta.set("0.9", makeVersionMeta({ version: "0.9", released_at: daysAgo(60) }));
    meta.set("1.0-balance", makeVersionMeta({
      version: "1.0-balance",
      released_at: daysAgo(30),
      is_major_balance_patch: true,
    }));
    meta.set("1.0", makeVersionMeta({ version: "1.0", released_at: daysAgo(10) }));
    expect(classifyByVersion(["0.9"], "1.0", meta)).toBe("stale");
  });

  it("balance patch is AFTER current version, not between → 'aging'", () => {
    const meta = new Map<string, GameVersionMeta>();
    meta.set("0.9", makeVersionMeta({ version: "0.9", released_at: daysAgo(20) }));
    meta.set("1.0", makeVersionMeta({ version: "1.0", released_at: daysAgo(10) }));
    // Patch is in the future relative to current
    meta.set("1.1-balance", makeVersionMeta({
      version: "1.1-balance",
      released_at: daysAgo(5),
      is_major_balance_patch: true,
    }));
    // Patch at daysAgo(5) > current at daysAgo(10) → not between list and current
    expect(classifyByVersion(["0.9"], "1.0", meta)).toBe("aging");
  });

  it("list version has no metadata → newestListDate stays 0 → 'fresh'", () => {
    const meta = new Map<string, GameVersionMeta>();
    meta.set("1.0", makeVersionMeta({ version: "1.0", released_at: daysAgo(10) }));
    // "0.9" not in meta at all
    expect(classifyByVersion(["0.9"], "1.0", meta)).toBe("fresh");
  });
});

// ---------------------------------------------------------------------------
// buildSignal
// ---------------------------------------------------------------------------

describe("buildSignal", () => {
  const emptyVersionMeta = new Map<string, GameVersionMeta>();

  it("returns null when rows is empty", () => {
    expect(buildSignal([], null, null, emptyVersionMeta)).toBeNull();
  });

  it("returns null when source_count is 0", () => {
    const row = makeRow({ source_count: 0 });
    expect(buildSignal([row], null, null, emptyVersionMeta)).toBeNull();
  });

  it("returns null when source_count is null", () => {
    const row = makeRow({ source_count: null });
    expect(buildSignal([row], null, null, emptyVersionMeta)).toBeNull();
  });

  it("returns null when staleness is 'excluded'", () => {
    // published 400 days ago → classifyByTime returns 'excluded'
    const row = makeRow({ most_recent_published: daysAgo(400) });
    expect(buildSignal([row], null, null, emptyVersionMeta)).toBeNull();
  });

  it("uses 'any' scope row when no character given", () => {
    const anyRow = makeRow({ character_scope: "any", weighted_tier: 5 });
    const charRow = makeRow({ character_scope: "the ironclad", weighted_tier: 2 });
    const signal = buildSignal([anyRow, charRow], null, null, emptyVersionMeta);
    expect(signal?.consensusTier).toBe(5);
  });

  it("character-specific row takes precedence over 'any'", () => {
    const anyRow = makeRow({ character_scope: "any", weighted_tier: 3 });
    // Tier lists store the short form ("ironclad"); game state sends
    // "The Ironclad" which the query normalizes before matching.
    const charRow = makeRow({ character_scope: "ironclad", weighted_tier: 6 });
    const signal = buildSignal(
      [anyRow, charRow],
      "The Ironclad",
      null,
      emptyVersionMeta,
    );
    expect(signal?.consensusTier).toBe(6);
  });

  it("falls back to 'any' when character row absent", () => {
    const anyRow = makeRow({ character_scope: "any", weighted_tier: 4 });
    const signal = buildSignal([anyRow], "the silent", null, emptyVersionMeta);
    expect(signal?.consensusTier).toBe(4);
  });

  it("stddev < 0.5 → agreement 'strong'", () => {
    const row = makeRow({ tier_stddev: 0.4 });
    const signal = buildSignal([row], null, null, emptyVersionMeta);
    expect(signal?.agreement).toBe("strong");
  });

  it("stddev === 0.5 → agreement 'mixed'", () => {
    const row = makeRow({ tier_stddev: 0.5 });
    const signal = buildSignal([row], null, null, emptyVersionMeta);
    expect(signal?.agreement).toBe("mixed");
  });

  it("stddev 0.8 → agreement 'mixed'", () => {
    const row = makeRow({ tier_stddev: 0.8 });
    const signal = buildSignal([row], null, null, emptyVersionMeta);
    expect(signal?.agreement).toBe("mixed");
  });

  it("stddev > 1.2 → agreement 'split'", () => {
    const row = makeRow({ tier_stddev: 1.5 });
    const signal = buildSignal([row], null, null, emptyVersionMeta);
    expect(signal?.agreement).toBe("split");
  });

  it("stddev === 1.2 → agreement 'mixed'", () => {
    const row = makeRow({ tier_stddev: 1.2 });
    const signal = buildSignal([row], null, null, emptyVersionMeta);
    expect(signal?.agreement).toBe("mixed");
  });

  it("consensusTierLetter maps correctly: tier 4 → B", () => {
    const row = makeRow({ weighted_tier: 4 });
    const signal = buildSignal([row], null, null, emptyVersionMeta);
    expect(signal?.consensusTierLetter).toBe("B");
  });

  it("consensusTierLetter maps correctly: tier 6 → S", () => {
    const row = makeRow({ weighted_tier: 6 });
    const signal = buildSignal([row], null, null, emptyVersionMeta);
    expect(signal?.consensusTierLetter).toBe("S");
  });

  it("consensusTierLetter maps correctly: tier 1 → F", () => {
    const row = makeRow({ weighted_tier: 1 });
    const signal = buildSignal([row], null, null, emptyVersionMeta);
    expect(signal?.consensusTierLetter).toBe("F");
  });

  it("clamps fractional weighted_tier for letter: 4.7 rounds to 5 → A", () => {
    const row = makeRow({ weighted_tier: 4.7 });
    const signal = buildSignal([row], null, null, emptyVersionMeta);
    expect(signal?.consensusTierLetter).toBe("A");
    expect(signal?.consensusTier).toBeCloseTo(4.7); // raw value preserved
  });

  it("passes through mostRecentPublished", () => {
    const date = daysAgo(5);
    const row = makeRow({ most_recent_published: date });
    const signal = buildSignal([row], null, null, emptyVersionMeta);
    expect(signal?.mostRecentPublished).toBe(date);
  });
});

// ---------------------------------------------------------------------------
// computeStaleness
// ---------------------------------------------------------------------------

describe("computeStaleness", () => {
  const emptyMeta = new Map<string, GameVersionMeta>();

  it("time excluded → 'excluded'", () => {
    const row = makeRow({ most_recent_published: daysAgo(400) });
    expect(computeStaleness(row, null, emptyMeta)).toBe("excluded");
  });

  it("time stale + version fresh → 'stale'", () => {
    // 200 days old → aging from time, but let's use version stale instead
    const meta = new Map<string, GameVersionMeta>();
    meta.set("0.9", makeVersionMeta({ version: "0.9", released_at: daysAgo(60) }));
    meta.set("1.0-balance", makeVersionMeta({
      version: "1.0-balance",
      released_at: daysAgo(30),
      is_major_balance_patch: true,
    }));
    meta.set("1.0", makeVersionMeta({ version: "1.0", released_at: daysAgo(10) }));

    const row = makeRow({
      most_recent_published: daysAgo(10),
      game_versions: ["0.9"],
    });
    // version stale (balance patch between), time fresh → combined: stale
    expect(computeStaleness(row, "1.0", meta)).toBe("stale");
  });

  it("time aging + version fresh → 'aging'", () => {
    const row = makeRow({ most_recent_published: daysAgo(200) });
    expect(computeStaleness(row, null, emptyMeta)).toBe("aging");
  });

  it("both fresh → 'fresh'", () => {
    const row = makeRow({ most_recent_published: daysAgo(10) });
    expect(computeStaleness(row, null, emptyMeta)).toBe("fresh");
  });
});

// ---------------------------------------------------------------------------
// End-to-end with mocked Supabase
// ---------------------------------------------------------------------------

describe("getCommunityTierSignals – end-to-end", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("full flow: character-specific wins, version-aware staleness applied", async () => {
    const versionDate = daysAgo(10);
    const listDate = daysAgo(90);

    const supabase = makeSupabaseMock({
      consensusRows: [
        // 'any' fallback
        {
          card_id: "STRIKE",
          character_scope: "any",
          source_count: 5,
          weighted_tier: 3,
          tier_stddev: 0.4,
          most_recent_published: listDate,
          game_versions: ["1.0"],
        },
        // character-specific — should win. Tier lists store "ironclad"
        // (short form); the query normalizes "The Ironclad" → "ironclad".
        {
          card_id: "STRIKE",
          character_scope: "ironclad",
          source_count: 10,
          weighted_tier: 5,
          tier_stddev: 0.2,
          most_recent_published: listDate,
          game_versions: ["1.0"],
        },
      ],
      gameVersionRows: [
        { version: "1.0", released_at: versionDate, is_major_balance_patch: false },
      ],
    });

    const result = await getCommunityTierSignals(
      supabase,
      ["STRIKE"],
      "The Ironclad",
      "1.0",
    );

    expect(result.size).toBe(1);
    const signal = result.get("STRIKE")!;
    expect(signal.sourceCount).toBe(10); // character-specific row
    expect(signal.consensusTier).toBe(5);
    expect(signal.consensusTierLetter).toBe("A");
    expect(signal.agreement).toBe("strong"); // stddev 0.2
    expect(signal.staleness).toBe("fresh"); // version matches current, recent date
  });
});

describe("normalizeCharacter", () => {
  it("strips 'The ' prefix and lowercases", () => {
    expect(normalizeCharacter("The Ironclad")).toBe("ironclad");
    expect(normalizeCharacter("THE SILENT")).toBe("silent");
    expect(normalizeCharacter("Defect")).toBe("defect");
  });

  it("handles already-normalized input", () => {
    expect(normalizeCharacter("ironclad")).toBe("ironclad");
    expect(normalizeCharacter("silent")).toBe("silent");
  });

  it("returns null for null, empty, or 'unknown'", () => {
    expect(normalizeCharacter(null)).toBeNull();
    expect(normalizeCharacter("")).toBeNull();
    expect(normalizeCharacter("Unknown")).toBeNull();
    expect(normalizeCharacter("   ")).toBeNull();
  });

  it("trims whitespace", () => {
    expect(normalizeCharacter("  The Ironclad  ")).toBe("ironclad");
  });

  it("excludes card when time-based staleness is excluded (>365 days)", async () => {
    const supabase = makeSupabaseMock({
      consensusRows: [
        {
          card_id: "DEFEND",
          character_scope: "any",
          source_count: 5,
          weighted_tier: 4,
          tier_stddev: 0.3,
          most_recent_published: daysAgo(400),
          game_versions: [],
        },
      ],
      gameVersionRows: [],
    });

    const result = await getCommunityTierSignals(
      supabase,
      ["DEFEND"],
      null,
      null,
    );
    expect(result.size).toBe(0);
  });

  it("returns 'stale' when balance patch exists between list version and current", async () => {
    const supabase = makeSupabaseMock({
      consensusRows: [
        {
          card_id: "BASH",
          character_scope: "any",
          source_count: 3,
          weighted_tier: 4,
          tier_stddev: 0.5,
          most_recent_published: daysAgo(30),
          game_versions: ["0.9"],
        },
      ],
      gameVersionRows: [
        { version: "0.9", released_at: daysAgo(90), is_major_balance_patch: false },
        { version: "1.0-balance", released_at: daysAgo(45), is_major_balance_patch: true },
        { version: "1.0", released_at: daysAgo(10), is_major_balance_patch: false },
      ],
    });

    const result = await getCommunityTierSignals(supabase, ["BASH"], null, "1.0");
    expect(result.size).toBe(1);
    expect(result.get("BASH")?.staleness).toBe("stale");
  });
});
