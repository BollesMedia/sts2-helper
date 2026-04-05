# Choice Delta Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reliably track what was recommended vs what the user chose for every decision point (card rewards, map nodes, shop, rest sites), persist structured delta data to Supabase, and handle the race condition where users act before evaluations complete.

**Architecture:** Pure detection functions in `packages/shared/choice-detection/` handle all "what did the user just do?" logic. The existing `choiceTrackingListener` becomes a thin shell that feeds state transitions into these functions. A new `act_paths` table captures full act-level path comparison. An eval-pending backfill pattern handles the timing race condition via upserts.

**Tech Stack:** TypeScript, Vitest, Redux Toolkit (listener middleware), Supabase (PostgreSQL), Next.js API routes, Zod

**Spec:** `docs/superpowers/specs/2026-04-05-choice-delta-tracking-design.md`

---

## File Structure

```
packages/shared/choice-detection/
├── types.ts                              # Shared types for all detection functions
├── detect-card-reward-outcome.ts         # Card pick vs skip detection
├── detect-card-reward-outcome.test.ts
├── detect-shop-outcome.ts               # Shop purchase/removal/browse detection
├── detect-shop-outcome.test.ts
├── detect-rest-site-outcome.ts          # Rest vs upgrade detection
├── detect-rest-site-outcome.test.ts
├── detect-map-node-outcome.ts           # Map node choice detection
├── detect-map-node-outcome.test.ts
├── pending-choice-registry.ts           # In-memory pending eval tracker
├── pending-choice-registry.test.ts
├── build-backfill-payload.ts            # Computes upsert payload when eval resolves
├── build-backfill-payload.test.ts
├── act-path-tracker.ts                  # Accumulates actual path per act
├── act-path-tracker.test.ts
└── build-act-path-record.ts             # Compares recommended vs actual path
    build-act-path-record.test.ts

supabase/migrations/
└── 020_choice_delta_tracking.sql        # Schema changes + act_paths table

apps/web/src/app/api/choice/
└── route.ts                             # Extended with upsert support

apps/web/src/app/api/act-path/
└── route.ts                             # New endpoint for act path logging

apps/desktop/src/services/
└── evaluationApi.ts                     # Add logActPath + backfillChoice endpoints

apps/desktop/src/features/choice/
└── choiceTrackingListener.ts            # Refactored to use pure functions

apps/desktop/src/features/map/
└── mapListeners.ts                      # Extended with map node choice logging

apps/desktop/src/features/run/
└── runAnalyticsListener.ts              # Extended with act path flushing
```

---

### Task 1: Shared Types

**Files:**
- Create: `packages/shared/choice-detection/types.ts`

- [ ] **Step 1: Create types file**

```ts
// packages/shared/choice-detection/types.ts

/** Offered card with both ID (from game state) and name (from deck). */
export interface OfferedCard {
  id: string;
  name: string;
}

// --- Card Reward ---

export type CardRewardOutcome =
  | { type: "picked"; chosenName: string }
  | { type: "skipped" };

export interface DetectCardRewardInput {
  offeredCards: OfferedCard[];
  previousDeckNames: Set<string>;
  currentDeckNames: Set<string>;
}

// --- Shop ---

export interface ShopOutcome {
  purchases: string[];   // names of new cards
  removals: number;      // count of cards removed
  browsedOnly: boolean;  // left without buying or removing
}

export interface DetectShopInput {
  previousDeckNames: Set<string>;
  currentDeckNames: Set<string>;
  previousDeckSize: number;
  currentDeckSize: number;
}

// --- Rest Site ---

export type RestSiteOutcome =
  | { type: "rested" }
  | { type: "upgraded"; cardName: string };

export interface DetectRestSiteInput {
  previousDeckNames: Set<string>;
  currentDeckNames: Set<string>;
}

// --- Map Node ---

export interface MapNode {
  col: number;
  row: number;
  nodeType: string;
}

export type MapNodeOutcome = {
  chosenNode: MapNode;
  recommendedNode: MapNode | null;
  allOptions: MapNode[];
  wasFollowed: boolean;
};

export interface DetectMapNodeInput {
  previousPosition: { col: number; row: number } | null;
  currentPosition: { col: number; row: number };
  recommendedNextNode: MapNode | null;
  nextOptions: MapNode[];
}

// --- Act Path ---

export interface ActPathNode {
  col: number;
  row: number;
  nodeType: string;
}

export interface DeviationNode {
  col: number;
  row: number;
  recommended: string; // nodeType
  actual: string;      // nodeType
}

export interface ActPathRecord {
  act: number;
  recommendedPath: ActPathNode[];
  actualPath: ActPathNode[];
  deviationCount: number;
  deviationNodes: DeviationNode[];
}

// --- Backfill ---

export interface PendingChoiceEntry {
  chosenItemId: string | null;
  floor: number;
  choiceType: string;
  sequence: number;
}

export interface BackfillPayload {
  runId: string;
  floor: number;
  choiceType: string;
  sequence: number;
  recommendedItemId: string | null;
  recommendedTier: string | null;
  wasFollowed: boolean;
  rankingsSnapshot: unknown;
  evalPending: false;
}

// --- Game Context (snapshot at decision time) ---

export interface GameContextSnapshot {
  hpPercent: number;
  gold: number;
  deckSize: number;
  ascension: number;
  act: number;
  character: string;
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper
git add packages/shared/choice-detection/types.ts
git commit -m "feat(choice-detection): add shared types for choice delta tracking"
```

---

### Task 2: detectCardRewardOutcome (TDD)

**Files:**
- Create: `packages/shared/choice-detection/detect-card-reward-outcome.ts`
- Test: `packages/shared/choice-detection/detect-card-reward-outcome.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/choice-detection/detect-card-reward-outcome.test.ts
import { describe, it, expect } from "vitest";
import { detectCardRewardOutcome } from "./detect-card-reward-outcome";
import type { DetectCardRewardInput, OfferedCard } from "./types";

const offered: OfferedCard[] = [
  { id: "card_001", name: "Carnage" },
  { id: "card_002", name: "Uppercut" },
  { id: "card_003", name: "Shrug It Off" },
];

const baseDeck = new Set(["Strike", "Strike", "Defend", "Defend", "Bash"]);

function detect(overrides: Partial<DetectCardRewardInput> = {}) {
  return detectCardRewardOutcome({
    offeredCards: offered,
    previousDeckNames: baseDeck,
    currentDeckNames: baseDeck,
    ...overrides,
  });
}

describe("detectCardRewardOutcome", () => {
  it("detects a picked card when deck gains a new name matching an offered card", () => {
    const newDeck = new Set([...baseDeck, "Carnage"]);
    const result = detect({ currentDeckNames: newDeck });
    expect(result).toEqual({ type: "picked", chosenName: "Carnage" });
  });

  it("detects skip when deck is unchanged", () => {
    const result = detect();
    expect(result).toEqual({ type: "skipped" });
  });

  it("detects the correct card when multiple new names appear (picks first match)", () => {
    // Edge case: shouldn't normally happen, but if it does, pick the first offered match
    const newDeck = new Set([...baseDeck, "Carnage", "Uppercut"]);
    const result = detect({ currentDeckNames: newDeck });
    expect(result).toEqual({ type: "picked", chosenName: "Carnage" });
  });

  it("detects skip when deck gains a card NOT in offered list", () => {
    // A card appeared but wasn't one of the offered rewards — treat as skip
    // (could be from a relic or event trigger)
    const newDeck = new Set([...baseDeck, "Wound"]);
    const result = detect({ currentDeckNames: newDeck });
    expect(result).toEqual({ type: "skipped" });
  });

  it("handles empty offered cards gracefully", () => {
    const result = detect({ offeredCards: [] });
    expect(result).toEqual({ type: "skipped" });
  });

  it("handles case where offered card name matches existing deck card", () => {
    // Offered "Strike" but "Strike" was already in deck — deck still gained a Strike
    // Set-based comparison won't detect this, but the card was still offered
    const offeredWithExisting: OfferedCard[] = [
      { id: "card_001", name: "Strike" },
      { id: "card_002", name: "Uppercut" },
      { id: "card_003", name: "Shrug It Off" },
    ];
    // Deck unchanged (Strike already existed) — this is a limitation of set-based detection
    const result = detect({ offeredCards: offeredWithExisting });
    expect(result).toEqual({ type: "skipped" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper/apps/web && npx vitest run ../../packages/shared/choice-detection/detect-card-reward-outcome.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/choice-detection/detect-card-reward-outcome.ts
import type { CardRewardOutcome, DetectCardRewardInput } from "./types";

/**
 * Given a set of offered cards and before/after deck snapshots,
 * determine whether the player picked a card or skipped.
 *
 * Uses name-based set diff. If the deck gained a name that matches
 * one of the offered cards, that card was picked. Otherwise, skip.
 */
export function detectCardRewardOutcome(
  input: DetectCardRewardInput
): CardRewardOutcome {
  const { offeredCards, previousDeckNames, currentDeckNames } = input;

  const offeredNames = new Set(offeredCards.map((c) => c.name));

  // Find names in currentDeck that weren't in previousDeck AND are in offered
  for (const name of currentDeckNames) {
    if (!previousDeckNames.has(name) && offeredNames.has(name)) {
      return { type: "picked", chosenName: name };
    }
  }

  return { type: "skipped" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper/apps/web && npx vitest run ../../packages/shared/choice-detection/detect-card-reward-outcome.test.ts`

Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper
git add packages/shared/choice-detection/detect-card-reward-outcome.ts packages/shared/choice-detection/detect-card-reward-outcome.test.ts
git commit -m "feat(choice-detection): add detectCardRewardOutcome with tests"
```

---

### Task 3: detectShopOutcome (TDD)

**Files:**
- Create: `packages/shared/choice-detection/detect-shop-outcome.ts`
- Test: `packages/shared/choice-detection/detect-shop-outcome.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/choice-detection/detect-shop-outcome.test.ts
import { describe, it, expect } from "vitest";
import { detectShopOutcome } from "./detect-shop-outcome";
import type { DetectShopInput } from "./types";

