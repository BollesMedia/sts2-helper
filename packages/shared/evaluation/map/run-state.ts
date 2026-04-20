/**
 * Pure deterministic computation of run state facts that feed the map
 * coaching prompt. No IO. Inputs are a snapshot of player + map state
 * (shape already passed to /api/evaluate map branch).
 */

export type RiskVerdict = "abundant" | "moderate" | "tight" | "critical";

export interface RunState {
  hp: { current: number; max: number; ratio: number };
  gold: number;
  act: 1 | 2 | 3;
  floor: number;
  floorsRemainingInAct: number;
  ascension: number;
  deck: {
    size: number;
    archetype: string | null; // phase 1: always null
    avgUpgradeRatio: number;
    removalCandidates: number;
  };
  relics: { combatRelevant: string[]; pathAffecting: string[] };
  riskCapacity: {
    hpBufferAbsolute: number;
    expectedDamagePerFight: number;
    fightsBeforeDanger: number;
    verdict: RiskVerdict;
  };
  eliteBudget: {
    actTarget: [min: number, max: number];
    eliteFloorsFought: number[];
    remaining: number;
    shouldSeek: boolean;
  };
  goldMath: {
    current: number;
    removalAffordable: boolean;
    shopVisitsAhead: number;
    projectedShopBudget: number;
  };
  monsterPool: {
    currentPool: "easy" | "hard";
    fightsUntilHardPool: number;
  };
  bossPreview: {
    candidates: string[];
    dangerousMatchups: string[];
    preBossRestFloor: number;
    hpEnteringPreBossRest: number;
    preBossRestRecommendation: "heal" | "smith" | "close_call";
  };
}

export interface RunStateInputs {
  player: { hp: number; max_hp: number; gold: number };
  act: 1 | 2 | 3;
  floor: number;
  ascension: number;
  deck: { cards: { id: string; upgraded?: boolean; name: string }[] };
  relics: { id: string; name: string }[];
  map: {
    boss: { row: number };
    current_position?: { row: number } | null;
    visited: { col: number; row: number; type: string }[];
    future: { col: number; row: number; type: string }[]; // nodes with row > current row
  };
  /** Per-remaining-floor shops; used for gold math projection. */
  shopFloorsAhead?: number[];
  /** Context from run history / character strategy for boss preview. */
  bossPreview?: { candidates: string[]; dangerousMatchups: string[] };
  /** Removal cost injected from settings cache. */
  cardRemovalCost: number | null;
}

/**
 * Expected damage per fight is a rough lookup: ascension × deck-size bucket.
 * Tuned against community pool observations; a one-file change to adjust.
 */
function expectedDamage(ascension: number, deckSize: number): number {
  const base = 8 + Math.max(0, ascension) * 0.8;       // Asc 10 ≈ 16
  const deckBloatPenalty = Math.max(0, deckSize - 18) * 0.4;
  return Math.round(base + deckBloatPenalty);
}

export function computeHpBudget(
  player: { hp: number; max_hp: number },
  ascension: number,
  deckSize: number,
): RunState["riskCapacity"] {
  const expectedDamagePerFight = expectedDamage(ascension, deckSize);
  // Danger threshold: HP below expected damage × 1.5 means one bad fight ends the run.
  const dangerFloor = Math.max(1, Math.round(expectedDamagePerFight * 1.5));
  const hpBufferAbsolute = Math.max(0, player.hp - dangerFloor);
  const fightsBeforeDanger = Math.floor(hpBufferAbsolute / Math.max(1, expectedDamagePerFight));

  // Verdict thresholds diverge from the original phase-1 spec on purpose.
  // Spec said abundant ≥ 4 and moderate 2–4; shipped thresholds are one step
  // lower because the formula's `expectedDamagePerFight` + deckBloatPenalty
  // made realistic inputs (healthy HP, mid-ascension, mid-sized deck) never
  // reach the spec's "abundant" tier — the phase-1 plan's own test case
  // hp=75/80, asc 10, deck 15 expected "abundant" but the spec thresholds
  // produced "moderate." See issue #81 for the full reconciliation history.
  // If the damage formula is retuned, revisit these thresholds so tier
  // names match the expectedDamagePerFight reality.
  let verdict: RiskVerdict;
  if (fightsBeforeDanger >= 3) verdict = "abundant";
  else if (fightsBeforeDanger >= 2) verdict = "moderate";
  else if (fightsBeforeDanger >= 1) verdict = "tight";
  else verdict = "critical";

  return { hpBufferAbsolute, expectedDamagePerFight, fightsBeforeDanger, verdict };
}

// Elite targets — 2 per act is the FLOOR, not a ceiling. Elites drop
// run-defining relics, better card rewards, and potions. At Ascension 10
// (the current STS2 EA cap) the "Double Boss" modifier forces back-to-back
// Act 3 bosses, so relic density is the primary differentiator between
// winning and losing runs. Keep seeking elites as long as HP_risk and
// fight budget allow — the scaffold's priority rules handle the safety
// side.
const ELITE_TARGETS: Record<1 | 2 | 3, [number, number]> = {
  1: [2, 3],
  2: [2, 3],
  3: [2, 3],
};

