# Card Reward Coach (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-04-20-card-reward-coach-design.md`

**Goal:** Add deck-state enrichment + per-card tagging + reasoning scaffold + coaching output to the `card_reward` eval branch. Ship the coaching UX; compliance layer deferred to phase 4.

**Architecture:** Pure TypeScript enrichment runs server-side before the LLM call — computes `DeckState` (size verdict, archetypes, engine status, upcoming matchup) and tags each offered card (`role`, `keystoneFor`, `deadWithCurrentDeck`, `duplicatePenalty`). A facts block formatter renders these into the prompt. A 5-step reasoning scaffold (deck state → skip bar → pick rationale → commitment → decide) is prepended. The LLM output gains an optional `coaching: { reasoning, headline, confidence, key_tradeoffs, teaching_callouts }` block alongside the existing rankings array. `CardPickView` renders a new coaching panel above the 3-card grid when `coaching` is present; legacy UI degrades gracefully when absent.

**Tech Stack:** TypeScript strict, zod, Next.js App Router (web), React + Redux Toolkit + Tailwind (desktop), Vitest + React Testing Library, Supabase (no migration this phase), Claude Haiku 4.5 via AI SDK, pnpm + turbo monorepo.

---

## File Map

**New:**
- `packages/shared/evaluation/card-reward/deck-state.ts` + `.test.ts`
- `packages/shared/evaluation/card-reward/card-tags.ts` + `.test.ts`
- `packages/shared/evaluation/card-reward/format-card-facts.ts` + `.test.ts`
- `packages/shared/evaluation/card-reward/card-roles.json` — scraped lookup, committed
- `packages/shared/evaluation/card-reward-coach-schema.ts` + `.test.ts`
- `apps/web/scripts/scrape-card-roles.ts`
- `apps/desktop/src/components/card-pick-coaching.tsx` + `.test.tsx`

**Modified:**
- `packages/shared/evaluation/archetype-detector.ts` — export `ARCHETYPE_SIGNALS` table + `countArchetypeSupport` helper
- `packages/shared/evaluation/eval-schemas.ts` — extend `buildCardRewardSchema` with optional `coaching`
- `packages/shared/evaluation/prompt-builder.ts` — add `CARD_REWARD_SCAFFOLD`, trim `TYPE_ADDENDA["card_reward"]`
- `apps/web/src/app/api/evaluate/route.ts` — wire deck-state + tagging + facts block + coaching sanitize in card/shop branch
- `apps/web/src/app/api/evaluate/route.test.ts` — add coaching round-trip integration case
- `apps/desktop/src/lib/eval-inputs/card-reward.ts` or evaluation types — add `coaching?` to `CardRewardEvaluation`
- `apps/desktop/src/services/evaluationApi.ts` — `adaptCardReward` passes coaching through snake→camel
- `apps/desktop/src/views/card-pick/card-pick-view.tsx` — render `CardPickCoaching` when coaching present

**No DB migration.** `coaching` rides inside existing `rankings_snapshot` jsonb payload.

---

## Task 1: Archetype detector refactor (expose raw counts)

**Files:**
- Modify: `packages/shared/evaluation/archetype-detector.ts`
- Create: `packages/shared/evaluation/archetype-detector.test.ts` if missing — otherwise extend existing

**Goal:** Expose raw per-archetype support counts from `detectArchetypes` so the deck-state layer can build `ArchetypeSignal` without re-running the signal match.

- [ ] **Step 1: Read existing detector + tests**

Read `packages/shared/evaluation/archetype-detector.ts` and `packages/shared/evaluation/archetype-detector.test.ts`. Note existing exports: `detectArchetypes`, `hasScalingSources`, `getDrawSources`, `getScalingSources`. Note `ARCHETYPE_SIGNALS` is module-private.

- [ ] **Step 2: Write failing test for `countArchetypeSupport`**

Append to `packages/shared/evaluation/archetype-detector.test.ts`:

```ts
import { countArchetypeSupport } from "./archetype-detector";

describe("countArchetypeSupport", () => {
  it("returns a map of archetype -> raw support count from card signals", () => {
    const deck = [
      { name: "Inflame", keywords: [] },
      { name: "Demon Form", keywords: [] },
      { name: "Heavy Blade", keywords: [] },
      { name: "Strike", keywords: [] },
    ];
    const counts = countArchetypeSupport(deck);
    expect(counts.strength).toBe(2); // Inflame + Demon Form match strength signals
    expect(counts.exhaust).toBeUndefined();
  });

  it("counts each card at most once per archetype even if multiple signals match", () => {
    const deck = [{ name: "Corruption", keywords: [] }];
    const counts = countArchetypeSupport(deck);
    expect(counts.exhaust).toBe(1);
  });

  it("returns empty object for a starter deck of only basics", () => {
    const deck = [
      { name: "Strike", keywords: [] },
      { name: "Defend", keywords: [] },
      { name: "Strike", keywords: [] },
    ];
    const counts = countArchetypeSupport(deck);
    expect(Object.keys(counts)).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

Run: `pnpm --filter @sts2/web test -- archetype-detector`

Expected: FAIL (`countArchetypeSupport` not exported).

- [ ] **Step 4: Implement `countArchetypeSupport`**

In `packages/shared/evaluation/archetype-detector.ts`, export the signal table and add the new helper. Add at the top of the file:

```ts
export const ARCHETYPE_SIGNALS: Record<string, string[]> = {
  // ... existing table ...
};
```

Change the existing `const ARCHETYPE_SIGNALS` to `export const`.

Append below existing exports:

```ts
export function countArchetypeSupport(
  deckCards: Pick<CombatCard, "name" | "keywords">[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const card of deckCards) {
    const nameLower = card.name.toLowerCase();
    const kwLower = (card.keywords ?? []).map((k) => k.name.toLowerCase());
    for (const [archetype, signals] of Object.entries(ARCHETYPE_SIGNALS)) {
      const hit = signals.some(
        (s) => nameLower.includes(s) || kwLower.some((k) => k.includes(s)),
      );
      if (hit) counts[archetype] = (counts[archetype] ?? 0) + 1;
    }
  }
  return counts;
}
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `pnpm --filter @sts2/web test -- archetype-detector`

Expected: new tests PASS. Existing detector tests still PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm -r exec tsc --noEmit`

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/evaluation/archetype-detector.ts packages/shared/evaluation/archetype-detector.test.ts
git commit -m "refactor(eval): expose ARCHETYPE_SIGNALS + countArchetypeSupport for deck-state consumers"
```

---

## Task 2: Scraping script + initial card-roles.json

**Files:**
- Create: `apps/web/scripts/scrape-card-roles.ts`
- Create: `packages/shared/evaluation/card-reward/card-roles.json` (scraped output, committed)

**Goal:** Seed the scraped keystone/role lookup. Initial run targets Ironclad only; other characters populate as placeholders with `role: "unknown"`.

- [ ] **Step 1: Write the scraping script**

Create `apps/web/scripts/scrape-card-roles.ts`:

