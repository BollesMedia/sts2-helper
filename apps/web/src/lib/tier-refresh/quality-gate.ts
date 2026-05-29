import type { GateResult, SectionGateResult } from "./types";

const MATCH_RATE_MIN = 0.95;
const ENTRY_DELTA_PCT = 0.1;
const ENTRY_DELTA_CARD_FLOOR = 3;

export interface SectionMatchSummary {
  detectedCharacter: string | null;
  matchedCount: number;
  totalCount: number;
  warnings: string[];
}

export interface GateContext {
  priorCharacters: string[];
  priorEntryCountByCharacter: Map<string | null, number>;
}

export function evaluateGate(
  sections: SectionMatchSummary[],
  ctx: GateContext,
): GateResult {
  const perSection: SectionGateResult[] = sections.map((s) => {
    const checks: SectionGateResult["checks"] = [];
    const matchRate = s.totalCount === 0 ? 0 : s.matchedCount / s.totalCount;
    if (matchRate < MATCH_RATE_MIN) {
      checks.push({
        name: "match_rate",
        value: matchRate,
        threshold: MATCH_RATE_MIN,
      });
    }
    if (s.warnings.length > 0) {
      checks.push({
        name: "adapter_warnings",
        value: s.warnings.length,
        threshold: 0,
      });
    }
    const prior = ctx.priorEntryCountByCharacter.get(s.detectedCharacter);
    if (prior != null) {
      const delta = Math.abs(s.totalCount - prior);
      const allowed = Math.max(prior * ENTRY_DELTA_PCT, ENTRY_DELTA_CARD_FLOOR);
      if (delta > allowed) {
        checks.push({
          name: "entry_count_delta",
          value: delta,
          threshold: allowed,
          prior,
          current: s.totalCount,
        });
      }
    }
    return {
      detectedCharacter: s.detectedCharacter,
      passed: checks.length === 0,
      checks,
    };
  });

  const currentCharacters = sections
    .map((s) => s.detectedCharacter)
    .filter((c): c is string => c != null);
  const coveragePassed = ctx.priorCharacters.every((c) =>
    currentCharacters.includes(c),
  );

  return {
    perSection,
    sourceLevel: {
      coverage: {
        priorCharacters: ctx.priorCharacters,
        currentCharacters,
        passed: coveragePassed,
      },
    },
  };
}