export function computeEliteBudget(
  act: 1 | 2 | 3,
  visited: { floor: number; type: string }[],
): RunState["eliteBudget"] {
  const target = ELITE_TARGETS[act];
  const eliteFloorsFought = visited.filter((v) => v.type === "Elite").map((v) => v.floor);
  const remaining = Math.max(0, target[1] - eliteFloorsFought.length);
  const shouldSeek = eliteFloorsFought.length < target[1];
  return { actTarget: target, eliteFloorsFought, remaining, shouldSeek };
}

/**
 * Projected budget = current + expected gold drops between now and last shop.
 * Rough estimate: ~35g per fight before hard pool, ~50g after.
 */
export function computeGoldMath(
  player: { gold: number },
  removalCost: number | null,
  shopFloorsAhead: number[],
): RunState["goldMath"] {
  const shopVisitsAhead = shopFloorsAhead.length;
  const expectedDropsPerFight = 40;
  // Assume ~3 fights earn gold between each pair of upcoming shops, capped
  // at 4 to avoid projecting gold you might never collect.
  const expectedFightsBeforeLastShop = Math.min(4, shopVisitsAhead * 3);
  const projectedShopBudget =
    player.gold + expectedDropsPerFight * expectedFightsBeforeLastShop;
  const removalAffordable = removalCost !== null && player.gold >= removalCost;
  return {
    current: player.gold,
    removalAffordable,
    shopVisitsAhead,
    projectedShopBudget,
  };
}

export function computeMonsterPool(
  act: 1 | 2 | 3,
  visited: { floor: number; type: string }[],
): RunState["monsterPool"] {
  const easyPoolSize = act === 1 ? 3 : 2;
  const monsterFightsDone = visited.filter((v) => v.type === "Monster").length;
  if (monsterFightsDone >= easyPoolSize) {
    return { currentPool: "hard", fightsUntilHardPool: 0 };
  }
  return { currentPool: "easy", fightsUntilHardPool: easyPoolSize - monsterFightsDone };
}

export function computePreBossRest(args: {
  bossRow: number;
  currentHp: number;
  maxHp: number;
  expectedDamagePerFight: number;
  fightsOnExpectedPath: number;
  upgradeCandidates: number;
}): Pick<
  RunState["bossPreview"],
  "preBossRestFloor" | "hpEnteringPreBossRest" | "preBossRestRecommendation"
> {
  const preBossRestFloor = args.bossRow - 1;
  const hpEnteringPreBossRest = Math.max(
    0,
    args.currentHp - args.expectedDamagePerFight * args.fightsOnExpectedPath,
  );
  const ratio = hpEnteringPreBossRest / Math.max(1, args.maxHp);

  let preBossRestRecommendation: "heal" | "smith" | "close_call";
  if (args.upgradeCandidates === 0 || ratio < 0.65) {
    preBossRestRecommendation = "heal";
  } else if (ratio >= 0.7) {
    preBossRestRecommendation = "smith";
  } else {
    preBossRestRecommendation = "close_call";
  }

  return { preBossRestFloor, hpEnteringPreBossRest, preBossRestRecommendation };
}

export function computeRunState(inputs: RunStateInputs): RunState {
  const deckSize = inputs.deck.cards.length;
  const visitedTyped = inputs.map.visited.map((v) => ({ floor: v.row, type: v.type }));

  const hp = {
    current: inputs.player.hp,
    max: inputs.player.max_hp,
    ratio: inputs.player.hp / Math.max(1, inputs.player.max_hp),
  };

  const riskCapacity = computeHpBudget(
    { hp: inputs.player.hp, max_hp: inputs.player.max_hp },
    inputs.ascension,
    deckSize,
  );

  const eliteBudget = computeEliteBudget(inputs.act, visitedTyped);
  const goldMath = computeGoldMath(
    { gold: inputs.player.gold },
    inputs.cardRemovalCost,
    inputs.shopFloorsAhead ?? [],
  );
  const monsterPool = computeMonsterPool(inputs.act, visitedTyped);

  const floorsRemainingInAct = inputs.map.boss.row - inputs.floor;
  const fightsOnExpectedPath = inputs.map.future.filter(
    (n) => n.type === "Monster" || n.type === "Elite",
  ).length;

  const removalCandidates = inputs.deck.cards.filter(
    (c) => c.id === "strike" || c.id === "defend",
  ).length;

  const upgradedCount = inputs.deck.cards.filter((c) => c.upgraded).length;

  const preBossRest = computePreBossRest({
    bossRow: inputs.map.boss.row,
    currentHp: inputs.player.hp,
    maxHp: inputs.player.max_hp,
    expectedDamagePerFight: riskCapacity.expectedDamagePerFight,
    fightsOnExpectedPath,
    upgradeCandidates: inputs.deck.cards.filter((c) => !c.upgraded).length,
  });

  return {
    hp,
    gold: inputs.player.gold,
    act: inputs.act,
    floor: inputs.floor,
    floorsRemainingInAct,
    ascension: inputs.ascension,
    deck: {
      size: deckSize,
      archetype: null,
      avgUpgradeRatio: upgradedCount / Math.max(1, deckSize),
      removalCandidates,
    },
    relics: {
      combatRelevant: inputs.relics.map((r) => r.id),
      pathAffecting: [], // phase 1: not categorized — LLM sees full relic list
    },
    riskCapacity,
    eliteBudget,
    goldMath,
    monsterPool,
    bossPreview: {
      candidates: inputs.bossPreview?.candidates ?? [],
      dangerousMatchups: inputs.bossPreview?.dangerousMatchups ?? [],
      ...preBossRest,
    },
  };
}
