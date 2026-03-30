import type { EvaluationContext } from "./types";

const STORAGE_KEY = "sts2-run-narrative";
const MAX_DECISIONS = 8;
const MAX_MILESTONES = 15;
const SUMMARY_UPDATE_INTERVAL = 3;

// --- Types ---

export type DecisionType =
  | "card_reward"
  | "shop"
  | "shop_removal"
  | "rest_site"
  | "event"
  | "map"
  | "boss_relic";

export interface RunDecision {
  floor: number;
  type: DecisionType;
  chosen: string | null;
  advise: string | null;
  aligned: boolean;
}

export type BuildPhase = "exploring" | "committing" | "committed";
export type HpTrend = "declining" | "stable" | "recovering";

interface MilestoneEntry {
  text: string;
  permanent: boolean;
}

export interface RunNarrative {
  runId: string;
  character: string;
  ascension: number;
  strategySummary: string;
  winCondition: string;
  deckWeaknesses: string[];
  buildPhase: BuildPhase;
  hpTrend: HpTrend;
  strikeDefendCount: { strikes: number; defends: number };
  removalCount: number;
  decisions: RunDecision[];
  milestones: MilestoneEntry[];
  /** Tracks HP values for trend detection */
  hpHistory: number[];
  /** Counter for triggering summary updates */
  decisionsSinceSummaryUpdate: number;
}

// --- Store ---

let narrative: RunNarrative | null = null;

export function initializeNarrative(
  runId: string,
  character: string,
  ascension: number
) {
  narrative = {
    runId,
    character,
    ascension,
    strategySummary: "",
    winCondition: "",
    deckWeaknesses: [],
    buildPhase: "exploring",
    hpTrend: "stable",
    strikeDefendCount: { strikes: 4, defends: 4 },
    removalCount: 0,
    decisions: [],
    milestones: [],
    hpHistory: [],
    decisionsSinceSummaryUpdate: 0,
  };
  save();
}

export function getNarrative(): RunNarrative | null {
  if (!narrative) {
    load();
  }
  return narrative;
}

