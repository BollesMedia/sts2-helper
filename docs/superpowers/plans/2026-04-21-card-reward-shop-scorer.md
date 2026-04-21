# Card Reward + Shop Scorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the LLM picker for `card_reward` and `shop` evals with a pure-TS modifier-stack scorer. All coaching text becomes templated from scorer output + a fixed catalog. Zero LLM calls for these two eval types.

**Architecture:** Same pattern Phase 4 validated. Scorer ranks offered items by adjusted community tier, applying modifiers (archetype fit, deck gap, duplicate, win-rate delta, act timing, keystone override). Skip threshold per act. Templated headline / pickSummary / keyTradeoffs / teachingCallouts. Shop non-cards get a separate deterministic ranker. No narrator.

**Tech Stack:** TypeScript (strict), Vitest, Zod, Next.js App Router. All scorer logic lives in `packages/shared/evaluation/card-reward/` and `packages/shared/evaluation/shop/`; only the route handler imports from `apps/web`.

**Spec:** GitHub issue [#105](https://github.com/BollesMedia/sts2-helper/issues/105)

---

## Conventions

- **Working directory:** `/Users/drewbolles/Sites/_bollesmedia/sts2-helper/.worktrees/feat/105-card-reward-scorer`
- **Branch:** `feat/105-card-reward-scorer`
- **Tests:** Shared-package tests are discovered by `apps/web/vitest.config.ts`. Run with `pnpm --filter @sts2/web test -- <name>`.
- **Typecheck:** `pnpm --filter @sts2/web build` (Next.js runs `tsc` transitively).
- **Commits:** Conventional, lowercase imperative. One per task.

## File Structure

### New files

- `packages/shared/evaluation/card-reward/modifier-stack.ts` — pure modifier math. Inputs: `TaggedOffer`, `DeckState`, `CommunityTierSignal | null`, `WinRateRow | null`, run context. Output: `ModifierBreakdown`.
- `packages/shared/evaluation/card-reward/modifier-stack.test.ts`
- `packages/shared/evaluation/card-reward/skip-threshold.ts` — per-act skip decision from ranked offers.
- `packages/shared/evaluation/card-reward/skip-threshold.test.ts`
- `packages/shared/evaluation/card-reward/score-offers.ts` — orchestrator. Runs enrichment → modifiers → ranking → skip decision.
- `packages/shared/evaluation/card-reward/score-offers.test.ts`
- `packages/shared/evaluation/card-reward/coaching-catalog.ts` — `Record<CatalogKind, { teaching, tradeoffUpside, tradeoffDownside }>`.
- `packages/shared/evaluation/card-reward/coaching-catalog.test.ts`
- `packages/shared/evaluation/card-reward/build-coaching.ts` — templated `headline` / `pickSummary` / `keyTradeoffs` / `teachingCallouts` from scorer output.
- `packages/shared/evaluation/card-reward/build-coaching.test.ts`
- `packages/shared/evaluation/shop/score-non-cards.ts` — deterministic priority ranker for removals / relics / potions.
- `packages/shared/evaluation/shop/score-non-cards.test.ts`

### Modified files

- `apps/web/src/app/api/evaluate/route.ts` — `card_reward` and `shop` branches: drop `generateText`, call scorer + templater, return `CardRewardEvaluation`.
- `packages/shared/evaluation/prompt-builder.ts` — drop `CARD_REWARD_SCAFFOLD`, drop `card_reward` and `shop` entries in `TYPE_ADDENDA`.
- `packages/shared/evaluation/post-eval-weights.ts` — delete `applyCardRewardWeights`, `applyShopWeights`, and the `card_reward` / `shop` branches in `applyPostEvalWeights`. Keep `adjustTier`, `buildWeightContext`, `reconcileSkipRecommended`, and all rest-site helpers — they are still used by non-map eval paths.

### Unchanged (reference only)

- `packages/shared/evaluation/card-reward/deck-state.ts`
- `packages/shared/evaluation/card-reward/card-tags.ts`
- `packages/shared/evaluation/card-reward/format-card-facts.ts` — facts block stays; future debug surfaces may use it.
- `packages/shared/evaluation/community-tier.ts`
- `packages/shared/evaluation/archetype-detector.ts`
- `packages/shared/evaluation/tier-utils.ts`
- `packages/shared/evaluation/types.ts` — `CardEvaluation` / `CardRewardEvaluation` wire shape unchanged.

---

## Task 1: Scaffold `modifier-stack.ts` with constants, types, empty `computeModifiers`

**Files:**
- Create: `packages/shared/evaluation/card-reward/modifier-stack.ts`
- Create: `packages/shared/evaluation/card-reward/modifier-stack.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/evaluation/card-reward/modifier-stack.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  computeModifiers,
  MODIFIER_DELTAS,
  WIN_RATE_MIN_N,
  WIN_RATE_DELTA_THRESHOLD,
} from "./modifier-stack";
import type { DeckState } from "./deck-state";
import type { TaggedOffer } from "./format-card-facts";

function emptyDeckState(overrides: Partial<DeckState> = {}): DeckState {
  return {
    size: 10,
    act: 1,
    floor: 3,
    ascension: 10,
    composition: { strikes: 4, defends: 4, deadCards: 8, upgraded: 0, upgradeRatio: 0 },
    sizeVerdict: "too_thin",
    archetypes: { viable: [], committed: null, orphaned: [] },
    engine: { hasScaling: false, hasBlockPayoff: false, hasRemovalMomentum: 0, hasDrawPower: false },
    hp: { current: 70, max: 80, ratio: 0.875 },
    upcoming: { nextNodeType: null, bossesPossible: [], dangerousMatchups: [] },
    ...overrides,
  };
}

function offer(overrides: Partial<TaggedOffer> = {}): TaggedOffer {
  return {
    index: 1,
    name: "Test Card",
    rarity: "common",
    type: "Attack",
    cost: 1,
    description: "Deal 8 damage.",
    tags: {
      role: "damage",
      keystoneFor: null,
      fitsArchetypes: [],
      deadWithCurrentDeck: false,
      duplicatePenalty: false,
      upgradeLevel: 0,
    },
    ...overrides,
  };
}

describe("modifier-stack constants", () => {
  it("exports the documented modifier deltas", () => {
    expect(MODIFIER_DELTAS.archetypeFitOn).toBe(1);
    expect(MODIFIER_DELTAS.archetypeFitOff).toBe(-1);
    expect(MODIFIER_DELTAS.archetypeFitKeystone).toBe(2);
    expect(MODIFIER_DELTAS.deckGapFilled).toBe(1);
    expect(MODIFIER_DELTAS.duplicateNonCore).toBe(-1);
    expect(MODIFIER_DELTAS.winRatePickStrong).toBe(1);
    expect(MODIFIER_DELTAS.winRateSkipStrong).toBe(-1);
    expect(MODIFIER_DELTAS.actThreeOffArchetype).toBe(-1);
  });

  it("exports win-rate thresholds", () => {
    expect(WIN_RATE_MIN_N).toBe(20);
    expect(WIN_RATE_DELTA_THRESHOLD).toBe(0.15);
  });
});

describe("computeModifiers — smoke", () => {
  it("returns a breakdown with base tier C when no community tier signal is provided", () => {
    const result = computeModifiers({
      offer: offer(),
      deckState: emptyDeckState(),
      communityTier: null,
      winRate: null,
    });
    expect(result.baseTier).toBe("C");
    expect(result.adjustedTier).toBeDefined();
    expect(Array.isArray(result.modifiers)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sts2/web test -- modifier-stack`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the scaffold**

Create `packages/shared/evaluation/card-reward/modifier-stack.ts`:

```ts
import type { DeckState } from "./deck-state";
import type { TaggedOffer } from "./format-card-facts";
import type { CommunityTierSignal } from "../community-tier";
import type { TierLetter } from "../tier-utils";
import { tierToValue, valueToTier } from "../tier-utils";

export const MODIFIER_DELTAS = {
  archetypeFitOn: 1,
  archetypeFitOff: -1,
  archetypeFitKeystone: 2,
  deckGapFilled: 1,
  duplicateNonCore: -1,
  winRatePickStrong: 1,
  winRateSkipStrong: -1,
  actThreeOffArchetype: -1,
} as const;

export const WIN_RATE_MIN_N = 20;
export const WIN_RATE_DELTA_THRESHOLD = 0.15;

export type ModifierKind =
  | "archetypeFit"
  | "deckGap"
  | "duplicate"
  | "winRateDelta"
  | "actTiming"
  | "keystoneOverride";

export interface Modifier {
  kind: ModifierKind;
  delta: number;
  reason: string;
}

export interface WinRateInput {
  pickWinRate: number | null;
  skipWinRate: number | null;
  timesPicked: number;
  timesSkipped: number;
}

export interface ModifierBreakdown {
  baseTier: TierLetter;
  modifiers: Modifier[];
  adjustedTier: TierLetter;
  tierValue: number;
  topReason: string;
}

export interface ComputeModifiersInput {
  offer: TaggedOffer;
  deckState: DeckState;
  communityTier: CommunityTierSignal | null;
  winRate: WinRateInput | null;
}

export function computeModifiers(input: ComputeModifiersInput): ModifierBreakdown {
  const baseTier: TierLetter = input.communityTier?.consensusTierLetter ?? "C";
  const baseValue = tierToValue(baseTier);
  // Real logic lands in Tasks 2–3.
  return {
    baseTier,
    modifiers: [],
    adjustedTier: baseTier,
    tierValue: baseValue,
    topReason: "base tier",
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sts2/web test -- modifier-stack`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/evaluation/card-reward/modifier-stack.ts packages/shared/evaluation/card-reward/modifier-stack.test.ts
git commit -m "feat(card-reward): scaffold modifier-stack with constants and types"
```

---

## Task 2: Implement archetype-fit + duplicate + deck-gap modifiers

**Files:**
- Modify: `packages/shared/evaluation/card-reward/modifier-stack.ts`
- Modify: `packages/shared/evaluation/card-reward/modifier-stack.test.ts`

Three modifiers rely only on `offer.tags` + `deckState`:

- **Archetype fit:**
  - Keystone for committed archetype → `+2` delta, reason `"keystone for {archetype}"`.
  - Keystone for any viable (non-committed) archetype → `+2` delta if deck is uncommitted, reason `"keystone unlocks {archetype}"`.
  - `fitsArchetypes` includes `deckState.archetypes.committed` → `+1`, reason `"on-archetype for {archetype}"`.
  - `deckState.archetypes.committed !== null` and offer does NOT fit → `-1`, reason `"off-archetype"`.
  - Otherwise → no delta.
- **Duplicate:** `offer.tags.duplicatePenalty === true` → `-1`, reason `"duplicate non-core"`. (The tag already accounts for `maxCopies`.)
- **Deck gap:** Engine-gap coverage. Fire `+1` if ALL of the following:
  - Offer's role matches a detected gap.
  - Deck state confirms the gap is open (not already covered).
  - Gaps considered:
    - role `"block"` and `!deckState.engine.hasBlockPayoff` → reason `"fills block gap"`.
    - role `"scaling"` and `!deckState.engine.hasScaling` → reason `"fills scaling gap"`.
    - role `"draw"` and `!deckState.engine.hasDrawPower` → reason `"fills draw gap"`.
    - role `"removal"` and `deckState.composition.strikes + deckState.composition.defends >= 6` → reason `"deck thin on removal"`.
  - Otherwise no delta.

- [ ] **Step 1: Write the failing tests**

Append to `modifier-stack.test.ts`:

```ts
describe("computeModifiers — archetype fit", () => {
  it("adds +2 and marks keystone for the committed archetype", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "scaling", keystoneFor: "exhaust", fitsArchetypes: ["exhaust"], deadWithCurrentDeck: false, duplicatePenalty: false, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState({
        archetypes: { viable: [{ name: "exhaust", supportCount: 3, hasKeystone: false }], committed: "exhaust", orphaned: [] },
      }),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "archetypeFit");
    expect(mod?.delta).toBe(2);
    expect(mod?.reason).toContain("exhaust");
  });

  it("adds +1 for on-archetype fit without keystone", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "damage", keystoneFor: null, fitsArchetypes: ["exhaust"], deadWithCurrentDeck: false, duplicatePenalty: false, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState({
        archetypes: { viable: [{ name: "exhaust", supportCount: 3, hasKeystone: true }], committed: "exhaust", orphaned: [] },
      }),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "archetypeFit");
    expect(mod?.delta).toBe(1);
  });

  it("subtracts 1 for off-archetype when deck is committed", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "damage", keystoneFor: null, fitsArchetypes: ["poison"], deadWithCurrentDeck: false, duplicatePenalty: false, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState({
        archetypes: { viable: [{ name: "exhaust", supportCount: 3, hasKeystone: true }], committed: "exhaust", orphaned: [] },
      }),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "archetypeFit");
    expect(mod?.delta).toBe(-1);
  });

  it("does not penalize off-archetype when deck is uncommitted", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "damage", keystoneFor: null, fitsArchetypes: ["poison"], deadWithCurrentDeck: false, duplicatePenalty: false, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState(),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "archetypeFit");
    expect(mod).toBeUndefined();
  });

  it("adds +2 keystone bonus when deck is uncommitted and offer unlocks a viable archetype", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "scaling", keystoneFor: "poison", fitsArchetypes: ["poison"], deadWithCurrentDeck: false, duplicatePenalty: false, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState({
        archetypes: { viable: [{ name: "poison", supportCount: 2, hasKeystone: false }], committed: null, orphaned: [] },
      }),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "archetypeFit");
    expect(mod?.delta).toBe(2);
    expect(mod?.reason.toLowerCase()).toContain("poison");
  });
});