```ts
#!/usr/bin/env tsx
/**
 * Scrapes the STS2 wiki cards data module to produce card-roles.json.
 * Re-run on demand when wiki data shifts. Not part of CI.
 *
 * Usage: pnpm tsx apps/web/scripts/scrape-card-roles.ts
 *
 * Writes: packages/shared/evaluation/card-reward/card-roles.json
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const WIKI_CARDS_URL =
  "https://slaythespire.wiki.gg/wiki/Module:Cards/StS2_data?action=raw";

interface CardRoleEntry {
  name: string;
  character: string;
  role: "damage" | "block" | "scaling" | "draw" | "removal" | "utility" | "power_payoff" | "unknown";
  keystoneFor: string | null;
  fitsArchetypes: string[];
  maxCopies: number;
}

/**
 * Keystone classifications. These are STS2-specific and hand-curated from
 * in-game knowledge — the wiki doesn't tag keystones directly. Extend when
 * new archetype anchors are identified.
 */
const KEYSTONES: Record<string, { archetype: string; maxCopies?: number }> = {
  inflame: { archetype: "strength", maxCopies: 1 },
  "demon form": { archetype: "strength", maxCopies: 1 },
  corruption: { archetype: "exhaust", maxCopies: 1 },
  "dark embrace": { archetype: "exhaust", maxCopies: 1 },
  "feel no pain": { archetype: "exhaust", maxCopies: 1 },
  barricade: { archetype: "block", maxCopies: 1 },
  envenom: { archetype: "poison", maxCopies: 1 },
  "noxious fumes": { archetype: "poison", maxCopies: 1 },
  "infinite blades": { archetype: "shiv", maxCopies: 1 },
  "creative ai": { archetype: "focus", maxCopies: 1 },
  "biased cognition": { archetype: "focus", maxCopies: 1 },
  "reaper form": { archetype: "reaper", maxCopies: 1 },
  "seven stars": { archetype: "star", maxCopies: 1 },
};

/** Cards whose description implies their role unambiguously. */
function classifyRole(
  name: string,
  description: string,
  type: string,
): CardRoleEntry["role"] {
  const lc = (name + " " + description).toLowerCase();
  if (KEYSTONES[name.toLowerCase()]) return "scaling";
  if (/gain \d+ strength|gain \d+ dexterity|at the start of each turn, gain \d+/.test(lc)) return "scaling";
  if (/deal \d+ damage times|damage equal to|\+\d+ damage per/.test(lc)) return "power_payoff";
  if (/exhaust a card|remove a card/.test(lc)) return "removal";
  if (/draw \d+ card|add \d+ card|skim/.test(lc)) return "draw";
  if (type.toLowerCase() === "attack") return "damage";
  if (type.toLowerCase() === "skill" && /block/.test(lc)) return "block";
  return "utility";
}

function fitsArchetypes(name: string, description: string): string[] {
  const lc = (name + " " + description).toLowerCase();
  const fits: string[] = [];
  const pairs: [string, string[]][] = [
    ["strength", ["strength", "strength-dependent"]],
    ["exhaust", ["exhaust"]],
    ["block", ["block"]],
    ["poison", ["poison"]],
    ["shiv", ["shiv"]],
    ["frost", ["frost", "channel"]],
    ["lightning", ["lightning"]],
    ["focus", ["focus", "orb"]],
  ];
  for (const [archetype, signals] of pairs) {
    if (signals.some((s) => lc.includes(s))) fits.push(archetype);
  }
  return fits;
}

async function main() {
  const res = await fetch(WIKI_CARDS_URL);
  if (!res.ok) {
    throw new Error(`wiki fetch failed: ${res.status}`);
  }
  const raw = await res.text();

  // Wiki module is Lua. Extract card entries via a permissive regex.
  // Each entry looks like:
  //   ["CardID"] = { name = "Foo", type = "Attack", character = "Ironclad",
  //                  description = "Deal X damage." }
  const entries: CardRoleEntry[] = [];
  const re =
    /\[\s*"([^"]+)"\s*\]\s*=\s*\{[^}]*?name\s*=\s*"([^"]+)"[^}]*?type\s*=\s*"([^"]+)"[^}]*?character\s*=\s*"([^"]*)"[^}]*?description\s*=\s*"((?:\\"|[^"])*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const [, id, name, type, character, descriptionRaw] = m;
    const description = descriptionRaw.replace(/\\"/g, '"').replace(/\\n/g, " ");
    const nameLower = name.toLowerCase();
    const keystone = KEYSTONES[nameLower];
    entries.push({
      name,
      character: (character || "unknown").toLowerCase(),
      role: classifyRole(name, description, type),
      keystoneFor: keystone?.archetype ?? null,
      fitsArchetypes: fitsArchetypes(name, description),
      maxCopies: keystone?.maxCopies ?? 2,
    });
  }

  const byId: Record<string, CardRoleEntry> = {};
  for (const e of entries) byId[e.name.toLowerCase()] = e;

  const outPath = "packages/shared/evaluation/card-reward/card-roles.json";
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ cards: byId }, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(byId).length} cards to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the scraper**

```bash
pnpm tsx apps/web/scripts/scrape-card-roles.ts
```

Expected: writes `packages/shared/evaluation/card-reward/card-roles.json` with 50+ card entries. Inspect a handful to confirm role classifications look right.

If the wiki regex fails to parse (schema change), add a minimal hand-seeded fallback covering 15-20 Ironclad anchors (keystones + common damage/block cards) so Task 4 isn't blocked. Document the failure mode in a comment at the top of the script.

- [ ] **Step 3: Commit**

```bash
git add apps/web/scripts/scrape-card-roles.ts packages/shared/evaluation/card-reward/card-roles.json
git commit -m "feat(eval): scrape + commit card-roles.json for card reward tagging"
```

---

## Task 3: Deck state computation

**Files:**
- Create: `packages/shared/evaluation/card-reward/deck-state.ts`
- Create: `packages/shared/evaluation/card-reward/deck-state.test.ts`

**Goal:** Pure `computeDeckState(inputs): DeckState` that composes `countArchetypeSupport`, `hasScalingSources`, and keystone lookups into the rich shape the prompt consumes.

- [ ] **Step 1: Write types + stub**

Create `packages/shared/evaluation/card-reward/deck-state.ts`:

```ts
import type { CombatCard, GameRelic } from "../../types/game-state";
import {
  countArchetypeSupport,
  hasScalingSources,
} from "../archetype-detector";
import cardRolesData from "./card-roles.json";

const CARD_ROLES: Record<string, {
  name: string;
  character: string;
  role: string;
  keystoneFor: string | null;
  fitsArchetypes: string[];
  maxCopies: number;
}> = (cardRolesData as { cards: Record<string, {
  name: string;
  character: string;
  role: string;
  keystoneFor: string | null;
  fitsArchetypes: string[];
  maxCopies: number;
}> }).cards;

export type SizeVerdict = "too_thin" | "healthy" | "bloated";

export interface ArchetypeSignal {
  name: string;
  supportCount: number;
  hasKeystone: boolean;
}

export interface DeckState {
  size: number;
  act: 1 | 2 | 3;
  floor: number;
  ascension: number;
  composition: {
    strikes: number;
    defends: number;
    deadCards: number;
    upgraded: number;
    upgradeRatio: number;
  };
  sizeVerdict: SizeVerdict;
  archetypes: {
    viable: ArchetypeSignal[];
    committed: string | null;
    orphaned: { archetype: string; cards: string[] }[];
  };
  engine: {
    hasScaling: boolean;
    hasBlockPayoff: boolean;
    hasRemovalMomentum: number;
    hasDrawPower: boolean;
  };
  hp: { current: number; max: number; ratio: number };
  upcoming: {
    nextNodeType:
      | "elite" | "monster" | "boss" | "rest" | "shop"
      | "event" | "treasure" | "unknown" | null;
    bossesPossible: string[];
    dangerousMatchups: string[];
  };
}

export interface DeckStateInputs {
  deck: CombatCard[];
  relics: GameRelic[];
  act: 1 | 2 | 3;
  floor: number;
  ascension: number;
  hp: { current: number; max: number };
  upcomingNodeType?: DeckState["upcoming"]["nextNodeType"];
  bossesPossible?: string[];
  dangerousMatchups?: string[];
}

export function computeDeckState(_inputs: DeckStateInputs): DeckState {
  throw new Error("not implemented");
}
```

- [ ] **Step 2: Write failing test — size verdict thresholds**

Create `packages/shared/evaluation/card-reward/deck-state.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeDeckState } from "./deck-state";
import type { DeckStateInputs } from "./deck-state";

function card(name: string, upgraded = false) {
  return { id: name.toLowerCase(), name: upgraded ? `${name}+` : name, keywords: [] };
}

const baseInputs = (overrides: Partial<DeckStateInputs> = {}): DeckStateInputs => ({
  deck: [],
  relics: [],
  act: 1,
  floor: 1,
  ascension: 10,
  hp: { current: 80, max: 80 },
  ...overrides,
});

