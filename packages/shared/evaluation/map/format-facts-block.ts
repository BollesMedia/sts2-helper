import type { RunState } from "./run-state";
import type { EnrichedPath } from "./enrich-paths";

function pathNodeToken(type: string, floor: number, nodeId?: string): string {
  const short: Record<string, string> = {
    monster: "M",
    elite: "E",
    rest: "R",
    shop: "S",
    treasure: "T",
    event: "?",
    boss: "BOSS",
    unknown: "U",
  };
  const letter = type === "boss" ? "BOSS" : (short[type] ?? "?");
  // Prefer the `@col,row` form so the LLM can copy node_id verbatim into
  // macro_path.floors[].node_id. Fall back to `(f23)` when nodeId is missing
  // (older fixtures / non-map call sites).
  if (nodeId) return type === "boss" ? `BOSS@${nodeId}` : `${letter}@${nodeId}`;
  return type === "boss" ? "BOSS" : `${letter}(f${floor})`;
}

function describePatterns(path: EnrichedPath): string {
  if (path.patterns.length === 0) return "(no patterns)";
  return path.patterns
    .map((p) => {
      switch (p.kind) {
        case "rest_before_elite":
          return `rest_before_elite(f${p.restFloor}\u2192f${p.eliteFloor})`;
        case "rest_after_elite":
          return `rest_after_elite(f${p.eliteFloor}\u2192f${p.restFloor})`;
        case "elite_cluster":
          return `elite_cluster(${p.floors.join(",")})`;
        case "back_to_back_shops":
          return `back_to_back_shops(${p.floors.join(",")})`;
        case "treasure_before_rest":
          return `treasure_before_rest(f${p.treasureFloor}\u2192f${p.restFloor})`;
        case "monster_chain_for_rewards":
          return `monster_chain(${p.floors.join(",")},len=${p.length})`;
        case "no_rest_in_late_half":
          return `no_rest_in_late_half(elitesLate=${p.elitesLate})`;
        case "heal_vs_smith_at_preboss":
          return `heal_vs_smith_at_preboss=${p.recommendation}`;
        case "rest_spent_too_early":
          return `rest_spent_too_early(f${p.restFloor},hpRatio=${p.hpRatioAtRest.toFixed(2)})`;
        default: {
          const _exhaustive: never = p;
          return _exhaustive;
        }
      }
    })
    .join(", ");
}

export function formatFactsBlock(runState: RunState, paths: EnrichedPath[]): string {
  const [eliteMin, eliteMax] = runState.eliteBudget.actTarget;
  const hpRatio = Math.round(runState.hp.ratio * 100);
  const lines: string[] = [
    "=== RUN STATE ===",
    `HP: ${runState.hp.current}/${runState.hp.max} (${hpRatio}%)`,
    `Gold: ${runState.gold}`,
    `Act ${runState.act}, Floor ${runState.floor} \u2014 ${runState.floorsRemainingInAct} floors to act boss (pre-boss rest at floor ${runState.bossPreview.preBossRestFloor})`,
    `Ascension: ${runState.ascension}`,
    `Deck: ${runState.deck.size} cards, ${Math.round(runState.deck.avgUpgradeRatio * runState.deck.size)} upgraded, ${runState.deck.removalCandidates} removal candidates`,
    "",
    `Risk capacity: ${runState.riskCapacity.verdict.toUpperCase()}`,
    `  HP buffer ${runState.riskCapacity.hpBufferAbsolute} | expected damage/fight \u2248 ${runState.riskCapacity.expectedDamagePerFight} | ~${runState.riskCapacity.fightsBeforeDanger} fights of slack`,
    `Elite budget: Act ${runState.act} target ${eliteMin}\u2013${eliteMax} | fought ${runState.eliteBudget.eliteFloorsFought.length}${runState.eliteBudget.eliteFloorsFought.length ? ` (${runState.eliteBudget.eliteFloorsFought.map((f) => `f${f}`).join(",")})` : ""} | remaining ${runState.eliteBudget.remaining} | should-seek: ${runState.eliteBudget.shouldSeek}`,
    `Gold math: removal affordable (${runState.goldMath.removalAffordable ? "yes" : "no"}) | ${runState.goldMath.shopVisitsAhead} shops ahead | projected budget ${runState.goldMath.projectedShopBudget}`,
    `Monster pool: ${runState.monsterPool.currentPool.toUpperCase()}${runState.monsterPool.fightsUntilHardPool ? ` (${runState.monsterPool.fightsUntilHardPool} fights until hard pool)` : ""}`,
    `Pre-boss rest (f${runState.bossPreview.preBossRestFloor}): projected HP entering \u2248 ${runState.bossPreview.hpEnteringPreBossRest} | recommendation: ${runState.bossPreview.preBossRestRecommendation.toUpperCase()}`,
  ];

  if (runState.bossPreview.candidates.length > 0) {
    lines.push(
      `Boss preview: candidates ${runState.bossPreview.candidates.join(", ")}${
        runState.bossPreview.dangerousMatchups.length
          ? ` | dangerous matchups: ${runState.bossPreview.dangerousMatchups.join(", ")}`
          : ""
      }`,
    );
  }

  lines.push("", "=== CANDIDATE PATHS ===");
  paths.forEach((p, i) => {
    const sequence = p.nodes.map((n) => pathNodeToken(n.type, n.floor, n.nodeId)).join(" \u2192 ");
    lines.push(`Path ${i + 1}: ${sequence}`);
    lines.push(`  Patterns: ${describePatterns(p)}`);
    const fightBudgetLabel = p.aggregates.fightBudgetStatus.toUpperCase();
    const hpRiskLabel = p.aggregates.hpProjectionVerdict.toUpperCase();
    lines.push(
      `  Aggregate: ${p.aggregates.totalFights} fights (${p.aggregates.monstersTaken}M+${p.aggregates.elitesTaken}E) | ${p.aggregates.restsTaken} rests | ${p.aggregates.shopsTaken} shops | fightBudget: ${fightBudgetLabel} | HP_risk: ${hpRiskLabel} | HP_proj_pre_boss_rest \u2248 ${p.aggregates.projectedHpEnteringPreBossRest}`,
    );
  });

  return lines.join("\n");
}