describe("computeModifiers — duplicate", () => {
  it("subtracts 1 when duplicatePenalty is set", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "damage", keystoneFor: null, fitsArchetypes: [], deadWithCurrentDeck: false, duplicatePenalty: true, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState(),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "duplicate");
    expect(mod?.delta).toBe(-1);
  });

  it("does not fire when duplicatePenalty is false", () => {
    const result = computeModifiers({
      offer: offer(),
      deckState: emptyDeckState(),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "duplicate");
    expect(mod).toBeUndefined();
  });
});

describe("computeModifiers — deck gap", () => {
  it("adds +1 for block role when deck lacks block payoff", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "block", keystoneFor: null, fitsArchetypes: [], deadWithCurrentDeck: false, duplicatePenalty: false, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState({
        engine: { hasScaling: false, hasBlockPayoff: false, hasRemovalMomentum: 0, hasDrawPower: false },
      }),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "deckGap");
    expect(mod?.delta).toBe(1);
    expect(mod?.reason.toLowerCase()).toContain("block");
  });

  it("does not fire when the gap is already covered", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "block", keystoneFor: null, fitsArchetypes: [], deadWithCurrentDeck: false, duplicatePenalty: false, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState({
        engine: { hasScaling: false, hasBlockPayoff: true, hasRemovalMomentum: 0, hasDrawPower: false },
      }),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "deckGap");
    expect(mod).toBeUndefined();
  });

  it("adds +1 for scaling role when deck lacks scaling", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "scaling", keystoneFor: null, fitsArchetypes: [], deadWithCurrentDeck: false, duplicatePenalty: false, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState({
        engine: { hasScaling: false, hasBlockPayoff: false, hasRemovalMomentum: 0, hasDrawPower: false },
      }),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "deckGap");
    expect(mod?.delta).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sts2/web test -- modifier-stack`
Expected: FAIL — no archetype / duplicate / deck-gap modifiers produced yet.

- [ ] **Step 3: Implement the three modifiers**

Replace the body of `computeModifiers` in `modifier-stack.ts` with helpers + aggregation:

```ts
function archetypeFitModifier(
  offer: TaggedOffer,
  deckState: DeckState,
): Modifier | null {
  const committed = deckState.archetypes.committed;
  const viable = deckState.archetypes.viable;

  // Keystone for committed archetype.
  if (offer.tags.keystoneFor && offer.tags.keystoneFor === committed) {
    return {
      kind: "archetypeFit",
      delta: MODIFIER_DELTAS.archetypeFitKeystone,
      reason: `keystone for ${committed}`,
    };
  }

  // Keystone unlocks a viable archetype when uncommitted.
  if (
    offer.tags.keystoneFor &&
    !committed &&
    viable.some((v) => v.name === offer.tags.keystoneFor)
  ) {
    return {
      kind: "archetypeFit",
      delta: MODIFIER_DELTAS.archetypeFitKeystone,
      reason: `keystone unlocks ${offer.tags.keystoneFor}`,
    };
  }

  // On-archetype for committed deck.
  if (committed && offer.tags.fitsArchetypes.includes(committed)) {
    return {
      kind: "archetypeFit",
      delta: MODIFIER_DELTAS.archetypeFitOn,
      reason: `on-archetype for ${committed}`,
    };
  }

  // Off-archetype for committed deck.
  if (committed && !offer.tags.fitsArchetypes.includes(committed)) {
    return {
      kind: "archetypeFit",
      delta: MODIFIER_DELTAS.archetypeFitOff,
      reason: "off-archetype",
    };
  }

  return null;
}

function duplicateModifier(offer: TaggedOffer): Modifier | null {
  if (!offer.tags.duplicatePenalty) return null;
  return {
    kind: "duplicate",
    delta: MODIFIER_DELTAS.duplicateNonCore,
    reason: "duplicate non-core",
  };
}

function deckGapModifier(
  offer: TaggedOffer,
  deckState: DeckState,
): Modifier | null {
  const role = offer.tags.role;
  const engine = deckState.engine;
  if (role === "block" && !engine.hasBlockPayoff) {
    return { kind: "deckGap", delta: MODIFIER_DELTAS.deckGapFilled, reason: "fills block gap" };
  }
  if (role === "scaling" && !engine.hasScaling) {
    return { kind: "deckGap", delta: MODIFIER_DELTAS.deckGapFilled, reason: "fills scaling gap" };
  }
  if (role === "draw" && !engine.hasDrawPower) {
    return { kind: "deckGap", delta: MODIFIER_DELTAS.deckGapFilled, reason: "fills draw gap" };
  }
  if (role === "removal" && deckState.composition.strikes + deckState.composition.defends >= 6) {
    return { kind: "deckGap", delta: MODIFIER_DELTAS.deckGapFilled, reason: "deck thin on removal" };
  }
  return null;
}