describe("computeDeckState — size verdict", () => {
  it("returns too_thin for a 10-card starter in Act 1", () => {
    const deck = [
      ...Array(5).fill(0).map(() => card("Strike")),
      ...Array(4).fill(0).map(() => card("Defend")),
      card("Bash"),
    ];
    const state = computeDeckState(baseInputs({ deck }));
    expect(state.sizeVerdict).toBe("too_thin");
    expect(state.size).toBe(10);
  });

  it("returns healthy for a 14-card Act 1 deck", () => {
    const deck = Array(14).fill(0).map(() => card("Strike"));
    const state = computeDeckState(baseInputs({ deck, floor: 8 }));
    expect(state.sizeVerdict).toBe("healthy");
  });

  it("returns bloated for a 20-card Act 1 deck", () => {
    const deck = Array(20).fill(0).map(() => card("Strike"));
    const state = computeDeckState(baseInputs({ deck }));
    expect(state.sizeVerdict).toBe("bloated");
  });

  it("returns healthy for an 18-card Act 2 deck", () => {
    const deck = Array(18).fill(0).map(() => card("Strike"));
    const state = computeDeckState(baseInputs({ deck, act: 2, floor: 22 }));
    expect(state.sizeVerdict).toBe("healthy");
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `pnpm --filter @sts2/web test -- deck-state`

Expected: FAIL (stub throws).

- [ ] **Step 4: Implement size verdict + composition**

Replace the stub in `deck-state.ts`:

```ts
const SIZE_IDEAL: Record<1 | 2 | 3, [min: number, max: number]> = {
  1: [10, 14],
  2: [14, 20],
  3: [18, 24],
};

function sizeVerdict(size: number, act: 1 | 2 | 3): SizeVerdict {
  const [min, max] = SIZE_IDEAL[act];
  if (size < min - 1) return "too_thin";
  if (size > max + 4) return "bloated";
  return "healthy";
}

function baseName(card: { name: string }): string {
  return card.name.replace(/\+$/, "").toLowerCase();
}

function isUpgraded(card: { name: string }): boolean {
  return /\+$/.test(card.name);
}

function countBasics(deck: { name: string }[]): { strikes: number; defends: number } {
  let strikes = 0;
  let defends = 0;
  for (const c of deck) {
    const b = baseName(c);
    if (b === "strike") strikes++;
    if (b === "defend") defends++;
  }
  return { strikes, defends };
}

export function computeDeckState(inputs: DeckStateInputs): DeckState {
  const {
    deck, relics, act, floor, ascension, hp,
    upcomingNodeType = null, bossesPossible = [], dangerousMatchups = [],
  } = inputs;

  const size = deck.length;
  const { strikes, defends } = countBasics(deck);
  const upgraded = deck.filter(isUpgraded).length;
  const upgradeRatio = size === 0 ? 0 : upgraded / size;

  // Engine status — hasScaling piggy-backs on existing detector.
  const hasScaling = hasScalingSources(deck);
  const hasBlockPayoff = deck.some((c) => {
    const b = baseName(c);
    return b === "barricade" || b === "body slam" || b === "entrench";
  });
  const hasDrawPower = deck.some((c) => {
    const b = baseName(c);
    return ["pommel strike", "battle trance", "offering", "skim", "dark embrace"].includes(b);
  });
  const hasRemovalMomentum = 0; // tightened in a later step when smith context is threaded through

  // Archetype signals from raw support counts.
  const rawCounts = countArchetypeSupport(deck);
  const viable: ArchetypeSignal[] = Object.entries(rawCounts)
    .filter(([, count]) => count >= 2)
    .map(([name, supportCount]) => {
      const hasKeystone = deck.some((c) => {
        const entry = CARD_ROLES[baseName(c)];
        return entry?.keystoneFor === name;
      });
      return { name, supportCount, hasKeystone };
    })
    .sort((a, b) => b.supportCount - a.supportCount);

  const committed = viable.find((a) => a.hasKeystone)?.name ?? null;

  const orphaned = viable
    .filter((a) => !a.hasKeystone && a.name !== committed)
    .map((a) => ({
      archetype: a.name,
      cards: deck
        .filter((c) => CARD_ROLES[baseName(c)]?.fitsArchetypes.includes(a.name))
        .map((c) => c.name),
    }));

  // Dead-card count: basics + scaling cards the deck can't pay off in Act 1.
  const deadBasics = strikes + defends;
  const deadCards = deadBasics; // act-1-specific scaling deadness surfaces at tag-time per card

  return {
    size,
    act,
    floor,
    ascension,
    composition: {
      strikes,
      defends,
      deadCards,
      upgraded,
      upgradeRatio,
    },
    sizeVerdict: sizeVerdict(size, act),
    archetypes: { viable, committed, orphaned },
    engine: {
      hasScaling,
      hasBlockPayoff,
      hasRemovalMomentum,
      hasDrawPower,
    },
    hp: {
      current: hp.current,
      max: hp.max,
      ratio: hp.max === 0 ? 0 : hp.current / hp.max,
    },
    upcoming: {
      nextNodeType: upcomingNodeType,
      bossesPossible,
      dangerousMatchups,
    },
  };
}
```

- [ ] **Step 5: Run size verdict tests — expect PASS**

Run: `pnpm --filter @sts2/web test -- deck-state`

Expected: 4 size verdict tests PASS.

- [ ] **Step 6: Write failing tests — archetypes + engine + zero-viable edge case**

Append to `deck-state.test.ts`:

```ts
import { computeDeckState as _ } from "./deck-state"; // noop, already imported

describe("computeDeckState — archetypes", () => {
  it("flags a viable archetype when 2+ support cards present", () => {
    const deck = [
      { id: "inflame", name: "Inflame", keywords: [] },
      { id: "heavy blade", name: "Heavy Blade", keywords: [] },
      { id: "strike", name: "Strike", keywords: [] },
    ];
    const state = computeDeckState(baseInputs({ deck }));
    const strength = state.archetypes.viable.find((a) => a.name === "strength");
    expect(strength).toBeDefined();
    expect(strength?.supportCount).toBeGreaterThanOrEqual(2);
    expect(strength?.hasKeystone).toBe(true); // Inflame is a keystone
    expect(state.archetypes.committed).toBe("strength");
  });

  it("does not commit when no keystone is present", () => {
    // Rupture doesn't appear in KEYSTONES in the scraper's initial list,
    // so this mimics "support without anchor".
    const deck = [
      { id: "heavy blade", name: "Heavy Blade", keywords: [] },
      { id: "heavy blade", name: "Heavy Blade", keywords: [] },
      { id: "strike", name: "Strike", keywords: [] },
    ];
    const state = computeDeckState(baseInputs({ deck }));
    // Heavy Blade counts toward strength signal but isn't a keystone itself.
    expect(state.archetypes.committed).toBeNull();
  });

  it("returns zero viable archetypes for a pure starter deck", () => {
    const deck = [
      ...Array(5).fill(0).map(() => ({ id: "strike", name: "Strike", keywords: [] })),
      ...Array(4).fill(0).map(() => ({ id: "defend", name: "Defend", keywords: [] })),
      { id: "bash", name: "Bash", keywords: [] },
    ];
    const state = computeDeckState(baseInputs({ deck }));
    expect(state.archetypes.viable).toEqual([]);
    expect(state.archetypes.committed).toBeNull();
    expect(state.archetypes.orphaned).toEqual([]);
  });
});

describe("computeDeckState — engine status", () => {
  it("hasScaling true when deck contains a scaling source", () => {
    const deck = [{ id: "inflame", name: "Inflame", keywords: [] }];
    const state = computeDeckState(baseInputs({ deck }));
    expect(state.engine.hasScaling).toBe(true);
  });

  it("hasScaling false for a starter deck", () => {
    const deck = [{ id: "strike", name: "Strike", keywords: [] }];
    const state = computeDeckState(baseInputs({ deck }));
    expect(state.engine.hasScaling).toBe(false);
  });
});
```

- [ ] **Step 7: Run — expect PASS**

Run: `pnpm --filter @sts2/web test -- deck-state`

Expected: all PASS.

- [ ] **Step 8: Typecheck + commit**

```bash
pnpm -r exec tsc --noEmit
```

Clean.

```bash
git add packages/shared/evaluation/card-reward/deck-state.ts packages/shared/evaluation/card-reward/deck-state.test.ts
git commit -m "feat(eval): computeDeckState — archetype/engine/size facts for card reward coach"
```

---

## Task 4: Per-card tagging

**Files:**
- Create: `packages/shared/evaluation/card-reward/card-tags.ts`
- Create: `packages/shared/evaluation/card-reward/card-tags.test.ts`

**Goal:** `tagCard(card, deckState, siblings)` returns `CardTags`. Uses scraped lookup + keyword heuristics. `deadWithCurrentDeck` is tightly scoped per the spec.

- [ ] **Step 1: Write types + stub**

Create `packages/shared/evaluation/card-reward/card-tags.ts`:

```ts
import type { CombatCard } from "../../types/game-state";
import type { DeckState } from "./deck-state";
import cardRolesData from "./card-roles.json";

interface CardRoleEntry {
  name: string;
  character: string;
  role: "damage" | "block" | "scaling" | "draw" | "removal" | "utility" | "power_payoff" | "unknown";
  keystoneFor: string | null;
  fitsArchetypes: string[];
  maxCopies: number;
}

const CARD_ROLES: Record<string, CardRoleEntry> =
  (cardRolesData as { cards: Record<string, CardRoleEntry> }).cards;

export type CardRole = CardRoleEntry["role"];

export interface CardTags {
  role: CardRole;
  keystoneFor: string | null;
  fitsArchetypes: string[];
  deadWithCurrentDeck: boolean;
  duplicatePenalty: boolean;
  upgradeLevel: 0 | 1;
}

function baseName(name: string): string {
  return name.replace(/\+$/, "").toLowerCase();
}

function isUpgraded(name: string): boolean {
  return /\+$/.test(name);
}

export function tagCard(
  card: Pick<CombatCard, "name">,
  deckState: DeckState,
  siblings: Pick<CombatCard, "name">[] = [],
): CardTags {
  throw new Error("not implemented");
}
```

- [ ] **Step 2: Write failing tests — lookup hits**

Create `packages/shared/evaluation/card-reward/card-tags.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { tagCard } from "./card-tags";
import type { DeckState } from "./deck-state";

const emptyDeckState: DeckState = {
  size: 10,
  act: 1,
  floor: 1,
  ascension: 10,
  composition: { strikes: 5, defends: 4, deadCards: 9, upgraded: 0, upgradeRatio: 0 },
  sizeVerdict: "too_thin",
  archetypes: { viable: [], committed: null, orphaned: [] },
  engine: {
    hasScaling: false,
    hasBlockPayoff: false,
    hasRemovalMomentum: 0,
    hasDrawPower: false,
  },
  hp: { current: 80, max: 80, ratio: 1 },
  upcoming: { nextNodeType: null, bossesPossible: [], dangerousMatchups: [] },
};

const committedStrengthState: DeckState = {
  ...emptyDeckState,
  archetypes: {
    viable: [{ name: "strength", supportCount: 3, hasKeystone: true }],
    committed: "strength",
    orphaned: [],
  },
  engine: { ...emptyDeckState.engine, hasScaling: true },
};

const committedPoisonState: DeckState = {
  ...emptyDeckState,
  archetypes: {
    viable: [{ name: "poison", supportCount: 3, hasKeystone: true }],
    committed: "poison",
    orphaned: [],
  },
};

describe("tagCard — lookup-driven", () => {
  it("keystone card returns keystoneFor + role from lookup", () => {
    const tags = tagCard({ name: "Inflame" }, emptyDeckState);
    expect(tags.role).toBe("scaling");
    expect(tags.keystoneFor).toBe("strength");
  });

  it("upgrade suffix strips for lookup but sets upgradeLevel=1", () => {
    const tags = tagCard({ name: "Inflame+" }, emptyDeckState);
    expect(tags.keystoneFor).toBe("strength");
    expect(tags.upgradeLevel).toBe(1);
  });
});

describe("tagCard — deadWithCurrentDeck", () => {
  it("NEVER flags a keystone as dead, regardless of deck state", () => {
    const tags = tagCard({ name: "Inflame" }, emptyDeckState);
    expect(tags.deadWithCurrentDeck).toBe(false);
  });

  it("NEVER flags a scaling card as dead in an uncommitted deck", () => {
    const tags = tagCard({ name: "Inflame" }, emptyDeckState);
    expect(tags.deadWithCurrentDeck).toBe(false);
  });

  it("flags a scaling card as dead when committed to a DIFFERENT archetype", () => {
    // Inflame fits strength; current deck committed to poison.
    const tags = tagCard({ name: "Inflame" }, committedPoisonState);
    expect(tags.deadWithCurrentDeck).toBe(true);
  });

  it("flags a power_payoff as dead when no scaling source AND no scaling sibling", () => {
    // Heavy Blade classified as power_payoff; deck has no scaling; no siblings
    // provide scaling either.
    const tags = tagCard({ name: "Heavy Blade" }, emptyDeckState, [
      { name: "Bash" },
      { name: "Pommel Strike" },
    ]);
    expect(tags.deadWithCurrentDeck).toBe(true);
  });

  it("does NOT flag a power_payoff as dead when a sibling pick is scaling", () => {
    const tags = tagCard({ name: "Heavy Blade" }, emptyDeckState, [
      { name: "Bash" },
      { name: "Inflame" }, // scaling sibling — saves the payoff
    ]);
    expect(tags.deadWithCurrentDeck).toBe(false);
  });
});

describe("tagCard — duplicatePenalty", () => {
  it("flags duplicate when deck already has maxCopies and this is over", () => {
    const stateWithInflame: DeckState = {
      ...emptyDeckState,
      size: 11,
    };
    const tags = tagCard({ name: "Inflame" }, stateWithInflame, [], [
      { name: "Inflame" },
    ]);
    expect(tags.duplicatePenalty).toBe(true);
  });

  it("does not flag duplicate for high-maxCopies basics", () => {
    const tags = tagCard({ name: "Strike" }, emptyDeckState, [], [
      { name: "Strike" },
      { name: "Strike" },
    ]);
    expect(tags.duplicatePenalty).toBe(false);
  });
});
```

Note the test signature `tagCard(card, deckState, siblings, deckCards)` — `deckCards` is the 4th arg (cards ALREADY in the deck, used for duplicate detection). Update the stub signature to match.

- [ ] **Step 3: Update signature + run — expect FAIL**

In `card-tags.ts`, update the exported signature:

```ts
export function tagCard(
  card: Pick<CombatCard, "name">,
  deckState: DeckState,
  siblings: Pick<CombatCard, "name">[] = [],
  deckCards: Pick<CombatCard, "name">[] = [],
): CardTags {
  throw new Error("not implemented");
}
```

Run: `pnpm --filter @sts2/web test -- card-tags`

Expected: FAIL (stub throws).

- [ ] **Step 4: Implement `tagCard`**

Replace the body:

```ts
const SCALING_SOURCES = [
  "inflame", "demon form", "rupture", "limit break",
  "noxious fumes", "envenom",
  "biased cognition", "creative ai",
];

function hasScalingSourceIn(names: string[]): boolean {
  return names.some((n) => SCALING_SOURCES.includes(baseName(n)));
}

export function tagCard(
  card: Pick<CombatCard, "name">,
  deckState: DeckState,
  siblings: Pick<CombatCard, "name">[] = [],
  deckCards: Pick<CombatCard, "name">[] = [],
): CardTags {
  const key = baseName(card.name);
  const entry = CARD_ROLES[key];

  const role: CardRole = entry?.role ?? "unknown";
  const keystoneFor = entry?.keystoneFor ?? null;
  const fitsArchetypes = entry?.fitsArchetypes ?? [];
  const maxCopies = entry?.maxCopies ?? 2;
  const upgradeLevel: 0 | 1 = isUpgraded(card.name) ? 1 : 0;

  // deadWithCurrentDeck — tight scoping per spec.
  let deadWithCurrentDeck = false;

  // NEVER dead: keystones and scaling-in-uncommitted-decks.
  const isKeystone = keystoneFor !== null;
  const isScaling = role === "scaling";

  if (!isKeystone) {
    if (isScaling) {
      // Dead only when committed to a different archetype the scaling doesn't fit.
      if (
        deckState.archetypes.committed &&
        !fitsArchetypes.includes(deckState.archetypes.committed)
      ) {
        deadWithCurrentDeck = true;
      }
    } else if (role === "power_payoff") {
      // Dead when no scaling in deck AND no scaling sibling.
      const siblingNames = siblings.map((s) => s.name);
      const deckNames = deckCards.map((d) => d.name);
      const scalingAvailable =
        deckState.engine.hasScaling ||
        hasScalingSourceIn(siblingNames) ||
        hasScalingSourceIn(deckNames);
      if (!scalingAvailable) {
        deadWithCurrentDeck = true;
      }
    }
  }

  // duplicatePenalty — deck already has >= maxCopies.
  const existingCount = deckCards.filter((d) => baseName(d.name) === key).length;
  const duplicatePenalty = existingCount >= maxCopies;

  return {
    role,
    keystoneFor,
    fitsArchetypes,
    deadWithCurrentDeck,
    duplicatePenalty,
    upgradeLevel,
  };
}
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `pnpm --filter @sts2/web test -- card-tags`

Expected: all tests PASS (check that 6+ cases pass).

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm -r exec tsc --noEmit
```

Clean.

```bash
git add packages/shared/evaluation/card-reward/card-tags.ts packages/shared/evaluation/card-reward/card-tags.test.ts
git commit -m "feat(eval): tagCard — per-card role + keystone + dead + duplicate tagging"
```

---

## Task 5: Facts block formatter

**Files:**
- Create: `packages/shared/evaluation/card-reward/format-card-facts.ts`
- Create: `packages/shared/evaluation/card-reward/format-card-facts.test.ts`

**Goal:** `formatCardFacts(deckState, taggedCards): string` renders the DECK STATE + OFFERED CARDS block.

- [ ] **Step 1: Write failing test**

Create `packages/shared/evaluation/card-reward/format-card-facts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatCardFacts } from "./format-card-facts";
import type { DeckState } from "./deck-state";
import type { CardTags } from "./card-tags";

const baseState: DeckState = {
  size: 14,
  act: 1,
  floor: 8,
  ascension: 10,
  composition: { strikes: 4, defends: 3, deadCards: 7, upgraded: 4, upgradeRatio: 0.29 },
  sizeVerdict: "healthy",
  archetypes: {
    viable: [
      { name: "strength", supportCount: 3, hasKeystone: false },
      { name: "block", supportCount: 2, hasKeystone: false },
    ],
    committed: null,
    orphaned: [],
  },
  engine: {
    hasScaling: false,
    hasBlockPayoff: false,
    hasRemovalMomentum: 0,
    hasDrawPower: false,
  },
  hp: { current: 62, max: 80, ratio: 0.775 },
  upcoming: {
    nextNodeType: "rest",
    bossesPossible: ["Guardian", "Ghost Operator"],
    dangerousMatchups: ["Ghost Operator"],
  },
};

interface TaggedOffer {
  index: number;
  name: string;
  rarity: string;
  type: string;
  cost: number | null;
  description: string;
  tags: CardTags;
}

const offers: TaggedOffer[] = [
  {
    index: 1,
    name: "Heavy Blade",
    rarity: "Common",
    type: "Attack",
    cost: 2,
    description: "Deal 14 damage. Deal 3 additional damage for each Strength.",
    tags: {
      role: "power_payoff",
      keystoneFor: null,
      fitsArchetypes: ["strength"],
      deadWithCurrentDeck: false,
      duplicatePenalty: false,
      upgradeLevel: 0,
    },
  },
  {
    index: 2,
    name: "Inflame",
    rarity: "Uncommon",
    type: "Power",
    cost: 1,
    description: "Gain 2 Strength.",
    tags: {
      role: "scaling",
      keystoneFor: "strength",
      fitsArchetypes: ["strength"],
      deadWithCurrentDeck: false,
      duplicatePenalty: false,
      upgradeLevel: 0,
    },
  },
];

describe("formatCardFacts", () => {
  it("renders DECK STATE + OFFERED CARDS sections", () => {
    const out = formatCardFacts(baseState, offers);
    expect(out).toContain("=== DECK STATE ===");
    expect(out).toContain("Deck: 14 cards");
    expect(out).toContain("Size verdict: HEALTHY");
    expect(out).toContain("Archetypes viable:");
    expect(out).toContain("- strength (support: 3, keystone: NO)");
    expect(out).toContain("Committed archetype: none yet");
    expect(out).toContain("Engine status:");
    expect(out).toContain("Upcoming: next node = rest");
    expect(out).toContain("Dangerous matchups (from history): Ghost Operator");
    expect(out).toContain("=== OFFERED CARDS ===");
    expect(out).toContain("1. Heavy Blade");
    expect(out).toContain("Tags: role=power_payoff");
    expect(out).toContain("2. Inflame");
    expect(out).toContain("keystone_for=strength");
  });

  it("reports 'none' for empty archetype state", () => {
    const emptyState: DeckState = {
      ...baseState,
      archetypes: { viable: [], committed: null, orphaned: [] },
    };
    const out = formatCardFacts(emptyState, offers);
    expect(out).toContain("Archetypes viable: none");
    expect(out).toContain("Committed archetype: none yet");
    expect(out).toContain("Orphaned support: none");
  });

  it("handles null upcoming gracefully", () => {
    const state: DeckState = {
      ...baseState,
      upcoming: {
        nextNodeType: null,
        bossesPossible: [],
        dangerousMatchups: [],
      },
    };
    const out = formatCardFacts(state, offers);
    expect(out).toContain("Upcoming: next node = unknown");
    expect(out).not.toContain("Dangerous matchups (from history):");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @sts2/web test -- format-card-facts`

Expected: FAIL.

- [ ] **Step 3: Implement `formatCardFacts`**

Create `packages/shared/evaluation/card-reward/format-card-facts.ts`:

```ts
import type { DeckState } from "./deck-state";
import type { CardTags } from "./card-tags";

export interface TaggedOffer {
  index: number;
  name: string;
  rarity: string;
  type: string;
  cost: number | null;
  description: string;
  tags: CardTags;
}

function yesNo(b: boolean): string {
  return b ? "yes" : "no";
}

function archetypeLine(a: { name: string; supportCount: number; hasKeystone: boolean }): string {
  return `  - ${a.name} (support: ${a.supportCount}, keystone: ${a.hasKeystone ? "YES" : "NO"})`;
}

export function formatCardFacts(state: DeckState, offers: TaggedOffer[]): string {
  const ratio = Math.round(state.hp.ratio * 100);
  const upgradePct = Math.round(state.composition.upgradeRatio * 100);

  const lines: string[] = [
    "=== DECK STATE ===",
    `Deck: ${state.size} cards, ${state.composition.upgraded} upgraded (${upgradePct}%) | Basics: ${state.composition.strikes} Strike, ${state.composition.defends} Defend | Dead-card count: ${state.composition.deadCards} | Size verdict: ${state.sizeVerdict.toUpperCase()}`,
    `Act ${state.act}, Floor ${state.floor}, Ascension ${state.ascension} | HP: ${state.hp.current}/${state.hp.max} (${ratio}%)`,
    "",
  ];

  if (state.archetypes.viable.length === 0) {
    lines.push("Archetypes viable: none");
  } else {
    lines.push("Archetypes viable:");
    for (const a of state.archetypes.viable) lines.push(archetypeLine(a));
  }
  lines.push(`Committed archetype: ${state.archetypes.committed ?? "none yet"}`);
  lines.push(
    state.archetypes.orphaned.length === 0
      ? "Orphaned support: none"
      : `Orphaned support: ${state.archetypes.orphaned.map((o) => `${o.archetype}(${o.cards.length})`).join(", ")}`,
  );
  lines.push("");
  lines.push(
    `Engine status: scaling: ${yesNo(state.engine.hasScaling)} | block_payoff: ${yesNo(state.engine.hasBlockPayoff)} | draw_power: ${yesNo(state.engine.hasDrawPower)} | upgrades_remaining: ${state.engine.hasRemovalMomentum}`,
  );
  lines.push("");

  const nextNode = state.upcoming.nextNodeType ?? "unknown";
  const bosses = state.upcoming.bossesPossible.length
    ? ` | act bosses possible: ${state.upcoming.bossesPossible.join(", ")}`
    : "";
  lines.push(`Upcoming: next node = ${nextNode}${bosses}`);
  if (state.upcoming.dangerousMatchups.length > 0) {
    lines.push(`Dangerous matchups (from history): ${state.upcoming.dangerousMatchups.join(", ")}`);
  }

  lines.push("", "=== OFFERED CARDS ===");
  for (const o of offers) {
    const costLabel = o.cost != null ? `, cost ${o.cost}` : "";
    lines.push(`${o.index}. ${o.name} (${o.rarity} ${o.type}${costLabel}) — ${o.description}`);
    lines.push(
      `   Tags: role=${o.tags.role} | fits_archetypes=[${o.tags.fitsArchetypes.join(",")}] | keystone_for=${o.tags.keystoneFor ?? "null"} | dead_with_current_deck=${o.tags.deadWithCurrentDeck} | duplicate_penalty=${o.tags.duplicatePenalty}`,
    );
  }

  return lines.join("\n");
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @sts2/web test -- format-card-facts`

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/evaluation/card-reward/format-card-facts.ts packages/shared/evaluation/card-reward/format-card-facts.test.ts
git commit -m "feat(eval): formatCardFacts — DECK STATE + OFFERED CARDS prompt block"
```

---

## Task 6: Coaching schema + sanitizer

**Files:**
- Create: `packages/shared/evaluation/card-reward-coach-schema.ts`
- Create: `packages/shared/evaluation/card-reward-coach-schema.test.ts`

**Goal:** Define `cardRewardCoachingSchema` + `sanitizeCardRewardCoachOutput` + client types. Extending `buildCardRewardSchema` happens in Task 8 (route wiring).

- [ ] **Step 1: Write failing schema test**

Create `packages/shared/evaluation/card-reward-coach-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  cardRewardCoachingSchema,
  sanitizeCardRewardCoachOutput,
} from "./card-reward-coach-schema";

const validCoaching = {
  reasoning: {
    deck_state: "14-card healthy deck, no committed archetype yet.",
    commitment: "Inflame is a Strength keystone and 3 support cards in deck.",
  },
  headline: "Take Inflame — commits to Strength.",
  confidence: 0.82,
  key_tradeoffs: [
    {
      position: 1,
      upside: "Standalone damage.",
      downside: "Doesn't scale with future picks.",
    },
  ],
  teaching_callouts: [
    {
      pattern: "keystone_available",
      explanation: "Deck has 3 Strength support cards; Inflame locks in.",
    },
  ],
};

describe("cardRewardCoachingSchema", () => {
  it("parses a valid coaching object", () => {
    expect(cardRewardCoachingSchema.safeParse(validCoaching).success).toBe(true);
  });

  it("rejects empty reasoning fields", () => {
    const bad = {
      ...validCoaching,
      reasoning: { deck_state: "", commitment: "" },
    };
    expect(cardRewardCoachingSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts confidence out of range at schema level (clamped by sanitize)", () => {
    const lax = { ...validCoaching, confidence: 1.5 };
    expect(cardRewardCoachingSchema.safeParse(lax).success).toBe(true);
  });
});

describe("sanitizeCardRewardCoachOutput", () => {
  it("caps key_tradeoffs at 3", () => {
    const many = {
      ...validCoaching,
      key_tradeoffs: Array(5).fill(validCoaching.key_tradeoffs[0]),
    };
    const out = sanitizeCardRewardCoachOutput(many);
    expect(out.key_tradeoffs).toHaveLength(3);
  });

  it("caps teaching_callouts at 3", () => {
    const many = {
      ...validCoaching,
      teaching_callouts: Array(5).fill(validCoaching.teaching_callouts[0]),
    };
    const out = sanitizeCardRewardCoachOutput(many);
    expect(out.teaching_callouts).toHaveLength(3);
  });

  it("clamps confidence to [0, 1]", () => {
    expect(sanitizeCardRewardCoachOutput({ ...validCoaching, confidence: 1.5 }).confidence).toBe(1);
    expect(sanitizeCardRewardCoachOutput({ ...validCoaching, confidence: -0.2 }).confidence).toBe(0);
  });

  it("dedupes key_tradeoffs by position (keeps first)", () => {
    const withDupe = {
      ...validCoaching,
      key_tradeoffs: [
        { position: 1, upside: "first", downside: "first" },
        { position: 1, upside: "dupe", downside: "dupe" },
        { position: 2, upside: "second", downside: "second" },
      ],
    };
    const out = sanitizeCardRewardCoachOutput(withDupe);
    expect(out.key_tradeoffs).toHaveLength(2);
    expect(out.key_tradeoffs[0].upside).toBe("first");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @sts2/web test -- card-reward-coach-schema`

Expected: FAIL (module missing).

- [ ] **Step 3: Implement the schema + sanitizer**

Create `packages/shared/evaluation/card-reward-coach-schema.ts`:

```ts
import { z } from "zod";

/**
 * Output schema for card reward coach. snake_case on the wire to match
 * Claude's output; camelCase conversion lives in the desktop adapter.
 *
 * No `.max()`/`.min()` numeric bounds on arrays or confidence — Anthropic's
 * structured-output endpoint rejects the emitted JSON Schema constraints.
 * Caps + clamping happen post-parse in sanitizeCardRewardCoachOutput.
 */

export const cardRewardCoachingSchema = z.object({
  reasoning: z.object({
    deck_state: z.string().min(1),
    commitment: z.string().min(1),
  }),
  headline: z.string().min(1),
  confidence: z.number(),
  key_tradeoffs: z.array(
    z.object({
      position: z.number(),
      upside: z.string(),
      downside: z.string(),
    }),
  ),
  teaching_callouts: z.array(
    z.object({
      pattern: z.string(),
      explanation: z.string(),
    }),
  ),
});

export type CardRewardCoachingRaw = z.infer<typeof cardRewardCoachingSchema>;

const MAX_TRADEOFFS = 3;
const MAX_CALLOUTS = 3;

export function sanitizeCardRewardCoachOutput(
  raw: CardRewardCoachingRaw,
): CardRewardCoachingRaw {
  const seen = new Set<number>();
  const dedupedTradeoffs: CardRewardCoachingRaw["key_tradeoffs"] = [];
  for (const t of raw.key_tradeoffs) {
    if (seen.has(t.position)) continue;
    seen.add(t.position);
    dedupedTradeoffs.push(t);
    if (dedupedTradeoffs.length >= MAX_TRADEOFFS) break;
  }

  return {
    ...raw,
    confidence: Math.max(0, Math.min(1, raw.confidence)),
    key_tradeoffs: dedupedTradeoffs,
    teaching_callouts: raw.teaching_callouts.slice(0, MAX_CALLOUTS),
  };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @sts2/web test -- card-reward-coach-schema`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/evaluation/card-reward-coach-schema.ts packages/shared/evaluation/card-reward-coach-schema.test.ts
git commit -m "feat(eval): card reward coaching schema + sanitizer"
```

---

## Task 7: Prompt restructure — scaffold + addendum trim

**Files:**
- Modify: `packages/shared/evaluation/prompt-builder.ts`

- [ ] **Step 1: Add `CARD_REWARD_SCAFFOLD` export**

In `packages/shared/evaluation/prompt-builder.ts`, find the section where `MAP_PATHING_SCAFFOLD` is exported (added in phase 1). Add below it:

```ts
export const CARD_REWARD_SCAFFOLD = `
Before ranking, reason step-by-step:

1. DECK STATE: restate the deck's size verdict, committed archetype (or lack
   thereof), and what the deck needs most (damage, block, scaling, removal).
2. SKIP BAR: state the minimum tier / archetype fit a pick must clear to earn
   a deck slot right now. "Take a B-tier only if it's on-archetype or solves a
   block/damage gap." "Skip unless A-tier." This bar drives step 5.
3. PICK RATIONALE: for each offered card, state its best-case role in THIS
   deck (not in a vacuum). Flag if a card is dead_with_current_deck per the
   facts.
4. COMMITMENT: if a keystone is offered and the deck already supports the
   archetype, picking it may be correct even if the card's raw tier is lower —
   keystones unlock scaling. Say so explicitly.
5. DECIDE: apply the skip bar from step 2. If no offered card clears it, set
   skip_recommended=true. Otherwise pick the card that best meets the bar and
   the deck's primary need.

Then produce the output. Do not restate game rules; the DECK STATE block
has them. Your job is judgment under this specific deck, not general theory.

If you produce a coaching block, follow these caps:
  - key_tradeoffs: return at most 3 entries (one per offered card is typical)
  - teaching_callouts: return at most 3 entries
Entries past the cap are discarded server-side.
`.trim();
```

- [ ] **Step 2: Trim `TYPE_ADDENDA["card_reward"]`**

Find the existing `card_reward` entry in `TYPE_ADDENDA`:

```ts
  card_reward: `
CARD REWARD:
- Exclusive choice: pick ONE or skip ALL.
- ACT 1 PHILOSOPHY: Prioritize STANDALONE VALUE over archetype speculation. ...
- Act 2+: Evaluate against current deck and archetype. Skip if none advance the win condition.
- Include a pick_summary: "Pick [name] — [reason]" or "Skip — [reason]". Max 15 words.`,
```

Replace with the trimmed version (keep what's goal-shaping; drop rules now computed in facts):

```ts
  card_reward: `
CARD REWARD:
- Exclusive choice: pick ONE or skip ALL.
- ACT TIMING: Act 1 prioritizes individual card quality + acquiring a keystone before
  committing to support. Act 2+ evaluates against the committed archetype. Act 3 is
  about closing the run — don't pick cards that won't matter for the act 3 boss.
- Include a pick_summary: "Pick [name] — [reason]" or "Skip — [reason]". Max 15 words.`,
```

- [ ] **Step 3: Run prompt-builder tests**

Run: `pnpm --filter @sts2/web test -- prompt-builder`

Expected: most tests PASS. If any snapshot test fails because of the trim, inspect the diff and update the snapshot with `-u` ONLY if the trimmed content matches the spec's intent.

- [ ] **Step 4: Typecheck**

Run: `pnpm -r exec tsc --noEmit`

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/evaluation/prompt-builder.ts
git commit -m "feat(eval): CARD_REWARD_SCAFFOLD + trimmed card_reward addendum"
```

---

## Task 8: Wire into /api/evaluate route

**Files:**
- Modify: `apps/web/src/app/api/evaluate/route.ts`
- Modify: `apps/web/src/app/api/evaluate/route.test.ts`
- Modify: `packages/shared/evaluation/eval-schemas.ts`

- [ ] **Step 1: Extend `buildCardRewardSchema` with optional coaching**

In `packages/shared/evaluation/eval-schemas.ts`, find `buildCardRewardSchema`. Import + merge the coaching schema:

```ts
import {
  cardRewardCoachingSchema,
  type CardRewardCoachingRaw,
} from "./card-reward-coach-schema";

// Inside buildCardRewardSchema, update baseShape to include coaching:
const baseShape = {
  rankings: z.array(cardRewardRankingSchema).describe(/* ...existing... */),
  skip_recommended: z.boolean(),
  skip_reasoning: z.string().nullish(),
  coaching: cardRewardCoachingSchema.optional(),
};
```

No other changes to the schema export.

- [ ] **Step 2: Wire enrichment + facts block into the route handler**

In `apps/web/src/app/api/evaluate/route.ts`, find the card/shop branch (around line 810). Add imports at the top:

```ts
import { computeDeckState } from "@sts2/shared/evaluation/card-reward/deck-state";
import { tagCard } from "@sts2/shared/evaluation/card-reward/card-tags";
import { formatCardFacts } from "@sts2/shared/evaluation/card-reward/format-card-facts";
import { sanitizeCardRewardCoachOutput } from "@sts2/shared/evaluation/card-reward-coach-schema";
import { CARD_REWARD_SCAFFOLD } from "@sts2/shared/evaluation/prompt-builder";
```

In the card/shop branch, BEFORE the `userPrompt` is constructed, compute the deck state + tagged offers. Find the `const isExclusive = body.exclusive !== false;` line; right before it, insert:

```ts
// Card reward coach enrichment. Skip for shops (phase 5) — only fires
// when type === "card_reward".
let factsBlock = "";
let scaffold = "";
if (type === "card_reward" && body.context) {
  try {
    const deckCards = body.context.deckCards ?? [];
    const relics = body.context.relics ?? [];
    const deckState = computeDeckState({
      deck: deckCards,
      relics,
      act: (body.context.act ?? 1) as 1 | 2 | 3,
      floor: body.context.floor ?? 0,
      ascension: body.context.ascension ?? 0,
      hp: {
        current: body.context.hp?.current ?? 0,
        max: body.context.hp?.max ?? 0,
      },
      upcomingNodeType: body.context.upcomingNodeType ?? null,
      bossesPossible: body.context.bossesPossible ?? [],
      dangerousMatchups: body.context.dangerousMatchups ?? [],
    });

    const siblings = items.map((it) => ({ name: it.name }));
    const taggedOffers = items.map((it, i) => ({
      index: i + 1,
      name: it.name,
      rarity: it.rarity ?? "",
      type: it.type ?? "",
      cost: it.cost ?? null,
      description: it.description ?? "",
      tags: tagCard(
        { name: it.name },
        deckState,
        siblings.filter((s) => s.name !== it.name),
        deckCards,
      ),
    }));

    factsBlock = "\n" + formatCardFacts(deckState, taggedOffers) + "\n";
    scaffold = "\n" + CARD_REWARD_SCAFFOLD + "\n";
  } catch (err) {
    console.error("[Evaluate] card reward enrichment failed, continuing without:", err);
    // Falls through with empty factsBlock/scaffold — legacy prompt behavior.
  }
}
```

Then modify the `userPrompt` construction. Find the existing template and prepend `factsBlock` + `scaffold`:

```ts
const userPrompt = `${contextStr}
${goldBudget}${factsBlock}${scaffold}
CRITICAL: This is Slay the Spire 2. Many cards have DIFFERENT effects than STS1. Evaluate ONLY by the description shown after the dash (—). Do NOT assume what a card does from its name.

${type === "card_reward" ? "Offered cards" : "Shop items (affordable only)"}:
${itemsStr}
${isExclusive ? "\nEXCLUSIVE choice — pick ONE or skip ALL. If none deserve a deck slot, set skip_recommended: true and mark all as skip." : "\nYou may select MULTIPLE items. Evaluate each independently."}
${budgetSummary}

Return exactly ${items.length} rankings using position numbers (1, 2, 3...) matching the order above.`;
```

- [ ] **Step 3: Sanitize coaching on response path**

After the existing `sanitizeRankings` + `applyPostEvalWeights` block in the card branch, add sanitization for coaching:

```ts
// Sanitize coaching block if present.
if (result.output.coaching) {
  result.output.coaching = sanitizeCardRewardCoachOutput(result.output.coaching);
}
```

Place this AFTER `result.output.rankings = cleanedRankings;` and BEFORE `const evaluation = toCardRewardEvaluation(result.output, items);`.

- [ ] **Step 4: Propagate coaching through `toCardRewardEvaluation`**

Find `toCardRewardEvaluation` (helper used in this branch — likely in `packages/shared/evaluation/eval-props.ts` or similar). Extend it to copy `coaching` through snake→camel:

```ts
// In toCardRewardEvaluation, add to the returned object:
coaching: raw.coaching ? {
  reasoning: {
    deckState: raw.coaching.reasoning.deck_state,
    commitment: raw.coaching.reasoning.commitment,
  },
  headline: raw.coaching.headline,
  confidence: raw.coaching.confidence,
  keyTradeoffs: raw.coaching.key_tradeoffs.map((t) => ({
    position: t.position,
    upside: t.upside,
    downside: t.downside,
  })),
  teachingCallouts: raw.coaching.teaching_callouts.map((c) => ({
    pattern: c.pattern,
    explanation: c.explanation,
  })),
} : undefined,
```

And extend the `CardRewardEvaluation` TypeScript type in `packages/shared/evaluation/types.ts`:

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
}
```

- [ ] **Step 5: Write integration test — coaching round-trips**

Open `apps/web/src/app/api/evaluate/route.test.ts`. Add a new test in the card_reward describe block. Crib the mocking pattern from existing phase-1 / phase-2 route tests (search for `MockLanguageModelV3` or equivalent):

```ts
describe("card_reward coaching pipeline", () => {
  it("passes coaching block through to response when LLM returns it", async () => {
    // Set up: mock the AI SDK to return a response with a coaching block.
    // Fixture shape matches cardRewardCoachingSchema. Assert the final
    // response has coaching with the expected fields (camelCased).
    // Reuse existing route-test harness (see phase-2 compliance tests).
    // Assertions:
    //   expect(out.coaching).toBeDefined();
    //   expect(out.coaching.headline).toContain("...");
    //   expect(out.coaching.keyTradeoffs).toHaveLength(<=3);
    //   expect(out.coaching.confidence).toBeGreaterThanOrEqual(0);
    //   expect(out.coaching.confidence).toBeLessThanOrEqual(1);
  });

  it("passes through without coaching when LLM omits it (backwards compat)", async () => {
    // LLM returns only rankings + skip_recommended; assert
    // out.coaching === undefined and existing fields still populate.
  });
});
```

Flesh out the fixtures consistent with existing tests. Use `MockLanguageModelV3` the same way phase-1/phase-2 integration tests use it.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @sts2/web test -- evaluate/route`

Expected: existing tests still PASS; new tests PASS.

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm -r exec tsc --noEmit`

Expected: clean.

```bash
git add packages/shared/evaluation/eval-schemas.ts \
        packages/shared/evaluation/types.ts \
        apps/web/src/app/api/evaluate/route.ts \
        apps/web/src/app/api/evaluate/route.test.ts
git commit -m "feat(eval): wire card reward coach enrichment + coaching into /api/evaluate"
```

---

## Task 9: Desktop adapter + `CardPickCoaching` component

**Files:**
- Modify: `apps/desktop/src/services/evaluationApi.ts`
- Create: `apps/desktop/src/components/card-pick-coaching.tsx`
- Create: `apps/desktop/src/components/card-pick-coaching.test.tsx`
- Modify: `apps/desktop/src/views/card-pick/card-pick-view.tsx`

- [ ] **Step 1: Adapter — pass coaching through**

Open `apps/desktop/src/services/evaluationApi.ts`. Find `adaptCardReward` (or the equivalent that converts the raw card_reward response to client shape). Add coaching conversion:

```ts
// Inside adaptCardReward, in the returned object:
coaching: raw.coaching
  ? {
      reasoning: {
        deckState: raw.coaching.reasoning.deck_state,
        commitment: raw.coaching.reasoning.commitment,
      },
      headline: raw.coaching.headline,
      confidence: raw.coaching.confidence,
      keyTradeoffs: raw.coaching.key_tradeoffs.map((t: { position: number; upside: string; downside: string }) => ({
        position: t.position,
        upside: t.upside,
        downside: t.downside,
      })),
      teachingCallouts: raw.coaching.teaching_callouts.map((c: { pattern: string; explanation: string }) => ({
        pattern: c.pattern,
        explanation: c.explanation,
      })),
    }
  : undefined,
```

If the server-side `toCardRewardEvaluation` already camelCases (Task 8 Step 4), the adapter may just pass through. Check and wire accordingly — don't double-convert.

- [ ] **Step 2: Write failing tests for `CardPickCoaching`**

Create `apps/desktop/src/components/card-pick-coaching.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CardPickCoaching } from "./card-pick-coaching";

const fullCoaching = {
  reasoning: {
    deckState: "14-card healthy deck with no committed archetype yet.",
    commitment: "Inflame is a Strength keystone and 3 support cards are in deck.",
  },
  headline: "Take Inflame — commits to Strength.",
  confidence: 0.82,
  keyTradeoffs: [
    { position: 1, upside: "Standalone damage.", downside: "Doesn't scale." },
    { position: 2, upside: "Unlocks scaling.", downside: "Commits the deck." },
  ],
  teachingCallouts: [
    {
      pattern: "keystone_available",
      explanation: "Deck has 3 Strength support cards; Inflame locks in.",
    },
  ],
};

describe("CardPickCoaching", () => {
  it("renders null when coaching is absent", () => {
    const { container } = render(<CardPickCoaching coaching={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders headline, deck_state, commitment, tradeoffs, callouts", () => {
    render(<CardPickCoaching coaching={fullCoaching} />);
    expect(screen.getByText(/Take Inflame/)).toBeInTheDocument();
    expect(screen.getByText(/14-card healthy deck/)).toBeInTheDocument();
    expect(screen.getByText(/Inflame is a Strength keystone/)).toBeInTheDocument();
    expect(screen.getByText(/Standalone damage/)).toBeInTheDocument();
    expect(screen.getByText(/Unlocks scaling/)).toBeInTheDocument();
    expect(screen.getByText(/keystone_available|Deck has 3 Strength support cards/)).toBeInTheDocument();
  });

  it("shows ConfidencePill from phase-1 reuse", () => {
    const { container } = render(<CardPickCoaching coaching={fullCoaching} />);
    expect(container.textContent).toMatch(/0\.82/);
  });

  it("renders gracefully when tradeoffs and callouts are empty", () => {
    const minimal = { ...fullCoaching, keyTradeoffs: [], teachingCallouts: [] };
    render(<CardPickCoaching coaching={minimal} />);
    expect(screen.getByText(/Take Inflame/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `pnpm --filter @sts2/desktop test -- card-pick-coaching`

Expected: FAIL (component missing).

- [ ] **Step 4: Implement `CardPickCoaching`**

Create `apps/desktop/src/components/card-pick-coaching.tsx`:

```tsx
import { ConfidencePill } from "./confidence-pill";

interface CoachingProps {
  coaching:
    | {
        reasoning: { deckState: string; commitment: string };
        headline: string;
        confidence: number;
        keyTradeoffs: { position: number; upside: string; downside: string }[];
        teachingCallouts: { pattern: string; explanation: string }[];
      }
    | undefined;
}

export function CardPickCoaching({ coaching }: CoachingProps) {
  if (!coaching) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold leading-snug text-zinc-100">
            {coaching.headline}
          </h3>
          <div className="shrink-0">
            <ConfidencePill confidence={coaching.confidence} />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Why this pick
        </h4>
        <p className="mt-1.5 text-xs text-zinc-300 leading-relaxed">
          <span className="font-semibold text-zinc-200">Deck state: </span>
          {coaching.reasoning.deckState}
        </p>
        <p className="mt-1.5 text-xs text-zinc-300 leading-relaxed">
          <span className="font-semibold text-zinc-200">Commitment: </span>
          {coaching.reasoning.commitment}
        </p>
      </div>

      {coaching.keyTradeoffs.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Tradeoffs
          </h4>
          <ul className="mt-1.5 space-y-1 text-xs text-zinc-400 leading-relaxed">
            {coaching.keyTradeoffs.map((t, i) => (
              <li key={i}>
                <span className="text-zinc-300">▸ Card {t.position}:</span>{" "}
                <span className="text-emerald-300/90">{t.upside}</span>{" "}
                <span className="text-zinc-500">{t.downside}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {coaching.teachingCallouts.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Why this is a good pick
          </h4>
          <ul className="mt-1.5 space-y-1.5 text-xs text-zinc-400 leading-relaxed">
            {coaching.teachingCallouts.map((c, i) => (
              <li key={i} className="flex gap-1.5">
                <span aria-hidden>💡</span>
                <span>{c.explanation}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `pnpm --filter @sts2/desktop test -- card-pick-coaching`

Expected: all PASS.

- [ ] **Step 6: Integrate into `CardPickView`**

In `apps/desktop/src/views/card-pick/card-pick-view.tsx`, import the new component and render it between the header row and the card grid:

```tsx
import { CardPickCoaching } from "../../components/card-pick-coaching";

// Inside the JSX, after the header row:
<CardPickCoaching coaching={evaluation?.coaching} />

// Existing 3-card grid stays unchanged below.
```

- [ ] **Step 7: Run desktop tests**

Run: `pnpm --filter @sts2/desktop test`

Expected: all PASS. If any existing `card-pick-view.test.tsx` fixtures break because they lack `coaching`, update them to not explicitly assert its absence (absent is fine).

- [ ] **Step 8: Typecheck**

Run: `pnpm -r exec tsc --noEmit`

Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/services/evaluationApi.ts \
        apps/desktop/src/components/card-pick-coaching.tsx \
        apps/desktop/src/components/card-pick-coaching.test.tsx \
        apps/desktop/src/views/card-pick/card-pick-view.tsx
git commit -m "feat(desktop): CardPickCoaching component + adapter passthrough + view integration"
```

---

## Task 10: E2E smoke + PR

**Files:** manual, no file changes unless fixes surface.

- [ ] **Step 1: Full test suite**

Run: `pnpm turbo test`

Expected: all workspaces PASS.

- [ ] **Step 2: Typecheck + lint + build**

Run:

```bash
pnpm -r exec tsc --noEmit
pnpm turbo lint
pnpm turbo build
```

Expected: typecheck clean; lint at pre-existing baseline; web + desktop builds succeed.

- [ ] **Step 3: Manual smoke**

Start dev servers and trigger a card reward eval in the desktop:

```bash
# terminal 1
pnpm --filter @sts2/web dev
# terminal 2
pnpm --filter @sts2/desktop tauri dev
```

Verify:
1. Card reward view renders the new coaching panel above the 3-card grid when a reward arrives.
2. Headline + confidence pill, "Why this pick" (deck state + commitment), tradeoffs, teaching callouts all render.
3. Legacy tier badges on each card still populate from `rankings[]`.
4. `choices.rankings_snapshot->'coaching'` populated in Supabase:

```bash
pnpm supabase db query "SELECT rankings_snapshot->'coaching'->>'headline' AS headline FROM choices WHERE choice_type='card_reward' ORDER BY created_at DESC LIMIT 5;"
```

- [ ] **Step 4: Push + open PR**

```bash
git push -u origin HEAD
gh pr create --title "feat(eval): card reward coach (phase 3)" --body "$(cat <<'EOF'
## Summary

Phase 3 of the evaluation coaching arc. Extends the phase-1 enrichment + scaffold + new-output pattern from map pathing to card rewards.

- **Deck state enrichment**: `computeDeckState` surfaces size verdict, archetypes viable + committed + orphaned, engine status, HP, upcoming matchup.
- **Per-card tagging**: `tagCard` classifies each offered card (role, keystoneFor, fitsArchetypes, deadWithCurrentDeck, duplicatePenalty) using a scraped `card-roles.json` lookup + keyword fallback. `deadWithCurrentDeck` is tightly scoped to avoid false positives on keystones and scaling-in-uncommitted-decks.
- **Facts block**: `formatCardFacts` renders `=== DECK STATE ===` + `=== OFFERED CARDS ===` into the prompt.
- **Scaffold**: 5-step CoT (deck state → skip bar → pick rationale → commitment → decide).
- **Output**: optional `coaching` block on the card_reward response with `reasoning`, `headline`, `confidence`, `key_tradeoffs`, `teaching_callouts`.
- **UI**: new `CardPickCoaching` component renders above the existing 3-card grid. Degrades to legacy UI when `coaching` is absent.

Compliance (repair + rerank for card picks) is deferred to phase 4.

Closes #<issue-number>

## Test plan

- [ ] `pnpm turbo test` all workspaces green
- [ ] `pnpm -r exec tsc --noEmit` clean
- [ ] `pnpm turbo build` web + desktop both succeed
- [ ] Manual smoke: card reward renders coaching panel; rankings still show; `choices.rankings_snapshot->'coaching'` populated

## Related

- Spec: `docs/superpowers/specs/2026-04-20-card-reward-coach-design.md`
- Plan: `docs/superpowers/plans/2026-04-20-card-reward-coach.md`
EOF
)"
```

Replace `<issue-number>` with the tracking issue; create one with `gh issue create` first if none exists.

---

## Self-review

**Spec coverage:**
- Deck state enrichment → Task 3 ✓
- Per-card tagging → Task 4 ✓ (with Critical-fix `deadWithCurrentDeck` scoping)
- Scraping script + card-roles.json → Task 2 ✓
- Facts block → Task 5 ✓
- Scaffold + trimmed addendum → Task 7 ✓ (5-step scaffold with SKIP BAR)
- Coaching schema + sanitizer → Task 6 ✓
- Route wiring → Task 8 ✓ (integration tests fleshed out in Task 8 Step 5)
- Adapter + UI → Task 9 ✓
- Archetype detector refactor → Task 1 ✓ (raw support counts)
- E2E smoke + PR → Task 10 ✓

**Placeholder scan:**
- Task 8 Step 5 integration test is sketched rather than fully fleshed — existing route-test harness is context-heavy and the implementer must crib from phase-1/phase-2 tests. Noted explicitly in the task.
- Task 9 Step 1 notes "If the server-side `toCardRewardEvaluation` already camelCases, the adapter may just pass through. Check and wire accordingly." — load-bearing instruction, not a placeholder.

**Type consistency:**
- `DeckState` fields consistent across Tasks 3, 4, 5.
- `CardTags` structure matches across Tasks 4, 5.
- `CardRewardCoachingRaw` (snake) ↔ `CardRewardEvaluation.coaching` (camel) — mapped in Task 8 Step 4 + Task 9 Step 1.
- `CARD_REWARD_SCAFFOLD` exported from `prompt-builder.ts` Task 7, imported in route Task 8.
- `sanitizeCardRewardCoachOutput` exported Task 6, used Task 8.