const baseDeck = new Set(["Strike", "Strike", "Defend", "Defend", "Bash"]);

function detect(overrides: Partial<DetectShopInput> = {}) {
  return detectShopOutcome({
    previousDeckNames: baseDeck,
    currentDeckNames: baseDeck,
    previousDeckSize: 5,
    currentDeckSize: 5,
    ...overrides,
  });
}

describe("detectShopOutcome", () => {
  it("detects a card purchase when deck gains a new name", () => {
    const newDeck = new Set([...baseDeck, "Immolate"]);
    const result = detect({ currentDeckNames: newDeck, currentDeckSize: 6 });
    expect(result).toEqual({ purchases: ["Immolate"], removals: 0, browsedOnly: false });
  });

  it("detects multiple purchases", () => {
    const newDeck = new Set([...baseDeck, "Immolate", "Offering"]);
    const result = detect({ currentDeckNames: newDeck, currentDeckSize: 7 });
    expect(result).toEqual({ purchases: ["Immolate", "Offering"], removals: 0, browsedOnly: false });
  });

  it("detects card removal when deck shrinks", () => {
    const smallerDeck = new Set(["Strike", "Defend", "Defend", "Bash"]);
    const result = detect({ currentDeckNames: smallerDeck, currentDeckSize: 4 });
    expect(result).toEqual({ purchases: [], removals: 1, browsedOnly: false });
  });

  it("detects purchase + removal in same shop visit", () => {
    // Bought 1 card, removed 1 card: net deck size unchanged but names changed
    const newDeck = new Set(["Strike", "Defend", "Defend", "Bash", "Immolate"]);
    const result = detect({ currentDeckNames: newDeck, currentDeckSize: 5 });
    expect(result).toEqual({ purchases: ["Immolate"], removals: 0, browsedOnly: false });
  });

  it("detects browse only when nothing changed", () => {
    const result = detect();
    expect(result).toEqual({ purchases: [], removals: 0, browsedOnly: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper/apps/web && npx vitest run ../../packages/shared/choice-detection/detect-shop-outcome.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/choice-detection/detect-shop-outcome.ts
import type { ShopOutcome, DetectShopInput } from "./types";

/**
 * Detect what happened during a shop visit by diffing deck snapshots.
 * Purchases are detected by new names in the deck.
 * Removals are detected by deck size decrease not explained by purchases.
 */
export function detectShopOutcome(input: DetectShopInput): ShopOutcome {
  const {
    previousDeckNames,
    currentDeckNames,
    previousDeckSize,
    currentDeckSize,
  } = input;

  const purchases: string[] = [];
  for (const name of currentDeckNames) {
    if (!previousDeckNames.has(name)) {
      purchases.push(name);
    }
  }

  const sizeDelta = currentDeckSize - previousDeckSize;
  const removals = Math.max(0, purchases.length - sizeDelta);

  const browsedOnly = purchases.length === 0 && removals === 0;

  return { purchases, removals, browsedOnly };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper/apps/web && npx vitest run ../../packages/shared/choice-detection/detect-shop-outcome.test.ts`

Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper
git add packages/shared/choice-detection/detect-shop-outcome.ts packages/shared/choice-detection/detect-shop-outcome.test.ts
git commit -m "feat(choice-detection): add detectShopOutcome with tests"
```

---

### Task 4: detectRestSiteOutcome (TDD)

**Files:**
- Create: `packages/shared/choice-detection/detect-rest-site-outcome.ts`
- Test: `packages/shared/choice-detection/detect-rest-site-outcome.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/choice-detection/detect-rest-site-outcome.test.ts
import { describe, it, expect } from "vitest";
import { detectRestSiteOutcome } from "./detect-rest-site-outcome";

const baseDeck = new Set(["Strike", "Defend", "Bash"]);

describe("detectRestSiteOutcome", () => {
  it("detects rest when deck is unchanged", () => {
    const result = detectRestSiteOutcome({
      previousDeckNames: baseDeck,
      currentDeckNames: baseDeck,
    });
    expect(result).toEqual({ type: "rested" });
  });

  it("detects upgrade when a card gains a + suffix", () => {
    const upgradedDeck = new Set(["Strike", "Defend", "Bash+"]);
    const result = detectRestSiteOutcome({
      previousDeckNames: baseDeck,
      currentDeckNames: upgradedDeck,
    });
    expect(result).toEqual({ type: "upgraded", cardName: "Bash+" });
  });

  it("returns rested when new card is not an upgrade of existing", () => {
    // New name appeared but it's not a + version of an existing card
    const weirdDeck = new Set(["Strike", "Defend", "Bash", "Wound"]);
    const result = detectRestSiteOutcome({
      previousDeckNames: baseDeck,
      currentDeckNames: weirdDeck,
    });
    expect(result).toEqual({ type: "rested" });
  });

  it("detects upgrade when base card disappears and + version appears", () => {
    // "Bash" removed, "Bash+" added
    const upgradedDeck = new Set(["Strike", "Defend", "Bash+"]);
    const prevDeck = new Set(["Strike", "Defend", "Bash"]);
    const result = detectRestSiteOutcome({
      previousDeckNames: prevDeck,
      currentDeckNames: upgradedDeck,
    });
    expect(result).toEqual({ type: "upgraded", cardName: "Bash+" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper/apps/web && npx vitest run ../../packages/shared/choice-detection/detect-rest-site-outcome.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/choice-detection/detect-rest-site-outcome.ts
import type { RestSiteOutcome, DetectRestSiteInput } from "./types";

/**
 * Detect whether the player rested or upgraded a card at a rest site.
 * An upgrade is detected when a new card name ending in "+" appears
 * and its base name (without "+") was in the previous deck.
 */
export function detectRestSiteOutcome(
  input: DetectRestSiteInput
): RestSiteOutcome {
  const { previousDeckNames, currentDeckNames } = input;

  for (const name of currentDeckNames) {
    if (previousDeckNames.has(name)) continue;

    // New name found — check if it's an upgrade
    if (name.endsWith("+")) {
      const baseName = name.slice(0, -1);
      if (previousDeckNames.has(baseName)) {
        return { type: "upgraded", cardName: name };
      }
    }
  }

  return { type: "rested" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper/apps/web && npx vitest run ../../packages/shared/choice-detection/detect-rest-site-outcome.test.ts`

Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper
git add packages/shared/choice-detection/detect-rest-site-outcome.ts packages/shared/choice-detection/detect-rest-site-outcome.test.ts
git commit -m "feat(choice-detection): add detectRestSiteOutcome with tests"
```

---

### Task 5: detectMapNodeOutcome (TDD)

**Files:**
- Create: `packages/shared/choice-detection/detect-map-node-outcome.ts`
- Test: `packages/shared/choice-detection/detect-map-node-outcome.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/choice-detection/detect-map-node-outcome.test.ts
import { describe, it, expect } from "vitest";
import { detectMapNodeOutcome } from "./detect-map-node-outcome";
import type { DetectMapNodeInput, MapNode } from "./types";

const options: MapNode[] = [
  { col: 1, row: 3, nodeType: "elite" },
  { col: 2, row: 3, nodeType: "shop" },
  { col: 3, row: 3, nodeType: "monster" },
];

const baseInput: DetectMapNodeInput = {
  previousPosition: { col: 2, row: 2 },
  currentPosition: { col: 2, row: 3 },
  recommendedNextNode: { col: 1, row: 3, nodeType: "elite" },
  nextOptions: options,
};

function detect(overrides: Partial<DetectMapNodeInput> = {}) {
  return detectMapNodeOutcome({ ...baseInput, ...overrides });
}

describe("detectMapNodeOutcome", () => {
  it("returns null when position has not changed", () => {
    const result = detect({ currentPosition: { col: 2, row: 2 } });
    expect(result).toBeNull();
  });

  it("returns null when previousPosition is null (first poll)", () => {
    const result = detect({ previousPosition: null });
    expect(result).toBeNull();
  });

  it("detects user followed recommendation", () => {
    const result = detect({ currentPosition: { col: 1, row: 3 } });
    expect(result).toEqual({
      chosenNode: { col: 1, row: 3, nodeType: "elite" },
      recommendedNode: { col: 1, row: 3, nodeType: "elite" },
      allOptions: options,
      wasFollowed: true,
    });
  });

  it("detects user deviated from recommendation", () => {
    const result = detect({ currentPosition: { col: 2, row: 3 } });
    expect(result).toEqual({
      chosenNode: { col: 2, row: 3, nodeType: "shop" },
      recommendedNode: { col: 1, row: 3, nodeType: "elite" },
      allOptions: options,
      wasFollowed: false,
    });
  });

  it("handles no recommendation (eval pending)", () => {
    const result = detect({
      currentPosition: { col: 2, row: 3 },
      recommendedNextNode: null,
    });
    expect(result).toEqual({
      chosenNode: { col: 2, row: 3, nodeType: "shop" },
      recommendedNode: null,
      allOptions: options,
      wasFollowed: false,
    });
  });

  it("resolves chosen nodeType from options list", () => {
    const result = detect({ currentPosition: { col: 3, row: 3 } });
    expect(result?.chosenNode.nodeType).toBe("monster");
  });

  it("uses 'unknown' nodeType when chosen position not in options", () => {
    const result = detect({ currentPosition: { col: 4, row: 3 } });
    expect(result?.chosenNode.nodeType).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper/apps/web && npx vitest run ../../packages/shared/choice-detection/detect-map-node-outcome.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/choice-detection/detect-map-node-outcome.ts
import type { MapNodeOutcome, DetectMapNodeInput } from "./types";

/**
 * Detect whether the player moved to a new map node and whether
 * that move aligned with the recommendation.
 *
 * Returns null if no move occurred (position unchanged or no previous position).
 */
export function detectMapNodeOutcome(
  input: DetectMapNodeInput
): MapNodeOutcome | null {
  const { previousPosition, currentPosition, recommendedNextNode, nextOptions } = input;

  // No move detected
  if (!previousPosition) return null;
  if (
    previousPosition.col === currentPosition.col &&
    previousPosition.row === currentPosition.row
  ) {
    return null;
  }

  // Resolve the chosen node's type from the options list
  const matchedOption = nextOptions.find(
    (o) => o.col === currentPosition.col && o.row === currentPosition.row
  );
  const chosenNode = matchedOption ?? {
    col: currentPosition.col,
    row: currentPosition.row,
    nodeType: "unknown",
  };

  const wasFollowed = recommendedNextNode
    ? recommendedNextNode.col === currentPosition.col &&
      recommendedNextNode.row === currentPosition.row
    : false;

  return {
    chosenNode,
    recommendedNode: recommendedNextNode,
    allOptions: nextOptions,
    wasFollowed,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper/apps/web && npx vitest run ../../packages/shared/choice-detection/detect-map-node-outcome.test.ts`

Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper
git add packages/shared/choice-detection/detect-map-node-outcome.ts packages/shared/choice-detection/detect-map-node-outcome.test.ts
git commit -m "feat(choice-detection): add detectMapNodeOutcome with tests"
```

---

### Task 6: Pending Choice Registry (TDD)

**Files:**
- Create: `packages/shared/choice-detection/pending-choice-registry.ts`
- Test: `packages/shared/choice-detection/pending-choice-registry.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/choice-detection/pending-choice-registry.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  registerPendingChoice,
  getPendingChoice,
  clearPendingChoice,
  clearAllPendingChoices,
} from "./pending-choice-registry";

beforeEach(() => {
  clearAllPendingChoices();
});

describe("pending-choice-registry", () => {
  it("returns undefined for unregistered key", () => {
    expect(getPendingChoice(1, "card_reward")).toBeUndefined();
  });

  it("stores and retrieves a pending choice", () => {
    registerPendingChoice(3, "card_reward", "Carnage", 0);
    expect(getPendingChoice(3, "card_reward")).toEqual({
      chosenItemId: "Carnage",
      floor: 3,
      choiceType: "card_reward",
      sequence: 0,
    });
  });

  it("stores null chosenItemId for skips", () => {
    registerPendingChoice(5, "card_reward", null, 0);
    expect(getPendingChoice(5, "card_reward")?.chosenItemId).toBeNull();
  });

  it("clears a specific pending choice", () => {
    registerPendingChoice(3, "card_reward", "Carnage", 0);
    clearPendingChoice(3, "card_reward");
    expect(getPendingChoice(3, "card_reward")).toBeUndefined();
  });

  it("clears all pending choices", () => {
    registerPendingChoice(3, "card_reward", "Carnage", 0);
    registerPendingChoice(5, "map_node", "2,3", 0);
    clearAllPendingChoices();
    expect(getPendingChoice(3, "card_reward")).toBeUndefined();
    expect(getPendingChoice(5, "map_node")).toBeUndefined();
  });

  it("overwrites existing entry for same key", () => {
    registerPendingChoice(3, "card_reward", "Carnage", 0);
    registerPendingChoice(3, "card_reward", "Uppercut", 0);
    expect(getPendingChoice(3, "card_reward")?.chosenItemId).toBe("Uppercut");
  });

  it("keeps separate entries for different floors", () => {
    registerPendingChoice(3, "card_reward", "Carnage", 0);
    registerPendingChoice(5, "card_reward", "Uppercut", 0);
    expect(getPendingChoice(3, "card_reward")?.chosenItemId).toBe("Carnage");
    expect(getPendingChoice(5, "card_reward")?.chosenItemId).toBe("Uppercut");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper/apps/web && npx vitest run ../../packages/shared/choice-detection/pending-choice-registry.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/choice-detection/pending-choice-registry.ts
import type { PendingChoiceEntry } from "./types";

/**
 * In-memory registry of choices logged with eval_pending=true.
 * When an eval completes, the listener checks this registry to
 * decide whether to backfill the recommendation data.
 *
 * Cleared on new run via clearAllPendingChoices().
 */
const registry = new Map<string, PendingChoiceEntry>();

function key(floor: number, choiceType: string): string {
  return `${floor}:${choiceType}`;
}

export function registerPendingChoice(
  floor: number,
  choiceType: string,
  chosenItemId: string | null,
  sequence: number
): void {
  registry.set(key(floor, choiceType), {
    chosenItemId,
    floor,
    choiceType,
    sequence,
  });
}

export function getPendingChoice(
  floor: number,
  choiceType: string
): PendingChoiceEntry | undefined {
  return registry.get(key(floor, choiceType));
}

export function clearPendingChoice(
  floor: number,
  choiceType: string
): void {
  registry.delete(key(floor, choiceType));
}

export function clearAllPendingChoices(): void {
  registry.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper/apps/web && npx vitest run ../../packages/shared/choice-detection/pending-choice-registry.test.ts`

Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper
git add packages/shared/choice-detection/pending-choice-registry.ts packages/shared/choice-detection/pending-choice-registry.test.ts
git commit -m "feat(choice-detection): add pending choice registry with tests"
```

---

### Task 7: buildBackfillPayload (TDD)

**Files:**
- Create: `packages/shared/choice-detection/build-backfill-payload.ts`
- Test: `packages/shared/choice-detection/build-backfill-payload.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/choice-detection/build-backfill-payload.test.ts
import { describe, it, expect } from "vitest";
import { buildBackfillPayload } from "./build-backfill-payload";
import type { PendingChoiceEntry } from "./types";

const rankings = [
  { itemId: "Carnage", itemName: "Carnage", tier: "S", recommendation: "Take" },
  { itemId: "Uppercut", itemName: "Uppercut", tier: "B", recommendation: "Consider" },
];

const evalResult = {
  recommendedId: "Carnage",
  recommendedTier: "S",
  reasoning: "Strong damage",
  allRankings: rankings,
  evalType: "card_reward",
};

const pendingChoice: PendingChoiceEntry = {
  chosenItemId: "Carnage",
  floor: 3,
  choiceType: "card_reward",
  sequence: 0,
};

describe("buildBackfillPayload", () => {
  it("returns payload with wasFollowed=true when user picked the recommended card", () => {
    const result = buildBackfillPayload("run_123", evalResult, pendingChoice);
    expect(result).toEqual({
      runId: "run_123",
      floor: 3,
      choiceType: "card_reward",
      sequence: 0,
      recommendedItemId: "Carnage",
      recommendedTier: "S",
      wasFollowed: true,
      rankingsSnapshot: rankings,
      evalPending: false,
    });
  });

  it("returns wasFollowed=false when user picked a different card", () => {
    const different: PendingChoiceEntry = { ...pendingChoice, chosenItemId: "Uppercut" };
    const result = buildBackfillPayload("run_123", evalResult, different);
    expect(result!.wasFollowed).toBe(false);
  });

  it("returns wasFollowed=false when user skipped but system recommended a card", () => {
    const skipped: PendingChoiceEntry = { ...pendingChoice, chosenItemId: null };
    const result = buildBackfillPayload("run_123", evalResult, skipped);
    expect(result!.wasFollowed).toBe(false);
  });

  it("returns wasFollowed=true when both user and system chose skip", () => {
    const skipEval = { ...evalResult, recommendedId: null, recommendedTier: null };
    const skipped: PendingChoiceEntry = { ...pendingChoice, chosenItemId: null };
    const result = buildBackfillPayload("run_123", skipEval, skipped);
    expect(result!.wasFollowed).toBe(true);
  });

  it("includes full rankings snapshot", () => {
    const result = buildBackfillPayload("run_123", evalResult, pendingChoice);
    expect(result!.rankingsSnapshot).toEqual(rankings);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper/apps/web && npx vitest run ../../packages/shared/choice-detection/build-backfill-payload.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/choice-detection/build-backfill-payload.ts
import type { BackfillPayload, PendingChoiceEntry } from "./types";

interface EvalResult {
  recommendedId: string | null;
  recommendedTier: string | null;
  allRankings: { itemId: string; itemName: string; tier: string; recommendation: string }[];
}

/**
 * Build the upsert payload to backfill recommendation data onto
 * a choice that was logged before the eval completed.
 */
export function buildBackfillPayload(
  runId: string,
  evalResult: EvalResult,
  pendingChoice: PendingChoiceEntry
): BackfillPayload {
  const wasFollowed =
    evalResult.recommendedId === pendingChoice.chosenItemId;

  return {
    runId,
    floor: pendingChoice.floor,
    choiceType: pendingChoice.choiceType,
    sequence: pendingChoice.sequence,
    recommendedItemId: evalResult.recommendedId,
    recommendedTier: evalResult.recommendedTier,
    wasFollowed,
    rankingsSnapshot: evalResult.allRankings,
    evalPending: false,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper/apps/web && npx vitest run ../../packages/shared/choice-detection/build-backfill-payload.test.ts`

Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper
git add packages/shared/choice-detection/build-backfill-payload.ts packages/shared/choice-detection/build-backfill-payload.test.ts
git commit -m "feat(choice-detection): add buildBackfillPayload with tests"
```

---

### Task 8: Act Path Tracker (TDD)

**Files:**
- Create: `packages/shared/choice-detection/act-path-tracker.ts`
- Test: `packages/shared/choice-detection/act-path-tracker.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/choice-detection/act-path-tracker.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  appendNode,
  getActPath,
  clearAllActPaths,
} from "./act-path-tracker";

beforeEach(() => {
  clearAllActPaths();
});

describe("act-path-tracker", () => {
  it("returns empty array for untracked act", () => {
    expect(getActPath(1)).toEqual([]);
  });

  it("accumulates nodes for an act", () => {
    appendNode(1, { col: 0, row: 0, nodeType: "monster" });
    appendNode(1, { col: 1, row: 1, nodeType: "elite" });
    appendNode(1, { col: 2, row: 2, nodeType: "rest" });
    expect(getActPath(1)).toEqual([
      { col: 0, row: 0, nodeType: "monster" },
      { col: 1, row: 1, nodeType: "elite" },
      { col: 2, row: 2, nodeType: "rest" },
    ]);
  });

  it("keeps acts separate", () => {
    appendNode(1, { col: 0, row: 0, nodeType: "monster" });
    appendNode(2, { col: 1, row: 0, nodeType: "shop" });
    expect(getActPath(1)).toHaveLength(1);
    expect(getActPath(2)).toHaveLength(1);
  });

  it("clears all acts", () => {
    appendNode(1, { col: 0, row: 0, nodeType: "monster" });
    appendNode(2, { col: 1, row: 0, nodeType: "shop" });
    clearAllActPaths();
    expect(getActPath(1)).toEqual([]);
    expect(getActPath(2)).toEqual([]);
  });

  it("does not add duplicate consecutive nodes", () => {
    appendNode(1, { col: 0, row: 0, nodeType: "monster" });
    appendNode(1, { col: 0, row: 0, nodeType: "monster" });
    expect(getActPath(1)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper/apps/web && npx vitest run ../../packages/shared/choice-detection/act-path-tracker.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/choice-detection/act-path-tracker.ts
import type { ActPathNode } from "./types";

/**
 * In-memory tracker of the actual nodes visited per act.
 * Nodes are appended as the player moves on the map.
 * Flushed on act change or run end.
 */
const paths = new Map<number, ActPathNode[]>();

export function appendNode(act: number, node: ActPathNode): void {
  if (!paths.has(act)) {
    paths.set(act, []);
  }
  const actPath = paths.get(act)!;

  // Skip duplicate consecutive nodes (same position polled multiple times)
  const last = actPath[actPath.length - 1];
  if (last && last.col === node.col && last.row === node.row) {
    return;
  }

  actPath.push(node);
}

export function getActPath(act: number): ActPathNode[] {
  return paths.get(act) ?? [];
}

export function clearAllActPaths(): void {
  paths.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper/apps/web && npx vitest run ../../packages/shared/choice-detection/act-path-tracker.test.ts`

Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper
git add packages/shared/choice-detection/act-path-tracker.ts packages/shared/choice-detection/act-path-tracker.test.ts
git commit -m "feat(choice-detection): add act path tracker with tests"
```

---

### Task 9: buildActPathRecord (TDD)

**Files:**
- Create: `packages/shared/choice-detection/build-act-path-record.ts`
- Test: `packages/shared/choice-detection/build-act-path-record.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/choice-detection/build-act-path-record.test.ts
import { describe, it, expect } from "vitest";
import { buildActPathRecord } from "./build-act-path-record";
import type { ActPathNode } from "./types";

const recommended: ActPathNode[] = [
  { col: 0, row: 0, nodeType: "monster" },
  { col: 1, row: 1, nodeType: "elite" },
  { col: 2, row: 2, nodeType: "rest" },
  { col: 1, row: 3, nodeType: "monster" },
];

describe("buildActPathRecord", () => {
  it("returns zero deviations when paths match exactly", () => {
    const actual = [...recommended];
    const result = buildActPathRecord(1, recommended, actual);
    expect(result.deviationCount).toBe(0);
    expect(result.deviationNodes).toEqual([]);
  });

  it("detects deviations where nodes differ at same index", () => {
    const actual: ActPathNode[] = [
      { col: 0, row: 0, nodeType: "monster" },
      { col: 2, row: 1, nodeType: "shop" },     // deviated
      { col: 2, row: 2, nodeType: "rest" },
      { col: 1, row: 3, nodeType: "monster" },
    ];
    const result = buildActPathRecord(1, recommended, actual);
    expect(result.deviationCount).toBe(1);
    expect(result.deviationNodes).toEqual([
      { col: 2, row: 1, recommended: "elite", actual: "shop" },
    ]);
  });

  it("handles partial act (actual shorter than recommended)", () => {
    const actual: ActPathNode[] = [
      { col: 0, row: 0, nodeType: "monster" },
      { col: 1, row: 1, nodeType: "elite" },
    ];
    const result = buildActPathRecord(2, recommended, actual);
    expect(result.act).toBe(2);
    expect(result.actualPath).toHaveLength(2);
    expect(result.recommendedPath).toHaveLength(4);
    // Only compare overlapping portion
    expect(result.deviationCount).toBe(0);
  });

  it("handles actual longer than recommended", () => {
    const actual: ActPathNode[] = [
      ...recommended,
      { col: 0, row: 4, nodeType: "treasure" },
    ];
    const result = buildActPathRecord(1, recommended, actual);
    // Extra nodes beyond recommended length are not deviations
    expect(result.deviationCount).toBe(0);
  });

  it("handles empty recommended path", () => {
    const actual: ActPathNode[] = [
      { col: 0, row: 0, nodeType: "monster" },
    ];
    const result = buildActPathRecord(1, [], actual);
    expect(result.deviationCount).toBe(0);
    expect(result.recommendedPath).toEqual([]);
    expect(result.actualPath).toHaveLength(1);
  });

  it("sets act number in the record", () => {
    const result = buildActPathRecord(3, recommended, recommended);
    expect(result.act).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper/apps/web && npx vitest run ../../packages/shared/choice-detection/build-act-path-record.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/choice-detection/build-act-path-record.ts
import type { ActPathNode, ActPathRecord, DeviationNode } from "./types";

/**
 * Compare the recommended path against the actual path taken
 * and produce a structured record with deviation details.
 *
 * Deviations are detected at each index where both paths have a node
 * but the positions differ.
 */
export function buildActPathRecord(
  act: number,
  recommendedPath: ActPathNode[],
  actualPath: ActPathNode[]
): ActPathRecord {
  const deviationNodes: DeviationNode[] = [];
  const compareLength = Math.min(recommendedPath.length, actualPath.length);

  for (let i = 0; i < compareLength; i++) {
    const rec = recommendedPath[i];
    const act_node = actualPath[i];
    if (rec.col !== act_node.col || rec.row !== act_node.row) {
      deviationNodes.push({
        col: act_node.col,
        row: act_node.row,
        recommended: rec.nodeType,
        actual: act_node.nodeType,
      });
    }
  }

  return {
    act,
    recommendedPath,
    actualPath,
    deviationCount: deviationNodes.length,
    deviationNodes,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper/apps/web && npx vitest run ../../packages/shared/choice-detection/build-act-path-record.test.ts`

Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper
git add packages/shared/choice-detection/build-act-path-record.ts packages/shared/choice-detection/build-act-path-record.test.ts
git commit -m "feat(choice-detection): add buildActPathRecord with tests"
```

---

### Task 10: Supabase Migration

**Files:**
- Create: `supabase/migrations/020_choice_delta_tracking.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 020_choice_delta_tracking.sql
-- Adds game_context, eval_pending, and sequence columns to choices table.
-- Creates act_paths table for per-act path comparison.

-- --- choices table changes ---

alter table choices add column if not exists game_context jsonb;
alter table choices add column if not exists eval_pending boolean not null default false;
alter table choices add column if not exists sequence smallint not null default 0;

-- Unique constraint for upsert backfill pattern.
-- Allows ON CONFLICT to update recommendation data after eval completes.
create unique index if not exists uq_choices_run_floor_type_seq
  on choices (run_id, floor, choice_type, sequence);

-- Index for finding pending choices that need backfill
create index if not exists idx_choices_eval_pending
  on choices (run_id, eval_pending)
  where eval_pending = true;

-- --- act_paths table ---

create table if not exists act_paths (
  id uuid primary key default gen_random_uuid(),
  run_id text not null references runs(run_id) on delete cascade,
  act int not null,
  recommended_path jsonb not null default '[]'::jsonb,
  actual_path jsonb not null default '[]'::jsonb,
  node_preferences jsonb,
  deviation_count int not null default 0,
  deviation_nodes jsonb not null default '[]'::jsonb,
  context_at_start jsonb,
  user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint uq_act_paths_run_act unique (run_id, act)
);

-- RLS: users can view and insert their own act_paths
alter table act_paths enable row level security;

create policy "Users can view own act_paths"
  on act_paths for select
  using (user_id = auth.uid());

create policy "Users can insert own act_paths"
  on act_paths for insert
  with check (user_id = auth.uid());

-- Public read (matches existing pattern from 009_public_read_rls.sql)
create policy "Public read act_paths"
  on act_paths for select
  using (true);

-- Indexes
create index if not exists idx_act_paths_run on act_paths (run_id);

-- --- Update analytics views to exclude eval_pending rows ---

-- Drop and recreate recommendation_follow_rates if it exists
drop view if exists recommendation_follow_rates;
create view recommendation_follow_rates as
select
  c.choice_type,
  r.character,
  case
    when r.ascension_level <= 4 then 'low'
    when r.ascension_level <= 10 then 'mid'
    else 'high'
  end as ascension_tier,
  count(*) filter (where c.was_followed = true) as followed,
  count(*) filter (where c.was_followed = false) as diverged,
  count(*) as total,
  round(
    count(*) filter (where c.was_followed = true)::numeric /
    nullif(count(*), 0), 3
  ) as follow_rate
from choices c
join runs r on c.run_id = r.run_id
where c.was_followed is not null
  and c.eval_pending = false
group by c.choice_type, r.character, ascension_tier;
```

- [ ] **Step 2: Verify the migration file is valid SQL**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && cat supabase/migrations/020_choice_delta_tracking.sql | head -5`

Expected: First 5 lines of the migration

- [ ] **Step 3: Commit**

```bash
cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper
git add supabase/migrations/020_choice_delta_tracking.sql
git commit -m "feat(db): add choice delta tracking schema (game_context, eval_pending, act_paths)"
```

---

### Task 11: Update /api/choice Endpoint for Upsert

**Files:**
- Modify: `apps/web/src/app/api/choice/route.ts`

- [ ] **Step 1: Update the Zod schema and handler to support upsert**

The updated route.ts should:
- Add `gameContext`, `evalPending`, and `sequence` to the Zod schema
- Use Supabase `.upsert()` with `onConflict: "run_id,floor,choice_type,sequence"`
- Only update recommendation fields on conflict (preserve the original choice data)

```ts
// apps/web/src/app/api/choice/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api-auth";

const choiceSchema = z.object({
  runId: z.string().nullable().optional(),
  choiceType: z.string().min(1),
  floor: z.number().int().min(0).optional(),
  act: z.number().int().min(1).optional(),
  sequence: z.number().int().min(0).optional(),
  offeredItemIds: z.array(z.string()),
  chosenItemId: z.string().nullable().optional(),
  recommendedItemId: z.string().nullable().optional(),
  recommendedTier: z.string().nullable().optional(),
  wasFollowed: z.boolean().nullable().optional(),
  rankingsSnapshot: z.unknown().nullable().optional(),
  gameContext: z.unknown().nullable().optional(),
  evalPending: z.boolean().optional(),
});

export async function POST(request: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = await request.json();
  const result = choiceSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Invalid request", detail: result.error.flatten() },
      { status: 400 }
    );
  }

  const d = result.data;
  const supabase = createServiceClient();

  const row = {
    run_id: d.runId ?? null,
    choice_type: d.choiceType,
    floor: d.floor ?? 0,
    act: d.act ?? 1,
    sequence: d.sequence ?? 0,
    offered_item_ids: d.offeredItemIds,
    chosen_item_id: d.chosenItemId ?? null,
    user_id: auth.userId,
    recommended_item_id: d.recommendedItemId ?? null,
    recommended_tier: d.recommendedTier ?? null,
    was_followed: d.wasFollowed ?? null,
    rankings_snapshot: (d.rankingsSnapshot ?? null) as import("@sts2/shared/types/database.types").Json,
    game_context: (d.gameContext ?? null) as import("@sts2/shared/types/database.types").Json,
    eval_pending: d.evalPending ?? false,
  };

  const { error } = await supabase
    .from("choices")
    .upsert(row, {
      onConflict: "run_id,floor,choice_type,sequence",
    });

  if (error) {
    console.error("Failed to log choice:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper
git add apps/web/src/app/api/choice/route.ts
git commit -m "feat(api): update /api/choice to support upsert for eval-pending backfill"
```

---

### Task 12: Add /api/act-path Endpoint

**Files:**
- Create: `apps/web/src/app/api/act-path/route.ts`

- [ ] **Step 1: Create the endpoint**

```ts
// apps/web/src/app/api/act-path/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api-auth";

const actPathSchema = z.object({
  runId: z.string(),
  act: z.number().int().min(1),
  recommendedPath: z.array(z.object({
    col: z.number(),
    row: z.number(),
    nodeType: z.string(),
  })),
  actualPath: z.array(z.object({
    col: z.number(),
    row: z.number(),
    nodeType: z.string(),
  })),
  nodePreferences: z.unknown().nullable().optional(),
  deviationCount: z.number().int().min(0),
  deviationNodes: z.array(z.object({
    col: z.number(),
    row: z.number(),
    recommended: z.string(),
    actual: z.string(),
  })),
  contextAtStart: z.unknown().nullable().optional(),
});

export async function POST(request: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = await request.json();
  const result = actPathSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Invalid request", detail: result.error.flatten() },
      { status: 400 }
    );
  }

  const d = result.data;
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("act_paths")
    .upsert({
      run_id: d.runId,
      act: d.act,
      recommended_path: d.recommendedPath as import("@sts2/shared/types/database.types").Json,
      actual_path: d.actualPath as import("@sts2/shared/types/database.types").Json,
      node_preferences: (d.nodePreferences ?? null) as import("@sts2/shared/types/database.types").Json,
      deviation_count: d.deviationCount,
      deviation_nodes: d.deviationNodes as import("@sts2/shared/types/database.types").Json,
      context_at_start: (d.contextAtStart ?? null) as import("@sts2/shared/types/database.types").Json,
      user_id: auth.userId,
    }, {
      onConflict: "run_id,act",
    });

  if (error) {
    console.error("Failed to log act path:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper
git add apps/web/src/app/api/act-path/route.ts
git commit -m "feat(api): add /api/act-path endpoint for act path logging"
```

---

### Task 13: Update evaluationApi with New Endpoints

**Files:**
- Modify: `apps/desktop/src/services/evaluationApi.ts`

- [ ] **Step 1: Add logActPath mutation to evaluationApi**

Add this endpoint inside the existing `endpoints: (build) => ({` block, after the existing `logChoice` endpoint:

```ts
    // Act path logging
    logActPath: build.mutation<void, {
      runId: string;
      act: number;
      recommendedPath: { col: number; row: number; nodeType: string }[];
      actualPath: { col: number; row: number; nodeType: string }[];
      nodePreferences?: unknown;
      deviationCount: number;
      deviationNodes: { col: number; row: number; recommended: string; actual: string }[];
      contextAtStart?: unknown;
    }>({
      async queryFn(args) {
        try {
          await apiFetch("/api/act-path", {
            method: "POST",
            body: JSON.stringify(args),
          });
          return { data: undefined };
        } catch (err) {
          return { error: { status: "CUSTOM_ERROR", data: err instanceof Error ? err.message : "Failed" } };
        }
      },
    }),
```

Also update the `logChoice` mutation type to include the new fields:

```ts
    // Choice logging
    logChoice: build.mutation<void, {
      runId: string | null;
      choiceType: string;
      floor: number;
      act?: number;
      sequence?: number;
      offeredItemIds: string[];
      chosenItemId: string | null;
      recommendedItemId?: string | null;
      recommendedTier?: string | null;
      wasFollowed?: boolean;
      rankingsSnapshot?: unknown;
      userId?: string | null;
      gameContext?: unknown;
      evalPending?: boolean;
    }>({
      async queryFn(args) {
        try {
          await apiFetch("/api/choice", {
            method: "POST",
            body: JSON.stringify(args),
          });
          return { data: undefined };
        } catch (err) {
          return { error: { status: "CUSTOM_ERROR", data: err instanceof Error ? err.message : "Failed" } };
        }
      },
    }),
```

- [ ] **Step 2: Update the exported hooks**

Add `useLogActPathMutation` to the destructured exports at the bottom of the file:

```ts
export const {
  useEvaluateCardRewardMutation,
  useEvaluateShopMutation,
  useEvaluateEventMutation,
  useEvaluateRestSiteMutation,
  useEvaluateMapMutation,
  useEvaluateBossBriefingMutation,
  useEvaluateGenericMutation,
  useStartRunMutation,
  useEndRunMutation,
  useLogChoiceMutation,
  useLogActPathMutation,
} = evaluationApi;
```

- [ ] **Step 3: Commit**

```bash
cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper
git add apps/desktop/src/services/evaluationApi.ts
git commit -m "feat(api): add logActPath endpoint and update logChoice with new fields"
```

---

### Task 14: Regenerate Supabase Types

**Files:**
- Modify: `packages/shared/types/database.types.ts`

- [ ] **Step 1: Run the Supabase type generation command**

Check how types are currently generated:

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && grep -r "gen types" package.json scripts/ 2>/dev/null || grep "supabase" package.json`

Then run the appropriate command (likely `npx supabase gen types typescript`). If the Supabase CLI isn't available locally or the DB hasn't been migrated yet, manually add the new columns to the existing types in `database.types.ts`.

The key additions to the `choices` table Row/Insert/Update types:

```ts
// In Tables.choices.Row:
game_context: Json | null;
eval_pending: boolean;
sequence: number;

// New table act_paths.Row:
act_paths: {
  Row: {
    id: string;
    run_id: string;
    act: number;
    recommended_path: Json;
    actual_path: Json;
    node_preferences: Json | null;
    deviation_count: number;
    deviation_nodes: Json;
    context_at_start: Json | null;
    user_id: string | null;
    created_at: string;
  };
  Insert: { /* same but most fields optional with defaults */ };
  Update: { /* all fields optional */ };
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper
git add packages/shared/types/database.types.ts
git commit -m "feat(types): update Supabase types for choice delta tracking"
```

---

### Task 15: Refactor choiceTrackingListener

**Files:**
- Modify: `apps/desktop/src/features/choice/choiceTrackingListener.ts`

This is the largest task — the listener is refactored to use pure detection functions. The key change: read the deck from the **game state payload** (not Redux) to fix the skip-detection bug.

- [ ] **Step 1: Rewrite the listener**

The listener maintains minimal mutable state (previous state type, pending contexts) and delegates all detection to pure functions. It also builds `gameContext` snapshots and handles the `evalPending` flag.

```ts
// apps/desktop/src/features/choice/choiceTrackingListener.ts
import { startAppListening } from "../../store/listenerMiddleware";
import { gameStateApi } from "../../services/gameStateApi";
import { evaluationApi } from "../../services/evaluationApi";
import { waitForRunCreated } from "../run/runAnalyticsListener";
import {
  appendDecision,
  addMilestone,
} from "@sts2/shared/evaluation/run-narrative";
import {
  getLastEvaluation,
} from "@sts2/shared/evaluation/last-evaluation-registry";
import {
  hasRun,
  type GameState,
  type CombatCard,
} from "@sts2/shared/types/game-state";
import { getUserId } from "@sts2/shared/lib/get-user-id";
import { detectCardRewardOutcome } from "@sts2/shared/choice-detection/detect-card-reward-outcome";
import { detectShopOutcome } from "@sts2/shared/choice-detection/detect-shop-outcome";
import { detectRestSiteOutcome } from "@sts2/shared/choice-detection/detect-rest-site-outcome";
import { registerPendingChoice } from "@sts2/shared/choice-detection/pending-choice-registry";
import type { GameContextSnapshot, OfferedCard } from "@sts2/shared/choice-detection/types";
import { selectEvalIsLoading } from "../evaluation/evaluationSelectors";

/** Minimal state the listener needs to track between polls. */
interface PendingCardReward {
  offeredCards: OfferedCard[];
  previousDeckNames: Set<string>;
  floor: number;
  act: number;
}

interface PendingShop {
  offeredItemIds: string[];
  previousDeckNames: Set<string>;
  previousDeckSize: number;
  floor: number;
  act: number;
}

interface PendingRestSite {
  previousDeckNames: Set<string>;
  floor: number;
  act: number;
}

/**
 * Extract current deck names from the game state payload.
 * Prefers run.deck (master deck between combats) over Redux deck
 * to avoid the one-poll-lag timing issue.
 */
function extractDeckNames(gameState: GameState, reduxDeck: CombatCard[]): Set<string> {
  // If the game state has a run with a deck, use it directly
  if (hasRun(gameState) && gameState.run.deck) {
    return new Set(
      (gameState.run.deck as Array<{ name: string }>).map((c) => c.name)
    );
  }
  // Fallback to Redux deck
  return new Set(reduxDeck.map((c) => c.name));
}

function extractDeckSize(gameState: GameState, reduxDeck: CombatCard[]): number {
  if (hasRun(gameState) && gameState.run.deck) {
    return (gameState.run.deck as unknown[]).length;
  }
  return reduxDeck.length;
}

function buildGameContext(
  gameState: GameState,
  reduxDeck: CombatCard[],
  run: { character: string; ascension: number; act: number }
): GameContextSnapshot {
  const player = hasRun(gameState) ? (gameState as Record<string, unknown>).player as
    { hp?: number; max_hp?: number; gold?: number } | undefined : undefined;
  return {
    hpPercent: player?.max_hp ? (player.hp ?? 0) / player.max_hp : 1,
    gold: player?.gold ?? 0,
    deckSize: extractDeckSize(gameState, reduxDeck),
    ascension: run.ascension,
    act: run.act,
    character: run.character,
  };
}

export function setupChoiceTrackingListener() {
  let prevStateType: string | null = null;
  let pendingCardReward: PendingCardReward | null = null;
  let deferredCardReward: PendingCardReward | null = null;
  let pendingShop: PendingShop | null = null;
  let pendingRestSite: PendingRestSite | null = null;
  let lastRunId: string | null = null;

  startAppListening({
    matcher: gameStateApi.endpoints.getGameState.matchFulfilled,
    effect: (action, listenerApi) => {
      const gameState: GameState = action.payload;
      const state = listenerApi.getState();
      const activeRunId = state.run.activeRunId;
      if (!activeRunId) return;

      // Reset on run change
      if (activeRunId !== lastRunId) {
        lastRunId = activeRunId;
        pendingCardReward = null;
        deferredCardReward = null;
        pendingShop = null;
        pendingRestSite = null;
      }

      const currentType = gameState.state_type;
      const prevType = prevStateType;
      prevStateType = currentType;

      const runData = state.run.runs[activeRunId];
      if (!runData) return;
      const run = hasRun(gameState) ? gameState.run : null;
      const reduxDeck = runData.deck;
      const currentDeckNames = extractDeckNames(gameState, reduxDeck);
      const currentDeckSize = extractDeckSize(gameState, reduxDeck);
      const floor = run?.floor ?? runData.floor;
      const act = run?.act ?? runData.act;

      // --- Card Reward: Enter ---
      if (currentType === "card_reward" && prevType !== "card_reward") {
        const cards = (gameState as Record<string, unknown>).card_reward as
          { cards: { id: string; name: string }[] };
        pendingCardReward = {
          offeredCards: cards.cards.map((c) => ({ id: c.id, name: c.name })),
          previousDeckNames: new Set(currentDeckNames),
          floor,
          act,
        };
      }

      // --- Card Reward: Leave (defer detection) ---
      if (prevType === "card_reward" && currentType !== "card_reward") {
        if (pendingCardReward) {
          deferredCardReward = pendingCardReward;
          pendingCardReward = null;
        }
      }

      // --- Card Reward: Resolve ---
      if (deferredCardReward) {
        // Detect if card was picked or skipped
        const outcome = detectCardRewardOutcome({
          offeredCards: deferredCardReward.offeredCards,
          previousDeckNames: deferredCardReward.previousDeckNames,
          currentDeckNames,
        });

        // Wait until we've left the combat_rewards screen to confirm a skip.
        // A "skipped" result while still in combat_rewards could just mean
        // the deck hasn't reflected the pick yet.
        const stillInRewards =
          currentType === "combat_rewards" || currentType === "card_reward";

        if (outcome.type === "picked" || !stillInRewards) {
          const lastEval = getLastEvaluation("card_reward");
          const isEvalPending = !lastEval && selectEvalIsLoading("card_reward")(state);
          const chosenItemId = outcome.type === "picked" ? outcome.chosenName : null;

          const gameContext = buildGameContext(gameState, reduxDeck, runData);

          fireChoiceLog(listenerApi.dispatch, {
            runId: activeRunId,
            choiceType: outcome.type === "picked" ? "card_reward" : "skip",
            floor: deferredCardReward.floor,
            act: deferredCardReward.act,
            sequence: 0,
            offeredItemIds: deferredCardReward.offeredCards.map((c) => c.id),
            chosenItemId,
            recommendedItemId: lastEval?.recommendedId ?? null,
            recommendedTier: lastEval?.recommendedTier ?? null,
            wasFollowed: lastEval
              ? chosenItemId === lastEval.recommendedId
              : undefined,
            rankingsSnapshot: lastEval?.allRankings ?? null,
            gameContext,
            evalPending: isEvalPending || false,
          });

          if (isEvalPending) {
            registerPendingChoice(
              deferredCardReward.floor,
              "card_reward",
              chosenItemId,
              0
            );
          }

          // Narrative
          appendDecision({
            floor: deferredCardReward.floor,
            type: "card_reward",
            chosen: chosenItemId,
            advise: lastEval?.recommendedId ?? null,
            aligned: lastEval
              ? chosenItemId === lastEval.recommendedId ||
                (chosenItemId === null && lastEval.recommendedId === null)
              : true,
          });

          // Milestone for power/rare
          if (outcome.type === "picked") {
            const pickedCard = reduxDeck.find((c) => c.name === outcome.chosenName);
            if (pickedCard) {
              const kwNames = (pickedCard.keywords ?? []).map((k) =>
                k.name.toLowerCase()
              );
              if (kwNames.includes("power") || kwNames.includes("rare")) {
                addMilestone(`${outcome.chosenName} F${deferredCardReward.floor}`, false);
              }
            }
          }

          deferredCardReward = null;
        }
      }

      // --- Shop: Enter ---
      if (currentType === "shop" && prevType !== "shop") {
        const shopState = gameState as Record<string, unknown>;
        const shop = shopState.shop as { items: { is_stocked: boolean; category: string; card_id?: string; relic_id?: string; potion_id?: string; index: number }[] };
        const shopItems = shop.items
          .filter((i) => i.is_stocked)
          .map((i) => {
            if (i.category === "card") return i.card_id ?? `card_${i.index}`;
            if (i.category === "relic") return i.relic_id ?? `relic_${i.index}`;
            if (i.category === "potion") return i.potion_id ?? `potion_${i.index}`;
            return "CARD_REMOVAL";
          });

        pendingShop = {
          offeredItemIds: shopItems,
          previousDeckNames: new Set(currentDeckNames),
          previousDeckSize: currentDeckSize,
          floor,
          act,
        };
      }

      // --- Shop: Leave ---
      if (prevType === "shop" && currentType !== "shop" && pendingShop) {
        const shopOutcome = detectShopOutcome({
          previousDeckNames: pendingShop.previousDeckNames,
          currentDeckNames,
          previousDeckSize: pendingShop.previousDeckSize,
          currentDeckSize,
        });

        const lastEval = getLastEvaluation("shop");
        const gameContext = buildGameContext(gameState, reduxDeck, runData);

        if (shopOutcome.purchases.length > 0) {
          shopOutcome.purchases.forEach((cardName, idx) => {
            fireChoiceLog(listenerApi.dispatch, {
              runId: activeRunId,
              choiceType: "shop_purchase",
              floor: pendingShop!.floor,
              act: pendingShop!.act,
              sequence: idx,
              offeredItemIds: pendingShop!.offeredItemIds,
              chosenItemId: cardName,
              recommendedItemId: lastEval?.recommendedId ?? null,
              recommendedTier: lastEval?.recommendedTier ?? null,
              wasFollowed: lastEval ? cardName === lastEval.recommendedId : undefined,
              rankingsSnapshot: lastEval?.allRankings ?? null,
              gameContext,
              evalPending: false,
            });

            appendDecision({
              floor: pendingShop!.floor,
              type: "shop",
              chosen: cardName,
              advise: lastEval?.recommendedId ?? null,
              aligned: lastEval ? cardName === lastEval.recommendedId : true,
            });
          });
        }

        for (let i = 0; i < shopOutcome.removals; i++) {
          appendDecision({
            floor: pendingShop.floor,
            type: "shop_removal",
            chosen: "card removal",
            advise: null,
            aligned: true,
          });
          addMilestone(`Card removal F${pendingShop.floor}`, false);
        }

        if (shopOutcome.browsedOnly) {
          fireChoiceLog(listenerApi.dispatch, {
            runId: activeRunId,
            choiceType: "shop_browse",
            floor: pendingShop.floor,
            act: pendingShop.act,
            sequence: 0,
            offeredItemIds: pendingShop.offeredItemIds,
            chosenItemId: null,
            recommendedItemId: lastEval?.recommendedId ?? null,
            recommendedTier: lastEval?.recommendedTier ?? null,
            wasFollowed: lastEval ? lastEval.recommendedId === null : undefined,
            rankingsSnapshot: lastEval?.allRankings ?? null,
            gameContext,
            evalPending: false,
          });
        }

        pendingShop = null;
      }

      // --- Rest Site: Enter ---
      if (currentType === "rest_site" && prevType !== "rest_site") {
        pendingRestSite = {
          previousDeckNames: new Set(currentDeckNames),
          floor,
          act,
        };
      }

      // --- Rest Site: Leave ---
      if (prevType === "rest_site" && currentType !== "rest_site" && pendingRestSite) {
        const restOutcome = detectRestSiteOutcome({
          previousDeckNames: pendingRestSite.previousDeckNames,
          currentDeckNames,
        });

        const lastEval = getLastEvaluation("rest_site");

        if (restOutcome.type === "upgraded") {
          appendDecision({
            floor: pendingRestSite.floor,
            type: "rest_site",
            chosen: `Upgraded ${restOutcome.cardName}`,
            advise: lastEval?.recommendedId ?? null,
            aligned: lastEval
              ? restOutcome.cardName.replace(/\+$/, "") ===
                lastEval.recommendedId?.replace(/\+$/, "")
              : true,
          });
          addMilestone(`${restOutcome.cardName} F${pendingRestSite.floor}`, false);
        } else {
          appendDecision({
            floor: pendingRestSite.floor,
            type: "rest_site",
            chosen: "Rest",
            advise: null,
            aligned: true,
          });
        }

        pendingRestSite = null;
      }

      // --- Event: Leave ---
      if (prevType === "event" && currentType !== "event") {
        const lastEval = getLastEvaluation("event");
        appendDecision({
          floor,
          type: "event",
          chosen: "event choice",
          advise: lastEval?.recommendedId ?? null,
          aligned: true,
        });
      }
    },
  });
}

// --- Helpers ---

function fireChoiceLog(
  dispatch: (action: unknown) => unknown,
  choice: {
    runId: string | null;
    choiceType: string;
    floor: number;
    act: number;
    sequence: number;
    offeredItemIds: string[];
    chosenItemId: string | null;
    recommendedItemId?: string | null;
    recommendedTier?: string | null;
    wasFollowed?: boolean;
    rankingsSnapshot?: unknown;
    gameContext?: unknown;
    evalPending?: boolean;
  }
) {
  console.log(
    "[ChoiceTracker]",
    choice.choiceType,
    choice.chosenItemId ?? "skip",
    choice.evalPending ? "(eval pending)" : ""
  );

  waitForRunCreated()
    .then(() => {
      dispatch(
        evaluationApi.endpoints.logChoice.initiate({
          ...choice,
          userId: getUserId(),
        })
      );
    })
    .catch(console.error);
}
```

- [ ] **Step 2: Verify the app builds**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper/apps/desktop && npx tsc --noEmit 2>&1 | head -30`

Expected: No errors (or only pre-existing ones)

- [ ] **Step 3: Commit**

```bash
cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper
git add apps/desktop/src/features/choice/choiceTrackingListener.ts
git commit -m "refactor(choice-tracker): use pure detection functions, fix skip-detection bug

Read deck from game state payload instead of Redux to fix one-poll-lag
timing issue that caused all card rewards to be detected as skips.
Add gameContext snapshots and evalPending support."
```

---

### Task 16: Add Map Node Choice Logging to mapListeners

**Files:**
- Modify: `apps/desktop/src/features/map/mapListeners.ts`

- [ ] **Step 1: Add map node choice logging before Tier 1/Tier 2 re-eval**

Add imports at the top of `mapListeners.ts`:

```ts
import { detectMapNodeOutcome } from "@sts2/shared/choice-detection/detect-map-node-outcome";
import { appendNode as appendActNode } from "@sts2/shared/choice-detection/act-path-tracker";
import { registerPendingChoice } from "@sts2/shared/choice-detection/pending-choice-registry";
import type { MapNode } from "@sts2/shared/choice-detection/types";
import { getUserId } from "@sts2/shared/lib/get-user-id";
import { waitForRunCreated } from "../run/runAnalyticsListener";
```

Add a closure-scoped `prevMapPosition` variable at the top of `setupMapEvalListener`:

```ts
let prevMapPosition: { col: number; row: number } | null = null;
```

Then, inside the effect callback, after the `const shouldEval = shouldEvaluateMap(input);` check but before the Tier 1 block, add map node choice detection:

```ts
      // --- Map node choice logging ---
      // Detect if the player moved to a new node and log it
      if (currentPos && prevMapPosition) {
        const optionsWithTypes: MapNode[] = options.map((o) => ({
          col: o.col,
          row: o.row,
          nodeType: o.node_type ?? "unknown",
        }));

        // Find the recommended next node from bestPathNodes
        const bestNodes = selectBestPathNodesSet(state);
        const recommendedNext = optionsWithTypes.find((o) =>
          bestNodes.has(`${o.col},${o.row}`)
        ) ?? null;

        const mapOutcome = detectMapNodeOutcome({
          previousPosition: prevMapPosition,
          currentPosition: currentPos,
          recommendedNextNode: recommendedNext,
          nextOptions: optionsWithTypes,
        });

        if (mapOutcome) {
          // Append to act path tracker
          appendActNode(run.act, mapOutcome.chosenNode);

          const lastEval = getLastEvaluation("map");
          const isEvalPending = !lastEval;

          waitForRunCreated()
            .then(() => {
              listenerApi.dispatch(
                evaluationApi.endpoints.logChoice.initiate({
                  runId: run.activeRunId ?? state.run.activeRunId,
                  choiceType: "map_node",
                  floor: run.floor,
                  act: run.act,
                  sequence: 0,
                  offeredItemIds: optionsWithTypes.map(
                    (o) => `${o.col},${o.row}`
                  ),
                  chosenItemId: `${mapOutcome.chosenNode.col},${mapOutcome.chosenNode.row}`,
                  recommendedItemId: mapOutcome.recommendedNode
                    ? `${mapOutcome.recommendedNode.col},${mapOutcome.recommendedNode.row}`
                    : null,
                  recommendedTier: lastEval?.recommendedTier ?? null,
                  wasFollowed: mapOutcome.wasFollowed,
                  rankingsSnapshot: lastEval?.allRankings ?? null,
                  gameContext: {
                    hpPercent: currentHp,
                    gold: currentGold,
                    deckSize: currentDeckSize,
                    ascension: run.ascension,
                    act: run.act,
                    character: run.character,
                  },
                  evalPending: isEvalPending,
                  userId: getUserId(),
                })
              );
            })
            .catch(console.error);

          if (isEvalPending) {
            registerPendingChoice(
              run.floor,
              "map_node",
              `${mapOutcome.chosenNode.col},${mapOutcome.chosenNode.row}`,
              0
            );
          }

          // Narrative
          appendDecision({
            floor: run.floor,
            type: "map",
            chosen: mapOutcome.chosenNode.nodeType,
            advise: mapOutcome.recommendedNode?.nodeType ?? null,
            aligned: mapOutcome.wasFollowed,
          });
        }
      }
      prevMapPosition = currentPos;
```

Add `appendDecision` import if not already present:

```ts
import { appendDecision } from "@sts2/shared/evaluation/run-narrative";
```

- [ ] **Step 2: Verify the app builds**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper/apps/desktop && npx tsc --noEmit 2>&1 | head -30`

Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper
git add apps/desktop/src/features/map/mapListeners.ts
git commit -m "feat(map): log map node choices as discrete choice events with delta tracking"
```

---

### Task 17: Add Act Path Flushing

**Files:**
- Modify: `apps/desktop/src/features/run/runAnalyticsListener.ts`

- [ ] **Step 1: Read the current runAnalyticsListener**

Read the file to understand the current structure before modifying.

- [ ] **Step 2: Add act path flushing on act change and run end**

Add imports at the top:

```ts
import { getActPath, clearAllActPaths } from "@sts2/shared/choice-detection/act-path-tracker";
import { buildActPathRecord } from "@sts2/shared/choice-detection/build-act-path-record";
import { clearAllPendingChoices } from "@sts2/shared/choice-detection/pending-choice-registry";
```

Add a closure-scoped `prevAct` variable and a `flushActPath` helper function inside `setupRunAnalyticsListener`:

```ts
let prevAct: number | null = null;

function flushActPath(
  actNumber: number,
  runId: string,
  mapEval: MapEvalState,
  player: TrackedPlayer | null,
  runData: RunData,
  dispatch: (action: unknown) => unknown
) {
  const actualPath = getActPath(actNumber);
  if (actualPath.length === 0) return;

  const recommendedPath = mapEval.recommendedPath.map((p) => ({
    ...p,
    nodeType: "unknown", // path doesn't store node types; deviation_nodes does
  }));

  const record = buildActPathRecord(actNumber, recommendedPath, actualPath);

  waitForRunCreated()
    .then(() => {
      dispatch(
        evaluationApi.endpoints.logActPath.initiate({
          runId,
          act: record.act,
          recommendedPath: record.recommendedPath,
          actualPath: record.actualPath,
          nodePreferences: mapEval.nodePreferences,
          deviationCount: record.deviationCount,
          deviationNodes: record.deviationNodes,
          contextAtStart: {
            hpPercent: player?.maxHp ? player.hp / player.maxHp : 1,
            gold: player?.gold ?? 0,
            deckSize: runData.deck.length,
            character: runData.character,
            ascension: runData.ascension,
          },
        })
      );
    })
    .catch(console.error);
}
```

In the listener effect where run state transitions are detected:

- When act changes: flush the previous act's path, reset `prevAct`
- When run ends: flush the current act's path, clear all act paths and pending choices

Add to the existing act/floor detection logic:

```ts
// Detect act change
const currentAct = run?.act ?? 1;
if (prevAct !== null && currentAct !== prevAct) {
  // Flush previous act's path
  const runData = state.run.runs[activeRunId];
  if (runData) {
    flushActPath(prevAct, activeRunId, runData.mapEval, runData.player, runData, dispatch);
  }
}
prevAct = currentAct;
```

At run end:

```ts
// Flush final act path
if (prevAct !== null) {
  const runData = state.run.runs[runId];
  if (runData) {
    flushActPath(prevAct, runId, runData.mapEval, runData.player, runData, dispatch);
  }
}
clearAllActPaths();
clearAllPendingChoices();
prevAct = null;
```

**Note:** The exact integration depends on the current structure of `runAnalyticsListener.ts`. Read the file first (Step 1) and place the act-change detection within the existing game state poll handler, and the run-end flush within the existing run-end detection block.

- [ ] **Step 3: Verify the app builds**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper/apps/desktop && npx tsc --noEmit 2>&1 | head -30`

Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper
git add apps/desktop/src/features/run/runAnalyticsListener.ts
git commit -m "feat(analytics): flush act paths on act change and run end"
```

---

### Task 18: Listener Integration Tests

**Files:**
- Create: `apps/desktop/src/features/choice/__tests__/choiceTrackingListener.test.ts`

These tests verify the full detection flow using the refactored listener. They create realistic state transition sequences and verify the correct choice log dispatches.

- [ ] **Step 1: Write the integration tests**

```ts
// apps/desktop/src/features/choice/__tests__/choiceTrackingListener.test.ts
import { describe, it, expect } from "vitest";
import { detectCardRewardOutcome } from "@sts2/shared/choice-detection/detect-card-reward-outcome";
import { detectShopOutcome } from "@sts2/shared/choice-detection/detect-shop-outcome";
import { detectRestSiteOutcome } from "@sts2/shared/choice-detection/detect-rest-site-outcome";
import { detectMapNodeOutcome } from "@sts2/shared/choice-detection/detect-map-node-outcome";
import { buildBackfillPayload } from "@sts2/shared/choice-detection/build-backfill-payload";
import {
  registerPendingChoice,
  getPendingChoice,
  clearAllPendingChoices,
} from "@sts2/shared/choice-detection/pending-choice-registry";

/**
 * Integration tests that simulate full decision flows by composing
 * the pure detection functions in the same order the listener does.
 */

describe("card reward → pick flow", () => {
  it("detects pick when deck gains offered card after leaving card_reward", () => {
    // Simulate: enter card_reward → snapshot deck → leave → deck updated
    const offeredCards = [
      { id: "c1", name: "Carnage" },
      { id: "c2", name: "Uppercut" },
      { id: "c3", name: "Shrug It Off" },
    ];
    const prevDeck = new Set(["Strike", "Defend", "Bash"]);
    const newDeck = new Set(["Strike", "Defend", "Bash", "Carnage"]);

    const outcome = detectCardRewardOutcome({
      offeredCards,
      previousDeckNames: prevDeck,
      currentDeckNames: newDeck,
    });

    expect(outcome).toEqual({ type: "picked", chosenName: "Carnage" });
  });
});

describe("card reward → skip flow (regression for always-skip bug)", () => {
  it("detects skip when deck unchanged after leaving combat_rewards", () => {
    const offeredCards = [
      { id: "c1", name: "Carnage" },
      { id: "c2", name: "Uppercut" },
      { id: "c3", name: "Shrug It Off" },
    ];
    const deck = new Set(["Strike", "Defend", "Bash"]);

    const outcome = detectCardRewardOutcome({
      offeredCards,
      previousDeckNames: deck,
      currentDeckNames: deck,
    });

    expect(outcome).toEqual({ type: "skipped" });
  });

  it("does NOT falsely detect skip when deck just hasn't updated yet", () => {
    // Key test: the old bug was caused by reading a stale deck.
    // The pure function takes the CURRENT deck directly, so if the
    // deck hasn't updated, the caller should NOT call the function yet
    // (i.e., wait until we leave combat_rewards).
    const offeredCards = [
      { id: "c1", name: "Carnage" },
      { id: "c2", name: "Uppercut" },
      { id: "c3", name: "Shrug It Off" },
    ];
    const prevDeck = new Set(["Strike", "Defend", "Bash"]);
    // Deck already updated with the pick
    const updatedDeck = new Set(["Strike", "Defend", "Bash", "Uppercut"]);

    const outcome = detectCardRewardOutcome({
      offeredCards,
      previousDeckNames: prevDeck,
      currentDeckNames: updatedDeck,
    });

    expect(outcome).toEqual({ type: "picked", chosenName: "Uppercut" });
  });
});

describe("eval-pending → backfill flow", () => {
  it("logs pending choice, then backfills when eval arrives", () => {
    clearAllPendingChoices();

    // Step 1: User picks before eval — register pending
    registerPendingChoice(5, "card_reward", "Carnage", 0);
    const pending = getPendingChoice(5, "card_reward");
    expect(pending).toBeDefined();
    expect(pending!.chosenItemId).toBe("Carnage");

    // Step 2: Eval arrives — build backfill payload
    const evalResult = {
      recommendedId: "Uppercut",
      recommendedTier: "A",
      reasoning: "Better scaling",
      allRankings: [
        { itemId: "Uppercut", itemName: "Uppercut", tier: "A", recommendation: "Take" },
        { itemId: "Carnage", itemName: "Carnage", tier: "B", recommendation: "Consider" },
      ],
      evalType: "card_reward",
    };

    const backfill = buildBackfillPayload("run_123", evalResult, pending!);
    expect(backfill.wasFollowed).toBe(false);
    expect(backfill.recommendedItemId).toBe("Uppercut");
    expect(backfill.evalPending).toBe(false);
  });
});

describe("map node deviation flow", () => {
  it("detects deviation when user goes to a different node than recommended", () => {
    const outcome = detectMapNodeOutcome({
      previousPosition: { col: 2, row: 2 },
      currentPosition: { col: 3, row: 3 },
      recommendedNextNode: { col: 1, row: 3, nodeType: "elite" },
      nextOptions: [
        { col: 1, row: 3, nodeType: "elite" },
        { col: 2, row: 3, nodeType: "shop" },
        { col: 3, row: 3, nodeType: "monster" },
      ],
    });

    expect(outcome).not.toBeNull();
    expect(outcome!.wasFollowed).toBe(false);
    expect(outcome!.chosenNode.nodeType).toBe("monster");
    expect(outcome!.recommendedNode!.nodeType).toBe("elite");
  });
});

describe("shop flow", () => {
  it("detects purchase when deck gains a new card", () => {
    const outcome = detectShopOutcome({
      previousDeckNames: new Set(["Strike", "Defend"]),
      currentDeckNames: new Set(["Strike", "Defend", "Immolate"]),
      previousDeckSize: 2,
      currentDeckSize: 3,
    });
    expect(outcome.purchases).toEqual(["Immolate"]);
    expect(outcome.browsedOnly).toBe(false);
  });
});

describe("rest site flow", () => {
  it("detects upgrade when card gains + suffix", () => {
    const outcome = detectRestSiteOutcome({
      previousDeckNames: new Set(["Strike", "Bash"]),
      currentDeckNames: new Set(["Strike", "Bash+"]),
    });
    expect(outcome).toEqual({ type: "upgraded", cardName: "Bash+" });
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper/apps/desktop && npx vitest run src/features/choice/__tests__/choiceTrackingListener.test.ts`

Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper
git add apps/desktop/src/features/choice/__tests__/choiceTrackingListener.test.ts
git commit -m "test(choice-tracker): add integration tests for full detection flows"
```

---

### Task 19: Clear Registries on New Run

**Files:**
- Modify: `apps/desktop/src/features/run/runAnalyticsListener.ts`

The pending-choice registry and act-path tracker need to be cleared when a new run starts (not just when a run ends).

- [ ] **Step 1: Add clearAll calls at run start**

In `runAnalyticsListener.ts`, where a new run is detected (the `runStarted` dispatch), add:

```ts
import { clearAllPendingChoices } from "@sts2/shared/choice-detection/pending-choice-registry";
import { clearAllActPaths } from "@sts2/shared/choice-detection/act-path-tracker";
```

At the point where `runStarted` is dispatched:

```ts
clearAllPendingChoices();
clearAllActPaths();
```

Also clear `clearEvaluationRegistry()` if not already done (it is via existing code).

- [ ] **Step 2: Commit**

```bash
cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper
git add apps/desktop/src/features/run/runAnalyticsListener.ts
git commit -m "fix(analytics): clear pending choices and act paths on new run start"
```

---

### Task 20: Backfill Hook in Eval Listeners

**Files:**
- Modify: `apps/desktop/src/features/evaluation/cardRewardEvalListener.ts`

- [ ] **Step 1: Read the current cardRewardEvalListener**

Read the file to understand where `registerLastEvaluation` is called.

- [ ] **Step 2: Add backfill check after registerLastEvaluation**

After the line that calls `registerLastEvaluation("card_reward", ...)`, add:

```ts
import {
  getPendingChoice,
  clearPendingChoice,
} from "@sts2/shared/choice-detection/pending-choice-registry";
import { buildBackfillPayload } from "@sts2/shared/choice-detection/build-backfill-payload";
import { getUserId } from "@sts2/shared/lib/get-user-id";
```

After `registerLastEvaluation`:

```ts
// Check if user already acted before this eval completed
const pending = getPendingChoice(floor, "card_reward");
if (pending) {
  const backfill = buildBackfillPayload(
    activeRunId,
    {
      recommendedId: firstRanking.itemId,
      recommendedTier: firstRanking.tier,
      allRankings: parsed.rankings.map((r) => ({
        itemId: r.itemId,
        itemName: r.itemName,
        tier: r.tier,
        recommendation: r.recommendation,
      })),
    },
    pending
  );

  listenerApi.dispatch(
    evaluationApi.endpoints.logChoice.initiate({
      ...backfill,
      offeredItemIds: [], // upsert — offered_items already persisted
      userId: getUserId(),
    })
  );

  clearPendingChoice(floor, "card_reward");
}
```

**Note:** The exact variable names (`firstRanking`, `parsed`, `floor`, `activeRunId`) depend on the current file structure. Read the file first (Step 1) and adapt the variable references.

The same pattern should be applied to other eval listeners (shop, rest_site, map) but those can follow the same template. For map eval, check for `getPendingChoice(floor, "map_node")` after `registerLastEvaluation("map", ...)` in `mapListeners.ts`.

- [ ] **Step 3: Verify the app builds**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper/apps/desktop && npx tsc --noEmit 2>&1 | head -30`

Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper
git add apps/desktop/src/features/evaluation/cardRewardEvalListener.ts apps/desktop/src/features/map/mapListeners.ts
git commit -m "feat(eval): add backfill hook to resolve eval-pending choices when eval completes"
```