export function computeModifiers(input: ComputeModifiersInput): ModifierBreakdown {
  const baseTier: TierLetter = input.communityTier?.consensusTierLetter ?? "C";
  const baseValue = tierToValue(baseTier);

  const candidates: (Modifier | null)[] = [
    archetypeFitModifier(input.offer, input.deckState),
    duplicateModifier(input.offer),
    deckGapModifier(input.offer, input.deckState),
  ];
  const modifiers = candidates.filter((m): m is Modifier => m !== null);

  const totalDelta = modifiers.reduce((sum, m) => sum + m.delta, 0);
  const adjustedValue = Math.max(1, Math.min(6, baseValue + totalDelta));
  const adjustedTier = valueToTier(adjustedValue);

  // Top reason = largest absolute-value modifier; fall back to "base tier".
  const top = modifiers.reduce<Modifier | null>(
    (best, m) => (best === null || Math.abs(m.delta) > Math.abs(best.delta) ? m : best),
    null,
  );
  const topReason = top?.reason ?? "base tier";

  return { baseTier, modifiers, adjustedTier, tierValue: adjustedValue, topReason };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sts2/web test -- modifier-stack`
Expected: PASS — all new cases + the scaffold smoke test.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/evaluation/card-reward/modifier-stack.ts packages/shared/evaluation/card-reward/modifier-stack.test.ts
git commit -m "feat(card-reward): archetype-fit + duplicate + deck-gap modifiers"
```

---

## Task 3: Implement win-rate + act-timing modifiers + keystone override

**Files:**
- Modify: `packages/shared/evaluation/card-reward/modifier-stack.ts`
- Modify: `packages/shared/evaluation/card-reward/modifier-stack.test.ts`

- **Win-rate delta:**
  - If `pickWinRate > skipWinRate + 0.15` AND `timesPicked >= 20` → `+1`, reason `"pick WR +{delta}%"`.
  - If `skipWinRate > pickWinRate + 0.15` AND `timesSkipped >= 20` → `-1`, reason `"skip WR +{delta}%"`.
- **Act timing:**
  - `deckState.act === 3` AND offer NOT on committed archetype (and a committed archetype exists) → `-1`, reason `"Act 3 off-archetype"`.
- **Keystone override:**
  - Already applied via Task 2's archetype-fit rules (keystone delivers `+2`). No separate override here; the earlier spec discussed a clamp-to-S rule but testing it revealed it dominates too often. Skipping the override: the `+2` keystone bonus already does the work inside the clamp.

- [ ] **Step 1: Write the failing tests**

Append to `modifier-stack.test.ts`:

```ts
describe("computeModifiers — win rate", () => {
  it("adds +1 when pick WR beats skip WR by >15% with n>=20", () => {
    const result = computeModifiers({
      offer: offer(),
      deckState: emptyDeckState(),
      communityTier: null,
      winRate: { pickWinRate: 0.55, skipWinRate: 0.35, timesPicked: 30, timesSkipped: 40 },
    });
    const mod = result.modifiers.find((m) => m.kind === "winRateDelta");
    expect(mod?.delta).toBe(1);
  });

  it("subtracts 1 when skip WR beats pick WR by >15% with n>=20", () => {
    const result = computeModifiers({
      offer: offer(),
      deckState: emptyDeckState(),
      communityTier: null,
      winRate: { pickWinRate: 0.30, skipWinRate: 0.55, timesPicked: 40, timesSkipped: 30 },
    });
    const mod = result.modifiers.find((m) => m.kind === "winRateDelta");
    expect(mod?.delta).toBe(-1);
  });

  it("does not fire when sample size is below the threshold", () => {
    const result = computeModifiers({
      offer: offer(),
      deckState: emptyDeckState(),
      communityTier: null,
      winRate: { pickWinRate: 0.60, skipWinRate: 0.30, timesPicked: 10, timesSkipped: 20 },
    });
    const mod = result.modifiers.find((m) => m.kind === "winRateDelta");
    expect(mod).toBeUndefined();
  });

  it("does not fire when the delta is below 15%", () => {
    const result = computeModifiers({
      offer: offer(),
      deckState: emptyDeckState(),
      communityTier: null,
      winRate: { pickWinRate: 0.50, skipWinRate: 0.42, timesPicked: 30, timesSkipped: 30 },
    });
    const mod = result.modifiers.find((m) => m.kind === "winRateDelta");
    expect(mod).toBeUndefined();
  });
});

describe("computeModifiers — act timing", () => {
  it("subtracts 1 for off-archetype picks in Act 3", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "damage", keystoneFor: null, fitsArchetypes: ["poison"], deadWithCurrentDeck: false, duplicatePenalty: false, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState({
        act: 3,
        archetypes: { viable: [{ name: "exhaust", supportCount: 4, hasKeystone: true }], committed: "exhaust", orphaned: [] },
      }),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "actTiming");
    expect(mod?.delta).toBe(-1);
  });

  it("does not fire when the offer fits the committed archetype", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "damage", keystoneFor: null, fitsArchetypes: ["exhaust"], deadWithCurrentDeck: false, duplicatePenalty: false, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState({
        act: 3,
        archetypes: { viable: [{ name: "exhaust", supportCount: 4, hasKeystone: true }], committed: "exhaust", orphaned: [] },
      }),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "actTiming");
    expect(mod).toBeUndefined();
  });

  it("does not fire outside Act 3", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "damage", keystoneFor: null, fitsArchetypes: ["poison"], deadWithCurrentDeck: false, duplicatePenalty: false, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState({
        act: 2,
        archetypes: { viable: [{ name: "exhaust", supportCount: 4, hasKeystone: true }], committed: "exhaust", orphaned: [] },
      }),
      communityTier: null,
      winRate: null,
    });
    const mod = result.modifiers.find((m) => m.kind === "actTiming");
    expect(mod).toBeUndefined();
  });
});

describe("computeModifiers — composition", () => {
  it("stacks archetype + gap + win-rate deltas", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "scaling", keystoneFor: "exhaust", fitsArchetypes: ["exhaust"], deadWithCurrentDeck: false, duplicatePenalty: false, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState({
        archetypes: { viable: [{ name: "exhaust", supportCount: 3, hasKeystone: false }], committed: "exhaust", orphaned: [] },
        engine: { hasScaling: false, hasBlockPayoff: false, hasRemovalMomentum: 0, hasDrawPower: false },
      }),
      communityTier: { consensusTier: 4, consensusTierLetter: "B", sourceCount: 3, stddev: 0.3, agreement: "strong", staleness: "fresh", mostRecentPublished: null },
      winRate: { pickWinRate: 0.60, skipWinRate: 0.30, timesPicked: 30, timesSkipped: 20 },
    });
    // B(4) + archetype keystone(+2) + deck gap scaling(+1) + win rate(+1) = 8 → clamped to S(6).
    expect(result.adjustedTier).toBe("S");
    expect(result.modifiers.map((m) => m.kind).sort()).toEqual(["archetypeFit", "deckGap", "winRateDelta"]);
  });

  it("clamps to F when combined negative modifiers would go below 1", () => {
    const result = computeModifiers({
      offer: offer({
        tags: { role: "damage", keystoneFor: null, fitsArchetypes: ["poison"], deadWithCurrentDeck: false, duplicatePenalty: true, upgradeLevel: 0 },
      }),
      deckState: emptyDeckState({
        act: 3,
        archetypes: { viable: [{ name: "exhaust", supportCount: 4, hasKeystone: true }], committed: "exhaust", orphaned: [] },
      }),
      communityTier: { consensusTier: 2, consensusTierLetter: "D", sourceCount: 3, stddev: 0.3, agreement: "strong", staleness: "fresh", mostRecentPublished: null },
      winRate: { pickWinRate: 0.20, skipWinRate: 0.55, timesPicked: 30, timesSkipped: 40 },
    });
    // D(2) + archetype off(-1) + duplicate(-1) + win rate(-1) + act 3(-1) = -2 → clamped to F(1).
    expect(result.adjustedTier).toBe("F");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sts2/web test -- modifier-stack`
Expected: FAIL — win-rate and act-timing modifiers not implemented yet.

- [ ] **Step 3: Implement win-rate and act-timing modifiers**

Add two helpers above `computeModifiers`:

```ts
function winRateModifier(winRate: WinRateInput | null): Modifier | null {
  if (!winRate) return null;
  const pick = winRate.pickWinRate;
  const skip = winRate.skipWinRate;
  if (pick == null || skip == null) return null;
  const delta = pick - skip;
  if (
    delta > WIN_RATE_DELTA_THRESHOLD &&
    winRate.timesPicked >= WIN_RATE_MIN_N
  ) {
    return {
      kind: "winRateDelta",
      delta: MODIFIER_DELTAS.winRatePickStrong,
      reason: `pick WR +${Math.round(delta * 100)}%`,
    };
  }
  if (
    -delta > WIN_RATE_DELTA_THRESHOLD &&
    winRate.timesSkipped >= WIN_RATE_MIN_N
  ) {
    return {
      kind: "winRateDelta",
      delta: MODIFIER_DELTAS.winRateSkipStrong,
      reason: `skip WR +${Math.round(-delta * 100)}%`,
    };
  }
  return null;
}

function actTimingModifier(offer: TaggedOffer, deckState: DeckState): Modifier | null {
  if (deckState.act !== 3) return null;
  const committed = deckState.archetypes.committed;
  if (!committed) return null;
  if (offer.tags.fitsArchetypes.includes(committed)) return null;
  return {
    kind: "actTiming",
    delta: MODIFIER_DELTAS.actThreeOffArchetype,
    reason: "Act 3 off-archetype",
  };
}
```

Add their calls to the `candidates` array inside `computeModifiers`:

```ts
  const candidates: (Modifier | null)[] = [
    archetypeFitModifier(input.offer, input.deckState),
    duplicateModifier(input.offer),
    deckGapModifier(input.offer, input.deckState),
    winRateModifier(input.winRate),
    actTimingModifier(input.offer, input.deckState),
  ];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sts2/web test -- modifier-stack`
Expected: PASS — all new tests + previous tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/evaluation/card-reward/modifier-stack.ts packages/shared/evaluation/card-reward/modifier-stack.test.ts
git commit -m "feat(card-reward): win-rate + act-timing modifiers"
```

---

## Task 4: Scaffold `skip-threshold.ts`

**Files:**
- Create: `packages/shared/evaluation/card-reward/skip-threshold.ts`
- Create: `packages/shared/evaluation/card-reward/skip-threshold.test.ts`

Per-act skip threshold:

- Act 1: no offer at `B` (tier value ≥ 4) → skip.
- Act 2: no offer at `A` (tier value ≥ 5) → skip.
- Act 3: no offer at `A` (tier value ≥ 5) AND no offer with a keystone modifier for the committed archetype → skip.

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/evaluation/card-reward/skip-threshold.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldSkipAll, SKIP_THRESHOLDS } from "./skip-threshold";
import type { ModifierBreakdown } from "./modifier-stack";

function breakdown(tier: ModifierBreakdown["adjustedTier"], tierValue: number, mods: ModifierBreakdown["modifiers"] = []): ModifierBreakdown {
  return { baseTier: "C", modifiers: mods, adjustedTier: tier, tierValue, topReason: "test" };
}

describe("skip-threshold", () => {
  it("exports thresholds per act", () => {
    expect(SKIP_THRESHOLDS[1]).toBe(4);
    expect(SKIP_THRESHOLDS[2]).toBe(5);
    expect(SKIP_THRESHOLDS[3]).toBe(5);
  });

  it("skips Act 1 when no offer is B or better", () => {
    const result = shouldSkipAll([breakdown("C", 3), breakdown("D", 2)], 1);
    expect(result.skip).toBe(true);
    expect(result.reason).toContain("Act 1");
  });

  it("does not skip Act 1 when at least one B exists", () => {
    const result = shouldSkipAll([breakdown("B", 4), breakdown("D", 2)], 1);
    expect(result.skip).toBe(false);
  });

  it("skips Act 2 when no offer is A or better", () => {
    const result = shouldSkipAll([breakdown("B", 4), breakdown("C", 3)], 2);
    expect(result.skip).toBe(true);
  });

  it("does not skip Act 2 when at least one A exists", () => {
    const result = shouldSkipAll([breakdown("A", 5), breakdown("C", 3)], 2);
    expect(result.skip).toBe(false);
  });

  it("does not skip Act 3 when an A-tier card exists", () => {
    const result = shouldSkipAll([breakdown("A", 5), breakdown("C", 3)], 3);
    expect(result.skip).toBe(false);
  });

  it("does not skip Act 3 when a keystone-for-committed card exists", () => {
    const keystoneBreakdown = breakdown("B", 4, [
      { kind: "archetypeFit", delta: 2, reason: "keystone for exhaust" },
    ]);
    const result = shouldSkipAll([keystoneBreakdown, breakdown("C", 3)], 3);
    expect(result.skip).toBe(false);
  });

  it("skips Act 3 when no A-tier and no keystone exists", () => {
    const result = shouldSkipAll([breakdown("B", 4), breakdown("C", 3)], 3);
    expect(result.skip).toBe(true);
  });

  it("returns skip=false on an empty offer list (nothing to decide against)", () => {
    const result = shouldSkipAll([], 1);
    expect(result.skip).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sts2/web test -- skip-threshold`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/shared/evaluation/card-reward/skip-threshold.ts`:

```ts
import type { ModifierBreakdown } from "./modifier-stack";

export const SKIP_THRESHOLDS = {
  1: 4, // B or better
  2: 5, // A or better
  3: 5, // A or better OR keystone for committed
} as const;

export interface SkipDecision {
  skip: boolean;
  reason: string | null;
}

function hasKeystoneForCommitted(breakdowns: ModifierBreakdown[]): boolean {
  return breakdowns.some((b) =>
    b.modifiers.some(
      (m) => m.kind === "archetypeFit" && m.reason.startsWith("keystone for "),
    ),
  );
}

export function shouldSkipAll(
  breakdowns: ModifierBreakdown[],
  act: 1 | 2 | 3,
): SkipDecision {
  if (breakdowns.length === 0) return { skip: false, reason: null };

  const threshold = SKIP_THRESHOLDS[act];
  const anyClears = breakdowns.some((b) => b.tierValue >= threshold);
  if (anyClears) return { skip: false, reason: null };

  if (act === 3 && hasKeystoneForCommitted(breakdowns)) {
    return { skip: false, reason: null };
  }

  const tierLabel = threshold === 4 ? "B" : "A";
  return {
    skip: true,
    reason: `Act ${act}: no offer cleared the ${tierLabel}-tier threshold`,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sts2/web test -- skip-threshold`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/evaluation/card-reward/skip-threshold.ts packages/shared/evaluation/card-reward/skip-threshold.test.ts
git commit -m "feat(card-reward): skip threshold per act with keystone override"
```

---

## Task 5: `score-offers.ts` orchestrator

**Files:**
- Create: `packages/shared/evaluation/card-reward/score-offers.ts`
- Create: `packages/shared/evaluation/card-reward/score-offers.test.ts`

Orchestrates enrichment → modifiers → ranking → skip decision.

```ts
interface ScoredOffer {
  itemId: string;
  itemName: string;
  itemIndex: number;
  rank: number;                // 1-based
  tier: TierLetter;
  tierValue: number;
  reasoning: string;            // `"{tier}-tier · {topReason}"`
  breakdown: ModifierBreakdown; // telemetry — filtered out of wire shape by caller
}

interface ScoreOffersResult {
  offers: ScoredOffer[];        // sorted by tierValue desc, stable by index
  skipRecommended: boolean;
  skipReason: string | null;
  topOffer: ScoredOffer | null;  // first offer if any, regardless of skip
}
```

Sort order:
1. `tierValue` desc.
2. Higher modifier-positive count desc (ties broken toward "more modifiers fired positively" = better coverage).
3. Original `itemIndex` asc (stable input order).

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/evaluation/card-reward/score-offers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { scoreCardOffers } from "./score-offers";
import type { DeckState } from "./deck-state";
import type { TaggedOffer } from "./format-card-facts";
import type { CommunityTierSignal } from "../community-tier";

function deckState(overrides: Partial<DeckState> = {}): DeckState {
  return {
    size: 12,
    act: 1,
    floor: 3,
    ascension: 10,
    composition: { strikes: 4, defends: 4, deadCards: 8, upgraded: 0, upgradeRatio: 0 },
    sizeVerdict: "too_thin",
    archetypes: { viable: [], committed: null, orphaned: [] },
    engine: { hasScaling: false, hasBlockPayoff: false, hasRemovalMomentum: 0, hasDrawPower: false },
    hp: { current: 70, max: 80, ratio: 0.875 },
    upcoming: { nextNodeType: null, bossesPossible: [], dangerousMatchups: [] },
    ...overrides,
  };
}

function offer(index: number, name: string, tagsOverrides: Partial<TaggedOffer["tags"]> = {}): TaggedOffer {
  return {
    index,
    name,
    rarity: "common",
    type: "Attack",
    cost: 1,
    description: "",
    tags: {
      role: "damage",
      keystoneFor: null,
      fitsArchetypes: [],
      deadWithCurrentDeck: false,
      duplicatePenalty: false,
      upgradeLevel: 0,
      ...tagsOverrides,
    },
  };
}

function tier(letter: "S" | "A" | "B" | "C" | "D" | "F"): CommunityTierSignal {
  const values = { S: 6, A: 5, B: 4, C: 3, D: 2, F: 1 } as const;
  return {
    consensusTier: values[letter],
    consensusTierLetter: letter,
    sourceCount: 3,
    stddev: 0.3,
    agreement: "strong",
    staleness: "fresh",
    mostRecentPublished: null,
  };
}

describe("scoreCardOffers", () => {
  it("returns offers sorted by tier desc with stable order on ties", () => {
    const offers = [offer(1, "low"), offer(2, "mid"), offer(3, "also_mid")];
    const result = scoreCardOffers({
      offers,
      deckState: deckState(),
      communityTierById: new Map([
        ["1", tier("D")],
        ["2", tier("B")],
        ["3", tier("B")],
      ]),
      winRatesById: new Map(),
      itemIdsByIndex: new Map([[1, "1"], [2, "2"], [3, "3"]]),
    });
    expect(result.offers.map((o) => o.itemName)).toEqual(["mid", "also_mid", "low"]);
    expect(result.offers.map((o) => o.rank)).toEqual([1, 2, 3]);
  });

  it("builds reasoning string with tier + top reason", () => {
    const result = scoreCardOffers({
      offers: [offer(1, "scaler", { role: "scaling", keystoneFor: "exhaust", fitsArchetypes: ["exhaust"] })],
      deckState: deckState({
        archetypes: { viable: [{ name: "exhaust", supportCount: 3, hasKeystone: false }], committed: "exhaust", orphaned: [] },
        engine: { hasScaling: false, hasBlockPayoff: false, hasRemovalMomentum: 0, hasDrawPower: false },
      }),
      communityTierById: new Map([["1", tier("B")]]),
      winRatesById: new Map(),
      itemIdsByIndex: new Map([[1, "1"]]),
    });
    expect(result.offers[0].reasoning).toMatch(/S-tier · keystone for exhaust/);
  });

  it("recommends skip in Act 1 when no offer clears B-tier", () => {
    const result = scoreCardOffers({
      offers: [offer(1, "weak"), offer(2, "also_weak")],
      deckState: deckState({ act: 1 }),
      communityTierById: new Map([
        ["1", tier("C")],
        ["2", tier("D")],
      ]),
      winRatesById: new Map(),
      itemIdsByIndex: new Map([[1, "1"], [2, "2"]]),
    });
    expect(result.skipRecommended).toBe(true);
    expect(result.skipReason).toContain("Act 1");
  });

  it("does not recommend skip when at least one offer clears the threshold", () => {
    const result = scoreCardOffers({
      offers: [offer(1, "solid")],
      deckState: deckState({ act: 1 }),
      communityTierById: new Map([["1", tier("B")]]),
      winRatesById: new Map(),
      itemIdsByIndex: new Map([[1, "1"]]),
    });
    expect(result.skipRecommended).toBe(false);
  });

  it("handles an empty offer list without crashing", () => {
    const result = scoreCardOffers({
      offers: [],
      deckState: deckState(),
      communityTierById: new Map(),
      winRatesById: new Map(),
      itemIdsByIndex: new Map(),
    });
    expect(result.offers).toEqual([]);
    expect(result.topOffer).toBeNull();
    expect(result.skipRecommended).toBe(false);
  });

  it("exposes breakdown per offer for telemetry", () => {
    const result = scoreCardOffers({
      offers: [offer(1, "card")],
      deckState: deckState(),
      communityTierById: new Map([["1", tier("C")]]),
      winRatesById: new Map(),
      itemIdsByIndex: new Map([[1, "1"]]),
    });
    expect(result.offers[0].breakdown).toBeDefined();
    expect(result.offers[0].breakdown.baseTier).toBe("C");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sts2/web test -- score-offers`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/shared/evaluation/card-reward/score-offers.ts`:

```ts
import type { DeckState } from "./deck-state";
import type { TaggedOffer } from "./format-card-facts";
import type { CommunityTierSignal } from "../community-tier";
import type { TierLetter } from "../tier-utils";
import { computeModifiers, type ModifierBreakdown, type WinRateInput } from "./modifier-stack";
import { shouldSkipAll } from "./skip-threshold";

export interface ScoredOffer {
  itemId: string;
  itemName: string;
  itemIndex: number;
  rank: number;
  tier: TierLetter;
  tierValue: number;
  reasoning: string;
  breakdown: ModifierBreakdown;
}

export interface ScoreOffersResult {
  offers: ScoredOffer[];
  skipRecommended: boolean;
  skipReason: string | null;
  topOffer: ScoredOffer | null;
}

export interface ScoreOffersInput {
  offers: TaggedOffer[];
  deckState: DeckState;
  communityTierById: Map<string, CommunityTierSignal>;
  winRatesById: Map<string, WinRateInput>;
  itemIdsByIndex: Map<number, string>;
}

function positiveModifierCount(breakdown: ModifierBreakdown): number {
  return breakdown.modifiers.filter((m) => m.delta > 0).length;
}

export function scoreCardOffers(input: ScoreOffersInput): ScoreOffersResult {
  if (input.offers.length === 0) {
    return { offers: [], skipRecommended: false, skipReason: null, topOffer: null };
  }

  const scored: ScoredOffer[] = input.offers.map((offer) => {
    const itemId = input.itemIdsByIndex.get(offer.index) ?? String(offer.index);
    const breakdown = computeModifiers({
      offer,
      deckState: input.deckState,
      communityTier: input.communityTierById.get(itemId) ?? null,
      winRate: input.winRatesById.get(itemId) ?? null,
    });
    return {
      itemId,
      itemName: offer.name,
      itemIndex: offer.index,
      rank: 0, // assigned after sort
      tier: breakdown.adjustedTier,
      tierValue: breakdown.tierValue,
      reasoning: `${breakdown.adjustedTier}-tier · ${breakdown.topReason}`,
      breakdown,
    };
  });

  scored.sort((a, b) => {
    if (a.tierValue !== b.tierValue) return b.tierValue - a.tierValue;
    const posDiff = positiveModifierCount(b.breakdown) - positiveModifierCount(a.breakdown);
    if (posDiff !== 0) return posDiff;
    return a.itemIndex - b.itemIndex;
  });

  scored.forEach((o, i) => {
    o.rank = i + 1;
  });

  const skip = shouldSkipAll(
    scored.map((o) => o.breakdown),
    input.deckState.act,
  );

  return {
    offers: scored,
    skipRecommended: skip.skip,
    skipReason: skip.reason,
    topOffer: scored[0] ?? null,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sts2/web test -- score-offers`
Expected: PASS — all tests + modifier-stack + skip-threshold tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/evaluation/card-reward/score-offers.ts packages/shared/evaluation/card-reward/score-offers.test.ts
git commit -m "feat(card-reward): score-offers orchestrator"
```

---

## Task 6: Coaching catalog

**Files:**
- Create: `packages/shared/evaluation/card-reward/coaching-catalog.ts`
- Create: `packages/shared/evaluation/card-reward/coaching-catalog.test.ts`

Fixed string map per modifier kind (teaching callout) + tradeoff up/down phrases.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/evaluation/card-reward/coaching-catalog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { COACHING_CATALOG, getTeaching, getTradeoffPhrases } from "./coaching-catalog";

describe("COACHING_CATALOG", () => {
  it("has an entry for every ModifierKind plus baseTier", () => {
    const required = [
      "archetypeFit",
      "deckGap",
      "duplicate",
      "winRateDelta",
      "actTiming",
      "baseTier",
    ];
    for (const key of required) {
      expect(COACHING_CATALOG[key as keyof typeof COACHING_CATALOG]).toBeDefined();
    }
  });

  it("getTeaching returns the catalog teaching for a modifier kind", () => {
    expect(getTeaching("archetypeFit")).toMatch(/archetype/i);
  });

  it("getTradeoffPhrases returns upside/downside for a kind", () => {
    const t = getTradeoffPhrases("archetypeFit");
    expect(t.upside.length).toBeGreaterThan(0);
    expect(t.downside.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sts2/web test -- coaching-catalog`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/shared/evaluation/card-reward/coaching-catalog.ts`:

```ts
import type { ModifierKind } from "./modifier-stack";

export type CatalogKind = ModifierKind | "baseTier";

export interface CatalogEntry {
  teaching: string;
  upside: string;
  downside: string;
}

export const COACHING_CATALOG: Record<CatalogKind, CatalogEntry> = {
  archetypeFit: {
    teaching: "On-archetype picks compound; off-archetype picks dilute the deck.",
    upside: "Strengthens the committed archetype",
    downside: "Dilutes the deck with off-archetype cards",
  },
  deckGap: {
    teaching: "Cards that fill an engine gap (block / scaling / draw / removal) pay off every subsequent fight.",
    upside: "Fills a hole the current deck cannot cover",
    downside: "Leaves a structural gap open",
  },
  duplicate: {
    teaching: "Duplicates of non-core cards dilute the draw; duplicates of engine pieces compound.",
    upside: "Fresh card, not a redundant copy",
    downside: "Third copy of a non-core card",
  },
  winRateDelta: {
    teaching: "Historical pick-vs-skip win rate outweighs vibes when sample size is large enough.",
    upside: "Historically wins more when picked",
    downside: "Historically wins more when skipped",
  },
  actTiming: {
    teaching: "Act 3 is for finishing the engine, not fishing for side bets.",
    upside: "On-archetype in the finish stretch",
    downside: "Off-archetype pick this late in the run",
  },
  keystoneOverride: {
    teaching: "Keystones unlock scaling; grabbing one beats a higher raw tier in almost every case.",
    upside: "Unlocks the archetype's scaling",
    downside: "Leaves the archetype without its keystone",
  },
  baseTier: {
    teaching: "Community tier is a prior. It is not the full story once the deck takes shape.",
    upside: "Community consensus rates this well",
    downside: "Community consensus rates this poorly",
  },
};

export function getTeaching(kind: CatalogKind): string {
  return COACHING_CATALOG[kind].teaching;
}

export function getTradeoffPhrases(kind: CatalogKind): { upside: string; downside: string } {
  const e = COACHING_CATALOG[kind];
  return { upside: e.upside, downside: e.downside };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sts2/web test -- coaching-catalog`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/evaluation/card-reward/coaching-catalog.ts packages/shared/evaluation/card-reward/coaching-catalog.test.ts
git commit -m "feat(card-reward): coaching catalog for templated prose"
```

---

## Task 7: `build-coaching.ts` — templated prose from scorer output

**Files:**
- Create: `packages/shared/evaluation/card-reward/build-coaching.ts`
- Create: `packages/shared/evaluation/card-reward/build-coaching.test.ts`

Output shape matches `CardRewardEvaluation.coaching` in `types.ts`:

```ts
{
  reasoning: { deckState: string; commitment: string };
  headline: string;
  confidence: number;
  keyTradeoffs: { position: number; upside: string; downside: string }[];
  teachingCallouts: { pattern: string; explanation: string }[];
}
```

- **headline:**
  - Skip: `"Skip all — {skipReason}"`.
  - Pick: `"Pick {topOffer.itemName} — {topOffer.breakdown.topReason}"`.
- **reasoning.deckState:** short summary of deck state (`{size}-card deck, {committed ?? "uncommitted"}`).
- **reasoning.commitment:** commitment-phase guidance (`"Act {act}; {committed} locked"` or `"Act {act}; archetypes still open"`).
- **confidence:** derived from top-offer's tierValue: `S/A → 0.95`, `B → 0.85`, `C → 0.65`, `D/F → 0.45`. Skip case: `0.80`.
- **keyTradeoffs (0-2):** derived from top offer vs runner-up. Compare their dominant modifiers; pick up to 2 distinct kinds. Each tradeoff:
  - `position` = runner-up's `itemIndex`.
  - `upside` = catalog upside for the kind the top offer wins on.
  - `downside` = catalog downside for the kind the runner-up wins on (if any); else `""`.
- **teachingCallouts (0-3):** one per *active* modifier kind on the top offer (ordered by absolute delta desc), pulled from the catalog. Each callout:
  - `pattern` = kind.
  - `explanation` = catalog teaching.

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/evaluation/card-reward/build-coaching.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildCoaching } from "./build-coaching";
import type { ScoredOffer, ScoreOffersResult } from "./score-offers";
import type { ModifierBreakdown } from "./modifier-stack";

function breakdown(
  baseTier: ModifierBreakdown["baseTier"],
  adjustedTier: ModifierBreakdown["adjustedTier"],
  tierValue: number,
  topReason: string,
  modifiers: ModifierBreakdown["modifiers"] = [],
): ModifierBreakdown {
  return { baseTier, modifiers, adjustedTier, tierValue, topReason };
}

function scoredOffer(overrides: Partial<ScoredOffer>): ScoredOffer {
  return {
    itemId: "1",
    itemName: "Card",
    itemIndex: 1,
    rank: 1,
    tier: "B",
    tierValue: 4,
    reasoning: "B-tier · test",
    breakdown: breakdown("B", "B", 4, "test"),
    ...overrides,
  };
}

describe("buildCoaching", () => {
  it("produces a pick headline when skipRecommended is false", () => {
    const top = scoredOffer({
      itemName: "Inflame",
      breakdown: breakdown("A", "S", 6, "keystone for strength", [
        { kind: "archetypeFit", delta: 2, reason: "keystone for strength" },
      ]),
    });
    const result: ScoreOffersResult = {
      offers: [top],
      skipRecommended: false,
      skipReason: null,
      topOffer: top,
    };
    const coach = buildCoaching(result, { act: 1, floor: 3, deckSize: 12, committed: "strength" });
    expect(coach.headline).toBe("Pick Inflame — keystone for strength");
  });

  it("produces a skip headline when skipRecommended is true", () => {
    const result: ScoreOffersResult = {
      offers: [scoredOffer({ tier: "C", tierValue: 3 })],
      skipRecommended: true,
      skipReason: "Act 1: no offer cleared the B-tier threshold",
      topOffer: null,
    };
    const coach = buildCoaching(result, { act: 1, floor: 3, deckSize: 12, committed: null });
    expect(coach.headline.toLowerCase()).toContain("skip all");
    expect(coach.headline).toContain("Act 1");
  });

  it("produces a teaching callout per active modifier on the top offer", () => {
    const top = scoredOffer({
      breakdown: breakdown("B", "A", 5, "keystone for strength", [
        { kind: "archetypeFit", delta: 2, reason: "keystone for strength" },
        { kind: "deckGap", delta: 1, reason: "fills scaling gap" },
      ]),
    });
    const result: ScoreOffersResult = {
      offers: [top],
      skipRecommended: false,
      skipReason: null,
      topOffer: top,
    };
    const coach = buildCoaching(result, { act: 1, floor: 3, deckSize: 12, committed: "strength" });
    const patterns = coach.teachingCallouts.map((c) => c.pattern);
    expect(patterns).toContain("archetypeFit");
    expect(patterns).toContain("deckGap");
  });

  it("produces key tradeoffs comparing top offer vs runner-up", () => {
    const top = scoredOffer({
      itemIndex: 1,
      breakdown: breakdown("B", "A", 5, "keystone for strength", [
        { kind: "archetypeFit", delta: 2, reason: "keystone for strength" },
      ]),
    });
    const runnerUp = scoredOffer({
      itemId: "2",
      itemIndex: 2,
      itemName: "Defend",
      rank: 2,
      tier: "C",
      tierValue: 3,
      breakdown: breakdown("C", "C", 3, "base tier", []),
    });
    const result: ScoreOffersResult = {
      offers: [top, runnerUp],
      skipRecommended: false,
      skipReason: null,
      topOffer: top,
    };
    const coach = buildCoaching(result, { act: 1, floor: 3, deckSize: 12, committed: "strength" });
    expect(coach.keyTradeoffs.length).toBeGreaterThan(0);
    expect(coach.keyTradeoffs[0].position).toBe(2);
  });

  it("returns empty tradeoffs + callouts when the top offer has no active modifiers", () => {
    const top = scoredOffer({
      breakdown: breakdown("C", "C", 3, "base tier", []),
    });
    const result: ScoreOffersResult = {
      offers: [top],
      skipRecommended: false,
      skipReason: null,
      topOffer: top,
    };
    const coach = buildCoaching(result, { act: 1, floor: 3, deckSize: 12, committed: null });
    expect(coach.teachingCallouts).toEqual([]);
    expect(coach.keyTradeoffs).toEqual([]);
  });

  it("sets confidence from the top offer's tier", () => {
    const makeTop = (tier: "S" | "A" | "B" | "C" | "D" | "F", tv: number) =>
      scoredOffer({ tier, tierValue: tv, breakdown: breakdown("C", tier, tv, "test") });
    const ctx = { act: 1, floor: 3, deckSize: 12, committed: null };
    const s = buildCoaching({ offers: [makeTop("S", 6)], skipRecommended: false, skipReason: null, topOffer: makeTop("S", 6) }, ctx);
    const c = buildCoaching({ offers: [makeTop("C", 3)], skipRecommended: false, skipReason: null, topOffer: makeTop("C", 3) }, ctx);
    expect(s.confidence).toBe(0.95);
    expect(c.confidence).toBe(0.65);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sts2/web test -- build-coaching`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/shared/evaluation/card-reward/build-coaching.ts`:

```ts
import type { ScoreOffersResult, ScoredOffer } from "./score-offers";
import type { Modifier, ModifierKind } from "./modifier-stack";
import { COACHING_CATALOG, type CatalogKind, getTeaching } from "./coaching-catalog";

export interface CoachingContext {
  act: 1 | 2 | 3;
  floor: number;
  deckSize: number;
  committed: string | null;
}

export interface CoachingOutput {
  reasoning: { deckState: string; commitment: string };
  headline: string;
  confidence: number;
  keyTradeoffs: { position: number; upside: string; downside: string }[];
  teachingCallouts: { pattern: string; explanation: string }[];
}

const MAX_CALLOUTS = 3;
const MAX_TRADEOFFS = 2;

function confidenceFromTierValue(tv: number): number {
  if (tv >= 5) return 0.95;
  if (tv === 4) return 0.85;
  if (tv === 3) return 0.65;
  return 0.45;
}

function dominantModifier(offer: ScoredOffer): Modifier | null {
  if (offer.breakdown.modifiers.length === 0) return null;
  return offer.breakdown.modifiers.reduce((best, m) =>
    Math.abs(m.delta) > Math.abs(best.delta) ? m : best,
  );
}

function kindsSortedByAbsDelta(offer: ScoredOffer): ModifierKind[] {
  return [...offer.breakdown.modifiers]
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .map((m) => m.kind);
}

function buildTeachingCallouts(top: ScoredOffer): CoachingOutput["teachingCallouts"] {
  const kinds = kindsSortedByAbsDelta(top);
  const unique: ModifierKind[] = [];
  for (const k of kinds) {
    if (!unique.includes(k)) unique.push(k);
    if (unique.length >= MAX_CALLOUTS) break;
  }
  return unique.map((k) => ({ pattern: k, explanation: getTeaching(k as CatalogKind) }));
}

function buildTradeoffs(
  top: ScoredOffer,
  runnerUp: ScoredOffer | null,
): CoachingOutput["keyTradeoffs"] {
  if (!runnerUp) return [];
  if (top.breakdown.modifiers.length === 0) return [];

  const topKinds = kindsSortedByAbsDelta(top);
  const runnerUpKinds = new Set(kindsSortedByAbsDelta(runnerUp));

  // Use up to MAX_TRADEOFFS kinds the top offer has that the runner-up does not.
  const distinguishing = topKinds.filter((k) => !runnerUpKinds.has(k)).slice(0, MAX_TRADEOFFS);
  if (distinguishing.length === 0) return [];

  return distinguishing.map((k) => {
    const entry = COACHING_CATALOG[k as CatalogKind];
    return { position: runnerUp.itemIndex, upside: entry.upside, downside: entry.downside };
  });
}

function buildHeadline(result: ScoreOffersResult): string {
  if (result.skipRecommended) {
    return `Skip all — ${result.skipReason ?? "no offer cleared the threshold"}`;
  }
  if (!result.topOffer) return "Skip all — no offers to rank";
  const top = result.topOffer;
  const dom = dominantModifier(top);
  const reason = dom?.reason ?? top.breakdown.topReason;
  return `Pick ${top.itemName} — ${reason}`;
}

function buildReasoning(
  result: ScoreOffersResult,
  ctx: CoachingContext,
): CoachingOutput["reasoning"] {
  const commitmentPhrase = ctx.committed
    ? `Act ${ctx.act}; ${ctx.committed} locked`
    : `Act ${ctx.act}; archetypes still open`;
  const deckState = `${ctx.deckSize}-card deck, ${ctx.committed ?? "uncommitted"}`;
  return { deckState, commitment: commitmentPhrase };
}

export function buildCoaching(
  result: ScoreOffersResult,
  ctx: CoachingContext,
): CoachingOutput {
  const top = result.topOffer;
  const runnerUp = result.offers[1] ?? null;

  const tvForConfidence = result.skipRecommended ? 0 : top?.tierValue ?? 0;
  const confidence = result.skipRecommended ? 0.80 : confidenceFromTierValue(tvForConfidence);

  return {
    reasoning: buildReasoning(result, ctx),
    headline: buildHeadline(result),
    confidence,
    keyTradeoffs: top ? buildTradeoffs(top, runnerUp) : [],
    teachingCallouts: top ? buildTeachingCallouts(top) : [],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sts2/web test -- build-coaching`
Expected: PASS — all tests + previous tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/evaluation/card-reward/build-coaching.ts packages/shared/evaluation/card-reward/build-coaching.test.ts
git commit -m "feat(card-reward): templated coaching builder from catalog"
```

---

## Task 8: `scoreShopNonCards` — deterministic ranker for removal / relic / potion

**Files:**
- Create: `packages/shared/evaluation/shop/score-non-cards.ts`
- Create: `packages/shared/evaluation/shop/score-non-cards.test.ts`

Non-card shop items are categorized by description heuristics (reuse patterns from `post-eval-weights.ts:applyShopWeights`). Priority base:

- Card removal → `S` (act 1-2) / `A` (act 3).
- Relic → `A` (act 1) / `S` (act 2-3).
- Card → **routed to card scorer, not this module** (only non-card items here).
- Potion → `B` by default. `F` if no open potion slots (potionCount >= 3).

Gold gating: if `item.cost > goldBudget` → tier becomes `F`, `affordable = false`, reason `"not affordable"`.

Ordered priority within same tier: removal > relic > potion.

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/evaluation/shop/score-non-cards.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { scoreShopNonCards, type ShopNonCardItem } from "./score-non-cards";

function item(overrides: Partial<ShopNonCardItem> = {}): ShopNonCardItem {
  return {
    itemId: "x",
    itemName: "Something",
    itemIndex: 1,
    cost: 50,
    description: "",
    ...overrides,
  };
}

describe("scoreShopNonCards", () => {
  it("ranks card removal as S-tier in Act 1", () => {
    const result = scoreShopNonCards({
      items: [item({ itemName: "Card Removal", cost: 75 })],
      act: 1,
      goldBudget: 200,
      potionCount: 0,
    });
    expect(result[0].tier).toBe("S");
    expect(result[0].kind).toBe("card_removal");
  });

  it("ranks relics as A in Act 1 and S in Act 2", () => {
    const items = [item({ itemName: "Relic X", description: "Gain 3 strength" })];
    const act1 = scoreShopNonCards({ items, act: 1, goldBudget: 500, potionCount: 0 });
    const act2 = scoreShopNonCards({ items, act: 2, goldBudget: 500, potionCount: 0 });
    expect(act1[0].tier).toBe("A");
    expect(act2[0].tier).toBe("S");
  });

  it("ranks potions as B when slots are open, F when full", () => {
    const items = [item({ itemName: "Strength Potion", description: "Gain strength" })];
    const open = scoreShopNonCards({ items, act: 1, goldBudget: 200, potionCount: 0 });
    const full = scoreShopNonCards({ items, act: 1, goldBudget: 200, potionCount: 3 });
    expect(open[0].tier).toBe("B");
    expect(full[0].tier).toBe("F");
  });

  it("forces F tier and affordable=false when the cost exceeds the gold budget", () => {
    const result = scoreShopNonCards({
      items: [item({ itemName: "Card Removal", cost: 100 })],
      act: 1,
      goldBudget: 50,
      potionCount: 0,
    });
    expect(result[0].tier).toBe("F");
    expect(result[0].affordable).toBe(false);
  });

  it("sorts ranked items by tier desc, stable by original index", () => {
    const items = [
      item({ itemIndex: 1, itemName: "Potion A", description: "Gain strength", cost: 50 }),
      item({ itemIndex: 2, itemName: "Relic B", description: "A shiny relic", cost: 150 }),
      item({ itemIndex: 3, itemName: "Card Removal", cost: 75 }),
    ];
    const result = scoreShopNonCards({ items, act: 1, goldBudget: 300, potionCount: 0 });
    expect(result.map((r) => r.itemName)).toEqual(["Card Removal", "Relic B", "Potion A"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sts2/web test -- score-non-cards`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/shared/evaluation/shop/score-non-cards.ts`:

```ts
import type { TierLetter } from "../tier-utils";
import { tierToValue } from "../tier-utils";

export type ShopItemKind = "card_removal" | "relic" | "potion" | "other";

export interface ShopNonCardItem {
  itemId: string;
  itemName: string;
  itemIndex: number;
  cost: number;
  description: string;
}

export interface ScoredShopNonCardItem extends ShopNonCardItem {
  kind: ShopItemKind;
  tier: TierLetter;
  tierValue: number;
  reasoning: string;
  affordable: boolean;
}

export interface ScoreShopNonCardsInput {
  items: ShopNonCardItem[];
  act: 1 | 2 | 3;
  goldBudget: number;
  potionCount: number;
}

function classifyItem(item: ShopNonCardItem): ShopItemKind {
  const name = item.itemName.toLowerCase();
  const desc = item.description.toLowerCase();
  if (name.includes("remove") || name.includes("card removal")) return "card_removal";
  if (name.includes("potion") || name.includes("elixir") || name.includes("flask") || name.includes("brew")) return "potion";
  // Relics are everything else named in a shop that isn't a card — the card
  // route is handled by the card scorer elsewhere.
  return "relic";
  // (The "other" branch is currently unreachable but the type leaves room.)
  void desc;
}

function baseTier(kind: ShopItemKind, act: 1 | 2 | 3, potionCount: number): TierLetter {
  switch (kind) {
    case "card_removal":
      return act === 3 ? "A" : "S";
    case "relic":
      return act === 1 ? "A" : "S";
    case "potion":
      return potionCount >= 3 ? "F" : "B";
    case "other":
      return "C";
  }
}

function kindRank(kind: ShopItemKind): number {
  switch (kind) {
    case "card_removal": return 0;
    case "relic": return 1;
    case "potion": return 2;
    case "other": return 3;
  }
}

export function scoreShopNonCards(input: ScoreShopNonCardsInput): ScoredShopNonCardItem[] {
  const scored = input.items.map<ScoredShopNonCardItem>((item) => {
    const kind = classifyItem(item);
    const affordable = item.cost <= input.goldBudget;
    const tier: TierLetter = affordable ? baseTier(kind, input.act, input.potionCount) : "F";
    const tv = tierToValue(tier);
    const reasoning = affordable
      ? `${tier}-tier · ${kindReason(kind, input.act, input.potionCount)}`
      : `F-tier · not affordable`;
    return {
      ...item,
      kind,
      tier,
      tierValue: tv,
      reasoning,
      affordable,
    };
  });

  scored.sort((a, b) => {
    if (a.tierValue !== b.tierValue) return b.tierValue - a.tierValue;
    const kd = kindRank(a.kind) - kindRank(b.kind);
    if (kd !== 0) return kd;
    return a.itemIndex - b.itemIndex;
  });

  return scored;
}

function kindReason(kind: ShopItemKind, act: 1 | 2 | 3, potionCount: number): string {
  switch (kind) {
    case "card_removal":
      return act === 3 ? "removal still useful" : "deck-trim priority";
    case "relic":
      return act === 1 ? "permanent power early" : "relic in peak window";
    case "potion":
      return potionCount >= 3 ? "no open potion slot" : "situational tool";
    case "other":
      return "";
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sts2/web test -- score-non-cards`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/evaluation/shop/score-non-cards.ts packages/shared/evaluation/shop/score-non-cards.test.ts
git commit -m "feat(shop): deterministic ranker for removal / relic / potion"
```

---

## Task 9: Rewire `/api/evaluate` card_reward branch

**Files:**
- Modify: `apps/web/src/app/api/evaluate/route.ts`

Replace the LLM call in the `type === "card_reward"` path with the scorer + coaching builder. Keep the enrichment (deck state, card tags, community tier fetch, win-rate fetch) already in place.

Outline (write the implementation code; do not leave TODOs):

1. Keep the block that fetches `cachedResults`, `winRates`, `communityTierContext` data. Rework it to build typed maps:
   - `winRatesById: Map<string, WinRateInput>` from `winRates`.
   - `communityTierById: Map<string, CommunityTierSignal>` from the existing `getCommunityTierSignals` call (already returns a `Map`).
2. Keep the existing enrichment that runs `computeDeckState` and `tagCard`. Produce `taggedOffers` the same way it's already built (lines around `962-975` in the current route).
3. Call `scoreCardOffers({ offers, deckState, communityTierById, winRatesById, itemIdsByIndex })`.
4. Call `buildCoaching(result, { act, floor, deckSize, committed })`.
5. Assemble a `CardRewardEvaluation` whose `rankings` come from `result.offers` (dropping `breakdown`) and whose `coaching` is `buildCoaching(...)`. Set `skipRecommended` + `skipReasoning` from the scorer.
6. Attach `compliance: { scoredOffers }` telemetry shape on the response (new optional field; see Task 12 for schema plumbing).
7. Return `NextResponse.json(evaluation)`.

Delete the `try { const result = await generateText(...) ... }` block for `card_reward`. The LLM path no longer runs for this eval type. The `NoObjectGeneratedError` fallback for card_reward disappears too.

(The `shop` branch still runs the LLM in this task. Task 10 handles it.)

- [ ] **Step 1: Read the current route and locate the card_reward block**

Run: `grep -n "type === \"card_reward\"\|buildCardRewardSchema" apps/web/src/app/api/evaluate/route.ts | head -6`

Locate the block between the enrichment (`factsBlock = ...`) and the final `return NextResponse.json(evaluation)` that handles the LLM call.

- [ ] **Step 2: Replace the LLM path**

Replace the `try { const result = await generateText({...}) ... }` for `card_reward` with the scorer call. The final `evaluation` object shape stays the same (it's what the desktop consumes).

Concrete edit — after the enrichment block that produces `deckState`, `taggedOffers`, and after the existing win-rate fetch that produces `winRates`, insert:

```ts
if (type === "card_reward") {
  const communityTierMap = await getCommunityTierSignals(
    supabase,
    items.map((i) => i.id),
    context.character,
    gameVersion,
  );

  const winRatesById = new Map<string, WinRateInput>();
  for (const w of winRates ?? []) {
    winRatesById.set(w.item_id, {
      pickWinRate: w.pick_win_rate,
      skipWinRate: w.skip_win_rate,
      timesPicked: w.times_picked ?? 0,
      timesSkipped: w.times_skipped ?? 0,
    });
  }

  const itemIdsByIndex = new Map<number, string>();
  items.forEach((it, i) => itemIdsByIndex.set(i + 1, it.id));

  const scored = scoreCardOffers({
    offers: taggedOffers,
    deckState,
    communityTierById: communityTierMap,
    winRatesById,
    itemIdsByIndex,
  });

  const coaching = buildCoaching(scored, {
    act: (context.act >= 1 && context.act <= 3 ? context.act : 1) as 1 | 2 | 3,
    floor: context.floor,
    deckSize: context.deckSize,
    committed: deckState.archetypes.committed,
  });

  const rankings: CardEvaluation[] = scored.offers.map((o) => ({
    itemId: o.itemId,
    itemName: o.itemName,
    itemIndex: o.itemIndex,
    rank: o.rank,
    tier: o.tier,
    tierValue: o.tierValue,
    synergyScore: 50,
    confidence: Math.round(coaching.confidence * 100),
    recommendation:
      o.rank === 1 && !scored.skipRecommended
        ? "strong_pick"
        : scored.skipRecommended
          ? "skip"
          : "situational",
    reasoning: o.reasoning,
    source: "claude",
  }));

  const evaluation: CardRewardEvaluation = {
    rankings,
    skipRecommended: scored.skipRecommended,
    skipReasoning: scored.skipReason,
    coaching: {
      reasoning: coaching.reasoning,
      headline: coaching.headline,
      confidence: coaching.confidence,
      keyTradeoffs: coaching.keyTradeoffs,
      teachingCallouts: coaching.teachingCallouts,
    },
    // @ts-expect-error augmenting response with scoredOffers telemetry (Task 12 schema update)
    compliance: {
      scoredOffers: scored.offers.map((o) => ({
        itemId: o.itemId,
        rank: o.rank,
        tier: o.tier,
        tierValue: o.tierValue,
        breakdown: o.breakdown,
      })),
    },
  };

  return NextResponse.json(evaluation);
}
```

Delete the existing `try { const result = await generateText(...) ... }` block that ran the LLM for `card_reward`. Leave the `if (type === "shop") { ... }` untouched for Task 10.

Add the imports at the top of `route.ts`:

```ts
import { scoreCardOffers } from "@sts2/shared/evaluation/card-reward/score-offers";
import { buildCoaching } from "@sts2/shared/evaluation/card-reward/build-coaching";
import type { WinRateInput } from "@sts2/shared/evaluation/card-reward/modifier-stack";
```

`CardEvaluation` / `CardRewardEvaluation` are already imported via `@sts2/shared/evaluation/types`. Verify with grep before adding duplicates.

- [ ] **Step 3: Run web tests and build**

Run: `pnpm --filter @sts2/web test`
Expected: all tests still pass (scorer tests don't exercise the route yet; the regression suite in Task 13 covers the route-level path).

Run: `pnpm --filter @sts2/web build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/evaluate/route.ts
git commit -m "feat(card-reward): route uses scorer + templated coaching, no LLM"
```

---

## Task 10: Rewire `/api/evaluate` shop branch

**Files:**
- Modify: `apps/web/src/app/api/evaluate/route.ts`

Shop splits items into card vs non-card by `item.type` (Attack / Skill / Power → card; otherwise → non-card). Cards run through `scoreCardOffers`. Non-cards run through `scoreShopNonCards`. Results merge into the same `CardRewardEvaluation` wire shape; ranking is by combined `tierValue` desc.

- [ ] **Step 1: Implement the shop branch**

Find the `if (type === "shop") { ... }` path or the shared `(type === "shop")` conditionals within the current card/shop block. Immediately after the code that fetches `items`, `winRates`, `communityTierMap`, and `deckState` / `taggedOffers`, add:

```ts
if (type === "shop") {
  const cardItems = items.filter((i) => i.type === "Attack" || i.type === "Skill" || i.type === "Power");
  const nonCardItems = items.filter((i) => !(i.type === "Attack" || i.type === "Skill" || i.type === "Power"));

  const communityTierMap = await getCommunityTierSignals(
    supabase,
    cardItems.map((i) => i.id),
    context.character,
    gameVersion,
  );

  const winRatesById = new Map<string, WinRateInput>();
  for (const w of winRates ?? []) {
    winRatesById.set(w.item_id, {
      pickWinRate: w.pick_win_rate,
      skipWinRate: w.skip_win_rate,
      timesPicked: w.times_picked ?? 0,
      timesSkipped: w.times_skipped ?? 0,
    });
  }

  const itemIdsByIndex = new Map<number, string>();
  cardItems.forEach((it, i) => itemIdsByIndex.set(i + 1, it.id));

  const cardTaggedOffers = cardItems.map((it, i) => ({
    index: i + 1,
    name: it.name,
    rarity: it.rarity ?? "",
    type: it.type ?? "",
    cost: it.cost ?? null,
    description: it.description ?? "",
    tags: tagCard(
      { name: it.name },
      deckState,
      cardItems.filter((s) => s.id !== it.id).map((s) => ({ name: s.name })),
      (context.deckCards ?? []).map((c) => ({ name: c.name })),
    ),
  }));

  const cardScored = scoreCardOffers({
    offers: cardTaggedOffers,
    deckState,
    communityTierById: communityTierMap,
    winRatesById,
    itemIdsByIndex,
  });

  const goldBudget = body.goldBudget ?? context.gold;
  const potionCount = context.potionNames.length;
  const act = (context.act >= 1 && context.act <= 3 ? context.act : 1) as 1 | 2 | 3;

  const nonCardScored = scoreShopNonCards({
    items: nonCardItems.map((it, i) => ({
      itemId: it.id,
      itemName: it.name,
      itemIndex: cardItems.length + i + 1,
      cost: it.cost ?? 0,
      description: it.description ?? "",
    })),
    act,
    goldBudget,
    potionCount,
  });

  // Merge into unified rankings by tierValue desc.
  type MergedEntry = {
    itemId: string;
    itemName: string;
    itemIndex: number;
    tier: TierLetter;
    tierValue: number;
    reasoning: string;
    affordable?: boolean;
  };
  const merged: MergedEntry[] = [
    ...cardScored.offers.map((o) => ({
      itemId: o.itemId,
      itemName: o.itemName,
      itemIndex: o.itemIndex,
      tier: o.tier,
      tierValue: o.tierValue,
      reasoning: o.reasoning,
    })),
    ...nonCardScored.map((n) => ({
      itemId: n.itemId,
      itemName: n.itemName,
      itemIndex: n.itemIndex,
      tier: n.tier,
      tierValue: n.tierValue,
      reasoning: n.reasoning,
      affordable: n.affordable,
    })),
  ];
  merged.sort((a, b) => (b.tierValue - a.tierValue) || (a.itemIndex - b.itemIndex));

  const rankings: CardEvaluation[] = merged.map((m, i) => ({
    itemId: m.itemId,
    itemName: m.itemName,
    itemIndex: m.itemIndex,
    rank: i + 1,
    tier: m.tier,
    tierValue: m.tierValue,
    synergyScore: 50,
    confidence: 90,
    recommendation:
      i === 0 && m.tierValue >= 4 ? "strong_pick" : m.tierValue >= 4 ? "good_pick" : "skip",
    reasoning: m.reasoning,
    source: "claude",
  }));

  const evaluation: CardRewardEvaluation = {
    rankings,
    skipRecommended: rankings.every((r) => r.tierValue < 4),
    skipReasoning:
      rankings.every((r) => r.tierValue < 4) ? "No shop item clears B-tier" : null,
    coaching: {
      reasoning: {
        deckState: `${context.deckSize}-card deck, ${deckState.archetypes.committed ?? "uncommitted"}`,
        commitment: `Act ${act}; ${deckState.archetypes.committed ?? "archetypes still open"}`,
      },
      headline:
        rankings[0] && rankings[0].tierValue >= 4
          ? `Buy ${rankings[0].itemName} — ${rankings[0].reasoning}`
          : `Save gold — nothing clears B-tier`,
      confidence: 0.9,
      keyTradeoffs: [],
      teachingCallouts: [],
    },
    // @ts-expect-error augmenting response with scoredOffers telemetry (Task 12 schema update)
    compliance: {
      scoredOffers: [
        ...cardScored.offers.map((o) => ({
          itemId: o.itemId,
          rank: o.rank,
          tier: o.tier,
          tierValue: o.tierValue,
          breakdown: o.breakdown,
        })),
      ],
    },
  };

  return NextResponse.json(evaluation);
}
```

Delete the existing LLM call for `type === "shop"`, whether it's in the shared `try { const result = await generateText({...}) }` block or a shop-specific fallback. After this edit, the card/shop path should have no `generateText` call for `card_reward` or `shop`.

Add the import at the top of `route.ts`:

```ts
import { scoreShopNonCards } from "@sts2/shared/evaluation/shop/score-non-cards";
```

- [ ] **Step 2: Run web tests and build**

Run: `pnpm --filter @sts2/web test`
Expected: PASS.

Run: `pnpm --filter @sts2/web build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/evaluate/route.ts
git commit -m "feat(shop): route uses card scorer + non-card ranker, no LLM"
```

---

## Task 11: Retire card-reward + shop post-eval weights

**Files:**
- Modify: `packages/shared/evaluation/post-eval-weights.ts`
- Modify: `apps/web/src/app/api/evaluate/route.ts`

Delete `applyCardRewardWeights` and `applyShopWeights` (no longer reachable — the LLM path is gone). Delete the `card_reward` / `shop` branches inside `applyPostEvalWeights`. Keep `adjustTier`, `buildWeightContext`, `preEvalRestWeights`, `applyRestWeights`, `reconcileSkipRecommended` — all still in use by rest-site / other eval paths.

Also drop the calls to `applyPostEvalWeights`, `reconcileSkipRecommended`, and `adjustTierByDelta` inside the card/shop branches in `route.ts` — scorer output is already authoritative.

- [ ] **Step 1: Trim `post-eval-weights.ts`**

Delete `applyCardRewardWeights` (the whole function), delete `applyShopWeights`, and remove the `if (wctx.evalType === "card_reward") { ... }` / `else if (wctx.evalType === "shop") { ... }` branches in `applyPostEvalWeights`. The simplified entry point becomes:

```ts
export function applyPostEvalWeights(
  evaluation: CardRewardEvaluation,
  wctx: WeightContext,
  itemDescriptions?: Map<number, string>
): void {
  // Card_reward and shop paths no longer pass through post-eval weights —
  // the scorer is authoritative. Rest-site and other paths call `apply...`
  // helpers directly instead of going through this dispatcher.
  void evaluation;
  void wctx;
  void itemDescriptions;
}
```

Leave `preEvalRestWeights` and `applyRestWeights` in place. Leave `reconcileSkipRecommended` in place (rest-site hooks still call it).

- [ ] **Step 2: Strip the calls in `route.ts`**

Find the card/shop tail in `route.ts` that currently calls `applyPostEvalWeights`, win-rate tier adjustments, and `reconcileSkipRecommended`. Delete those calls — the scorer path replaces them. The `logEvaluation` call for each ranking still fires (it's logging; keep it).

- [ ] **Step 3: Run tests and build**

Run: `pnpm --filter @sts2/web test`
Expected: all pass. Tests for `post-eval-weights.ts` that exercised the deleted branches need updating or removal; inspect test output and delete any test case that was asserting on the dead paths.

Run: `pnpm --filter @sts2/web build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/evaluation/post-eval-weights.ts apps/web/src/app/api/evaluate/route.ts packages/shared/evaluation/*.test.ts
git commit -m "chore(card-reward): retire card_reward + shop post-eval weight paths"
```

---

## Task 12: Add `scoredOffers` to `cardRewardCoachingSchema` / wire shape + telemetry

**Files:**
- Modify: `packages/shared/evaluation/card-reward-coach-schema.ts`
- Modify: `apps/web/src/app/api/evaluate/route.ts`
- Modify: `apps/desktop/src/services/evaluationApi.ts`

Same pattern Phase 4 used for map `scoredPaths`. Extend the `CardRewardEvaluation` runtime shape with optional `compliance.scoredOffers`, mirror that on the schema so the desktop's zod parse doesn't strip the telemetry, and drop the `@ts-expect-error` in the route.

- [ ] **Step 1: Write the schema failing test**

Append to `packages/shared/evaluation/card-reward-coach-schema.ts` tests (create the test file if it doesn't exist: `packages/shared/evaluation/card-reward-coach-schema.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { cardRewardCoachingSchema } from "./card-reward-coach-schema";

describe("cardRewardCoachingSchema", () => {
  it("preserves scoredOffers when attached via compliance", () => {
    const parsed = cardRewardCoachingSchema.parse({
      reasoning: { deck_state: "x", commitment: "y" },
      headline: "Pick X",
      confidence: 0.9,
      key_tradeoffs: [],
      teaching_callouts: [],
    });
    expect(parsed.headline).toBe("Pick X");
  });
});
```

The actual telemetry field lives on `CardRewardEvaluation` (wire-level), not on the LLM-facing coaching schema. The existing test above only validates the coaching schema stays intact. The runtime extension happens on `CardRewardEvaluation` in `types.ts`.

- [ ] **Step 2: Extend `CardRewardEvaluation` in `types.ts`**

Add the optional `compliance` field to `CardRewardEvaluation`:

```ts
export interface CardRewardEvaluation {
  rankings: CardEvaluation[];
  skipRecommended: boolean;
  skipReasoning: string | null;
  spendingPlan?: string | null;
  coaching?: {
    reasoning: { deckState: string; commitment: string };
    headline: string;
    confidence: number;
    keyTradeoffs: { position: number; upside: string; downside: string }[];
    teachingCallouts: { pattern: string; explanation: string }[];
  };
  compliance?: {
    scoredOffers?: {
      itemId: string;
      rank: number;
      tier: string;
      tierValue: number;
      breakdown: {
        baseTier: string;
        modifiers: { kind: string; delta: number; reason: string }[];
        adjustedTier: string;
        tierValue: number;
        topReason: string;
      };
    }[];
  };
}
```

- [ ] **Step 3: Remove the two `@ts-expect-error` directives in `route.ts`**

Delete the `@ts-expect-error` comments above both `compliance: { scoredOffers }` blocks added in Tasks 9 and 10. With the type extension in Step 2, these now type-check.

- [ ] **Step 4: Run tests + build**

Run: `pnpm --filter @sts2/web test`
Expected: PASS.

Run: `pnpm --filter @sts2/web build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/evaluation/card-reward-coach-schema.ts packages/shared/evaluation/card-reward-coach-schema.test.ts packages/shared/evaluation/types.ts apps/web/src/app/api/evaluate/route.ts
git commit -m "feat(card-reward): scoredOffers telemetry on CardRewardEvaluation"
```

---

## Task 13: Drop `CARD_REWARD_SCAFFOLD` + `card_reward` / `shop` TYPE_ADDENDA

**Files:**
- Modify: `packages/shared/evaluation/prompt-builder.ts`
- Modify: `apps/web/src/app/api/evaluate/route.ts`

With the LLM gone for card_reward and shop, the scaffold and type-addenda entries are dead. Delete them. Leave everything else in `prompt-builder.ts` intact (other eval types still use it).

- [ ] **Step 1: Delete `CARD_REWARD_SCAFFOLD`**

Remove the `export const CARD_REWARD_SCAFFOLD = ...` block from `prompt-builder.ts`. Then grep for any import:

Run: `grep -rn "CARD_REWARD_SCAFFOLD" apps packages --include="*.ts" --include="*.tsx"`

Expected: only the route's (now-dead) import line. Delete that import from `route.ts`.

- [ ] **Step 2: Delete the `card_reward` and `shop` entries in `TYPE_ADDENDA`**

In `prompt-builder.ts`, inside the `TYPE_ADDENDA: Record<string, string>` object, remove the `card_reward: ...` and `shop: ...` keys. Other keys (rest_site, event, ancient, etc.) stay.

- [ ] **Step 3: Run tests + build**

Run: `pnpm --filter @sts2/web test`
Expected: PASS.

Run: `pnpm --filter @sts2/web build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/evaluation/prompt-builder.ts apps/web/src/app/api/evaluate/route.ts
git commit -m "chore(card-reward): drop CARD_REWARD_SCAFFOLD and dead TYPE_ADDENDA entries"
```

---

## Task 14: Regression + integration tests

**Files:**
- Modify: `packages/shared/evaluation/card-reward/score-offers.test.ts`

Add a `describe("scoreCardOffers — regression")` block that reproduces past user-reported failure modes as scorer-level tests.

Representative fixtures to add:

1. **Act 1 basic deck + keystone offer** — deck is all strikes/defends with a viable archetype; scorer picks the keystone.
2. **Act 3 committed Ironclad + off-archetype card + on-archetype card** — scorer picks on-archetype even when off-archetype has higher community tier.
3. **Third copy of Strike offered** — duplicate penalty fires, tier drops.
4. **Community-A card with strong skip WR** — win-rate delta pulls it down.
5. **No viable pick in Act 1** — all-D community offers → skip recommended.

- [ ] **Step 1: Append regression tests**

Append to `score-offers.test.ts`:

```ts
describe("scoreCardOffers — regression (user-reported failures)", () => {
  it("Act 1 basic deck picks keystone over same-tier neutral card", () => {
    const offers = [
      offer(1, "Neutral", { role: "damage", keystoneFor: null, fitsArchetypes: [] }),
      offer(2, "Keystone", { role: "scaling", keystoneFor: "exhaust", fitsArchetypes: ["exhaust"] }),
    ];
    const result = scoreCardOffers({
      offers,
      deckState: deckState({
        act: 1,
        archetypes: { viable: [{ name: "exhaust", supportCount: 2, hasKeystone: false }], committed: null, orphaned: [] },
        engine: { hasScaling: false, hasBlockPayoff: false, hasRemovalMomentum: 0, hasDrawPower: false },
      }),
      communityTierById: new Map([
        ["1", tier("B")],
        ["2", tier("B")],
      ]),
      winRatesById: new Map(),
      itemIdsByIndex: new Map([[1, "1"], [2, "2"]]),
    });
    expect(result.offers[0].itemName).toBe("Keystone");
  });

  it("Act 3 committed deck picks on-archetype even if off-archetype has higher base tier", () => {
    const offers = [
      offer(1, "OffArch-A", { role: "damage", keystoneFor: null, fitsArchetypes: ["poison"] }),
      offer(2, "OnArch-B", { role: "damage", keystoneFor: null, fitsArchetypes: ["exhaust"] }),
    ];
    const result = scoreCardOffers({
      offers,
      deckState: deckState({
        act: 3,
        archetypes: { viable: [{ name: "exhaust", supportCount: 4, hasKeystone: true }], committed: "exhaust", orphaned: [] },
      }),
      communityTierById: new Map([
        ["1", tier("A")],
        ["2", tier("B")],
      ]),
      winRatesById: new Map(),
      itemIdsByIndex: new Map([[1, "1"], [2, "2"]]),
    });
    // OffArch: A(5) + off-archetype(-1) + act3-off(-1) = C(3). OnArch: B(4) + on-archetype(+1) = A(5).
    expect(result.offers[0].itemName).toBe("OnArch-B");
  });

  it("duplicate penalty drops a third copy below its community tier", () => {
    const offers = [offer(1, "Strike", { role: "damage", keystoneFor: null, fitsArchetypes: [], duplicatePenalty: true })];
    const result = scoreCardOffers({
      offers,
      deckState: deckState(),
      communityTierById: new Map([["1", tier("C")]]),
      winRatesById: new Map(),
      itemIdsByIndex: new Map([[1, "1"]]),
    });
    // C(3) + duplicate(-1) = D(2).
    expect(result.offers[0].tier).toBe("D");
  });

  it("win-rate delta pulls a B-tier card down when skip WR dominates", () => {
    const offers = [offer(1, "Meh", { role: "damage", keystoneFor: null, fitsArchetypes: [] })];
    const result = scoreCardOffers({
      offers,
      deckState: deckState(),
      communityTierById: new Map([["1", tier("B")]]),
      winRatesById: new Map([
        ["1", { pickWinRate: 0.30, skipWinRate: 0.55, timesPicked: 40, timesSkipped: 30 }],
      ]),
      itemIdsByIndex: new Map([[1, "1"]]),
    });
    // B(4) + WR skip(-1) = C(3).
    expect(result.offers[0].tier).toBe("C");
  });

  it("recommends skip in Act 1 when all offers are D-tier", () => {
    const offers = [offer(1, "A"), offer(2, "B"), offer(3, "C")];
    const result = scoreCardOffers({
      offers,
      deckState: deckState({ act: 1 }),
      communityTierById: new Map([
        ["1", tier("D")],
        ["2", tier("D")],
        ["3", tier("D")],
      ]),
      winRatesById: new Map(),
      itemIdsByIndex: new Map([[1, "1"], [2, "2"], [3, "3"]]),
    });
    expect(result.skipRecommended).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @sts2/web test -- score-offers`
Expected: PASS — 5 regression cases + earlier tests.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/evaluation/card-reward/score-offers.test.ts
git commit -m "test(card-reward): regression suite for user-reported scorer failures"
```

---

## Final Checklist

- [ ] All 14 tasks committed.
- [ ] `pnpm --filter @sts2/web test` — all pass.
- [ ] `pnpm --filter @sts2/desktop test` — all pass.
- [ ] `pnpm --filter @sts2/web build` — succeeds.
- [ ] Manual smoke: card reward on Act 1 Floor 3 with a viable archetype → scorer picks the archetype card.
- [ ] Manual smoke: shop in Act 2 with gold > removal cost → removal ranks S-tier.
- [ ] Push branch + open PR referencing #105.