export function clearNarrative() {
  narrative = null;
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

export function appendDecision(decision: RunDecision) {
  if (!narrative) return;

  narrative.decisions.push(decision);

  // Rolling window: drop oldest non-skip decisions first, then oldest overall
  if (narrative.decisions.length > MAX_DECISIONS) {
    narrative.decisions = narrative.decisions.slice(-MAX_DECISIONS);
  }

  // Track removals
  if (decision.type === "shop_removal") {
    narrative.removalCount++;
  }

  narrative.decisionsSinceSummaryUpdate++;
  save();
}

export function addMilestone(text: string, permanent: boolean) {
  if (!narrative) return;

  narrative.milestones.push({ text, permanent });

  // Enforce cap with tiered eviction
  if (narrative.milestones.length > MAX_MILESTONES) {
    const tacticalIdx = narrative.milestones.findIndex((m) => !m.permanent);
    if (tacticalIdx !== -1) {
      narrative.milestones.splice(tacticalIdx, 1);
    } else {
      // All permanent — drop oldest
      narrative.milestones.shift();
    }
  }

  save();
}

/**
 * Update the strategy summary and derived fields from current game state.
 * Call after every few decisions to keep the narrative current.
 */
export function updateFromContext(ctx: EvaluationContext) {
  if (!narrative) return;
  if (
    narrative.decisionsSinceSummaryUpdate < SUMMARY_UPDATE_INTERVAL &&
    narrative.strategySummary !== ""
  ) {
    // Also update lightweight fields every time
    updateStrikeDefendCount(ctx);
    updateHpTrend(ctx.hpPercent);
    save();
    return;
  }

  narrative.decisionsSinceSummaryUpdate = 0;

  updateBuildPhase(ctx);
  updateDeckWeaknesses(ctx);
  updateWinCondition(ctx);
  updateStrategySummary(ctx);
  updateStrikeDefendCount(ctx);
  updateHpTrend(ctx.hpPercent);

  save();
}

/**
 * Get formatted prompt context string for inclusion in API calls.
 * Returns null if not enough decisions to be useful.
 */
export function getPromptContext(): string | null {
  if (!narrative || narrative.decisions.length < 2) {
    return null;
  }

  const lines: string[] = ["=== RUN NARRATIVE ==="];

  // Build direction
  const archLabel =
    narrative.strategySummary || `${narrative.character} run (exploring)`;
  lines.push(`Build: ${archLabel} [${narrative.buildPhase}]`);

  // Win condition
  if (narrative.winCondition) {
    lines.push(`Win condition: ${narrative.winCondition}`);
  }

  // Weaknesses
  if (narrative.deckWeaknesses.length > 0) {
    lines.push(`Weaknesses: ${narrative.deckWeaknesses.join(", ")}`);
  }

  // Deck stats
  const sd = narrative.strikeDefendCount;
  lines.push(
    `Deck stats: ${sd.strikes} Strikes, ${sd.defends} Defends. ` +
      `${narrative.removalCount} removals. HP trend: ${narrative.hpTrend}.`
  );

  // Alignment
  const aligned = narrative.decisions.filter((d) => d.aligned).length;
  const total = narrative.decisions.filter(
    (d) => d.advise !== null
  ).length;
  if (total > 0) {
    lines.push(`Advice alignment: ${aligned}/${total} aligned`);
  }

  // Recent decisions
  lines.push("");
  lines.push(`Recent (last ${narrative.decisions.length}):`);
  for (const d of narrative.decisions) {
    let line = `F${d.floor} ${d.type}: `;
    if (d.chosen) {
      line += `Took ${d.chosen}`;
    } else {
      line += "Skipped";
    }
    if (d.advise !== null) {
      if (d.aligned) {
        line += " [aligned]";
      } else {
        line += ` [diverged: advised ${d.advise}]`;
      }
    }
    lines.push(line);
  }

  // Milestones
  if (narrative.milestones.length > 0) {
    lines.push("");
    lines.push(
      `Milestones: ${narrative.milestones.map((m) => m.text).join(", ")}`
    );
  }

  return lines.join("\n");
}

// --- Private helpers ---

function updateBuildPhase(ctx: EvaluationContext) {
  if (!narrative) return;

  const primary = ctx.archetypes[0];
  if (!primary || primary.confidence < 40) {
    narrative.buildPhase = "exploring";
  } else if (primary.confidence >= 70) {
    narrative.buildPhase = "committed";
  } else {
    narrative.buildPhase = "committing";
  }
}

function updateDeckWeaknesses(ctx: EvaluationContext) {
  if (!narrative) return;

  const weaknesses: string[] = [];

  // AoE check: look for multi-target indicators in descriptions
  const hasAoE = ctx.deckCards.some((c) => {
    const desc = c.description.toLowerCase();
    return (
      desc.includes("all enemies") ||
      desc.includes("all enemy") ||
      desc.includes("aoe") ||
      desc.includes("each enemy")
    );
  });
  if (!hasAoE) weaknesses.push("needs AoE");

  // Scaling check
  if (!ctx.hasScaling) weaknesses.push("no scaling");

  // Draw check (use pre-computed from context)
  if (ctx.drawSources.length < 2) weaknesses.push("low card draw");

  // Energy check: avg cost vs available energy
  const costs = ctx.deckCards
    .map((c) => {
      const match = c.description.match(/Cost:\s*(\d+)/i);
      return match ? parseInt(match[1], 10) : 1;
    })
    .filter((c) => c > 0);
  const avgCost = costs.length > 0
    ? costs.reduce((a, b) => a + b, 0) / costs.length
    : 1;
  if (avgCost > ctx.energy * 0.6) weaknesses.push("energy-tight");

  // Bloat check
  const sd = narrative.strikeDefendCount;
  const bloatRatio = (sd.strikes + sd.defends) / Math.max(1, ctx.deckSize);
  if (bloatRatio > 0.4 && ctx.deckSize > 10) {
    weaknesses.push("Strike/Defend bloat");
  }

  narrative.deckWeaknesses = weaknesses;
}

function updateWinCondition(ctx: EvaluationContext) {
  if (!narrative) return;

  const primary = ctx.archetypes[0];
  if (!primary || primary.confidence < 30) {
    narrative.winCondition = "";
    return;
  }

  const keyCards = ctx.scalingSources.slice(0, 3);

  if (keyCards.length === 0) {
    narrative.winCondition = `${primary.archetype} build (key cards not yet identified)`;
    return;
  }

  narrative.winCondition = `${primary.archetype} via ${keyCards.join(" + ")}`;
}

function updateStrategySummary(ctx: EvaluationContext) {
  if (!narrative) return;

  const archetypes = ctx.archetypes.slice(0, 2);
  const archStr = archetypes.length > 0
    ? archetypes.map((a) => a.archetype).join("/")
    : "undecided";

  const picks = narrative.decisions.filter((d) => d.chosen !== null);
  const skips = narrative.decisions.filter((d) => d.chosen === null);
  const diverged = narrative.decisions.filter(
    (d) => d.advise !== null && !d.aligned
  );

  let summary = `${archStr} (${ctx.deckSize} cards)`;

  if (picks.length > 0 || skips.length > 0) {
    summary += `. ${picks.length} picked, ${skips.length} skipped`;
  }

  if (diverged.length >= 3) {
    summary += ". Player often diverges from recommendations";
  }

  narrative.strategySummary = summary;
}

function updateStrikeDefendCount(ctx: EvaluationContext) {
  if (!narrative) return;

  const strikes = ctx.deckCards.filter((c) =>
    c.name.toLowerCase().startsWith("strike")
  ).length;
  const defends = ctx.deckCards.filter((c) =>
    c.name.toLowerCase().startsWith("defend")
  ).length;

  narrative.strikeDefendCount = { strikes, defends };
}

function updateHpTrend(hpPercent: number) {
  if (!narrative) return;

  narrative.hpHistory.push(hpPercent);

  // Keep last 5 data points
  if (narrative.hpHistory.length > 5) {
    narrative.hpHistory = narrative.hpHistory.slice(-5);
  }

  if (narrative.hpHistory.length < 2) {
    narrative.hpTrend = "stable";
    return;
  }

  const recent = narrative.hpHistory.slice(-3);
  const trend = recent[recent.length - 1] - recent[0];

  if (trend < -0.15) {
    narrative.hpTrend = "declining";
  } else if (trend > 0.15) {
    narrative.hpTrend = "recovering";
  } else {
    narrative.hpTrend = "stable";
  }
}

function save() {
  if (!narrative || typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(narrative));
  } catch {
    // localStorage full or unavailable
  }
}

function load() {
  if (typeof window === "undefined") return;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      narrative = JSON.parse(stored);
    }
  } catch {
    // corrupt data
  }
}
