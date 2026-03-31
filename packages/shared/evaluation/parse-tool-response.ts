import { tierToValue, type TierLetter } from "./tier-utils";
import type { CardRewardEvaluation } from "./types";

export interface ClaudeCardEvaluation {
  item_id: string;
  rank: number;
  tier: TierLetter;
  synergy_score: number;
  confidence: number;
  recommendation: "strong_pick" | "good_pick" | "situational" | "skip";
  reasoning: string;
  _position?: number;
}

export interface ClaudeCardRewardResponse {
  rankings: ClaudeCardEvaluation[];
  pick_summary: string | null;
  skip_recommended: boolean;
  skip_reasoning: string | null;
  spending_plan?: string | null;
}

export const VALID_TIERS = new Set(["S", "A", "B", "C", "D", "F"]);
export const VALID_RECS = new Set(["strong_pick", "good_pick", "situational", "skip"]);

/**
 * Extract a JSON array from a string that may contain trailing fields.
 * e.g., '[\n{...}\n],\n"skip_recommended": false' -> parses just the array.
 */
export function parseRankingsString(str: string): unknown[] {
  // Try parsing the whole string first (valid JSON array)
  try {
    const parsed = JSON.parse(str);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Not valid JSON as-is — extract the array portion
  }

  // Find the array boundaries: first [ to its matching ]
  const start = str.indexOf("[");
  if (start === -1) return [];

  let depth = 0;
  for (let i = start; i < str.length; i++) {
    if (str[i] === "[") depth++;
    else if (str[i] === "]") depth--;
    if (depth === 0) {
      try {
        const parsed = JSON.parse(str.slice(start, i + 1));
        if (Array.isArray(parsed)) return parsed;
      } catch {
        return [];
      }
    }
  }

  return [];
}

/**
 * Safely parse an unknown tool_use input into a ClaudeCardRewardResponse.
 * Validates structure at runtime instead of casting through unknown.
 */
export function parseToolUseInput(input: unknown): ClaudeCardRewardResponse {
  if (!input || typeof input !== "object") {
    throw new Error("Tool use input is not an object");
  }

  const obj = input as Record<string, unknown>;

  // Claude sometimes returns rankings as a JSON string instead of an array.
  // The string may also contain trailing fields like "skip_recommended": false
  // appended after the array, making it invalid JSON on its own.
  let rawRankings: unknown[];
  if (Array.isArray(obj.rankings)) {
    rawRankings = obj.rankings;
  } else if (typeof obj.rankings === "string") {
    rawRankings = parseRankingsString(obj.rankings);
  } else {
    rawRankings = [];
  }

  const rankings: ClaudeCardEvaluation[] = rawRankings.map((r: unknown, idx: number) => {
    if (!r || typeof r !== "object") {
      throw new Error("Ranking entry is not an object");
    }
    const entry = r as Record<string, unknown>;

    const tier = String(entry.tier ?? "C");
    // Derive recommendation from tier if not provided (simplified schema)
    const rec = entry.recommendation
      ? String(entry.recommendation)
      : tier === "S" || tier === "A" ? "strong_pick"
        : tier === "B" ? "good_pick"
          : tier === "C" ? "situational"
            : "skip";
    // Use position (1-indexed) if available, fall back to array index
    // Note: entry.position != null (not truthy) because position 0 is falsy in JS
    const position = entry.position != null ? Number(entry.position) - 1 : idx;

    return {
      item_id: entry.item_id ? String(entry.item_id) : String(position),
      rank: entry.rank ? Number(entry.rank) : idx + 1,
      tier: (VALID_TIERS.has(tier) ? tier : "C") as TierLetter,
      synergy_score: Number(entry.synergy_score ?? 50),
      confidence: Number(entry.confidence ?? 50),
      recommendation: (VALID_RECS.has(rec) ? rec : "situational") as ClaudeCardEvaluation["recommendation"],
      reasoning: String(entry.reasoning ?? ""),
      // Store position for position-based matching in route.ts
      _position: position,
    };
  });

  // When rankings was a string, other fields may also be embedded in it.
  // Extract them via regex as a fallback.
  const rankingsStr = typeof obj.rankings === "string" ? obj.rankings : "";

  const skipRecommended = obj.skip_recommended
    ?? (() => {
      const m = rankingsStr.match(/"skip_recommended"\s*:\s*(true|false)/);
      return m ? m[1] === "true" : false;
    })();

  const skipReasoning = obj.skip_reasoning
    ?? (() => {
      const m = rankingsStr.match(/"skip_reasoning"\s*:\s*"([^"]*)"/);
      return m ? m[1] : null;
    })();

  const pickSummary = obj.pick_summary
    ?? (() => {
      // Standard JSON format
      const m = rankingsStr.match(/"pick_summary"\s*:\s*"([^"]*)"/);
      if (m) return m[1];
      // Claude sometimes emits XML parameter format inside the string
      const xml = rankingsStr.match(/<parameter name="pick_summary">(.*?)(?:<\/parameter>|"|$)/);
      if (xml) return xml[1];
      // Colon-separated format (after comma in the string)
      const alt = rankingsStr.match(/pick_summary[>":\s]+(Pick[^"}<]+|Skip[^"}<]+)/i);
      if (alt) return alt[1].trim();
      return null;
    })();

  return {
    rankings,
    pick_summary: pickSummary ? String(pickSummary) : null,
    skip_recommended: Boolean(skipRecommended),
    skip_reasoning: skipReasoning ? String(skipReasoning) : null,
    spending_plan: obj.spending_plan ? String(obj.spending_plan) : null,
  };
}

/**
 * Parse Claude's JSON response into typed evaluations.
 */
export function parseClaudeCardRewardResponse(
  raw: ClaudeCardRewardResponse
): CardRewardEvaluation {
  return {
    rankings: raw.rankings.map((r) => ({
      itemId: r.item_id,
      itemName: r.item_id,
      itemIndex: r._position,
      rank: r.rank,
      tier: r.tier,
      tierValue: tierToValue(r.tier),
      synergyScore: r.synergy_score,
      confidence: r.confidence,
      recommendation: r.recommendation,
      reasoning: r.reasoning,
      source: "claude" as const,
    })),
    pickSummary: raw.pick_summary ?? null,
    skipRecommended: raw.skip_recommended,
    skipReasoning: raw.skip_reasoning,
    spendingPlan: raw.spending_plan ?? null,
  };
}
