# Card Reward Coach (Phase 3)

**Date:** 2026-04-20
**Status:** Approved (design, pre-plan)
**Motivation:** Card reward evaluations are the most frequent eval type (~12–15 per run) and were called out in the phase-1 kickoff as producing suboptimal recommendations. Phases 1+2 shipped enrichment + scaffold + compliance for map pathing; the same pattern extended to card rewards is the highest-impact next surface. Phase 3 ships the coaching half (enrichment + reasoning scaffold + new output shape + UI); compliance for card_reward is deferred to phase 4 once we've seen what failure modes look like.

## Non-goals

- Compliance layer (structural repair + judgment rerank) for card_reward. Deferred to phase 4.
- Shop coaching. Shares the schema shell with card_reward but has different reasoning concerns (gold budget, removal priority, potion slots). Phase 5.
- Ancient coaching. Different output shape (relic choice, not card choice). Phase 6.
- Calibration loop / deviation-aware prompting. Unblocked by the telemetry this phase adds but deferred until data volume supports it. Phase 7+.
- Per-user personalization or pattern learning.

## Current State

### Pipeline

- `POST /api/evaluate` with `type: "card_reward"` dispatches to the card/shop branch (`apps/web/src/app/api/evaluate/route.ts:810+`).
- Schema: `buildCardRewardSchema(items, includeShopPlan)` in `packages/shared/evaluation/eval-schemas.ts` — per-card `{position, tier, confidence, reasoning}` plus `skip_recommended`, `skip_reasoning`, optional `spending_plan` for shop.
- Prompt addendum `TYPE_ADDENDA["card_reward"]` in `packages/shared/evaluation/prompt-builder.ts` — sound Act-1 standalone-value philosophy in prose form.
- Community tier + win-rate signals already inject separately.
- Post-processing: `sanitizeRankings`, `applyPostEvalWeights`, data-driven weight from `card_win_rates` view.
- UI: `apps/desktop/src/views/card-pick/card-pick-view.tsx` — 3-card grid with per-card tier badges, inline "Pick: X" header.

### Gap

- No structured deck-state facts. Prompt sees raw deck list + addendum prose; LLM must re-derive archetype viability, bloat, dead-card count, engine status, upcoming matchup every call.
- No reasoning scaffold. LLM goes straight to per-card tier rankings without committing to a deck-state framing first.
- No coaching output. Player-facing content is a tier letter + 2-3 sentence per-card reasoning. No overall framing, no tradeoffs, no teaching.
- `archetype-detector.ts` exists in shared but isn't wired into card_reward prompts.

## Phase Scope

1. **Deck-state enrichment layer** (pure TS, mirrors map's `RunState`).
2. **Per-card tagging layer** — role / keystone / dead-with-current-deck classification.
3. **Scraping script** seeded from STS2 wiki for the keystone/role lookup.
4. **Facts block formatter** — injects deck state + per-card tags into the prompt.
5. **Reasoning scaffold** — `CARD_REWARD_SCAFFOLD` prepended to the card_reward user prompt.
6. **Trimmed `TYPE_ADDENDA["card_reward"]`** — rules now in facts are removed.
7. **Extended output schema** — optional `coaching: { reasoning, headline, confidence, key_tradeoffs, teaching_callouts }` block.
8. **UI** — new `CardPickCoaching` component above the existing card grid; callouts strip below.
9. **Telemetry** — `coaching` lives inside existing `choices.rankings_snapshot` (no new column).

Single-release ship. No feature flag. Optional `coaching` field keeps the change backwards-compatible with older desktop clients and with the legacy UI fallback path.

## Architecture

```
POST /api/evaluate (type: "card_reward" | "shop")
  ├── (existing) boss briefing, character strategy, run-history, etc.
  ├── deck-state enrichment (NEW)
  │      computeDeckState(context)
  │      → size verdict, archetypes viable, engine status, upcoming
  ├── per-card tagging (NEW)
  │      tagCard(card, deckState)
  │      → { role, keystoneFor, fitsArchetypes, deadWithCurrentDeck, ... }
  ├── facts block formatter (NEW)
  │      renders === DECK STATE === + === OFFERED CARDS === with tags
  ├── prompt assembly (MODIFIED)
  │      - facts block precedes offered-items list
  │      - CARD_REWARD_SCAFFOLD instruction prepended
  │      - TYPE_ADDENDA["card_reward"] trimmed
  ├── LLM eval (unchanged transport)
  │      - extended schema includes optional coaching block
  ├── sanitize (EXISTING + NEW)
  │      - sanitizeRankings (legacy — unchanged)
  │      - sanitizeCardRewardCoachOutput (new — caps tradeoffs/callouts, clamps confidence)
  ├── applyPostEvalWeights + win-rate weighting (UNCHANGED)
  └── response includes rankings[] + optional coaching

CardPickView UI (MODIFIED)
  - renders CardPickCoaching above the 3-card grid when coaching present
  - existing 3-card grid with tier badges unchanged (drives from rankings[])
  - teaching callouts strip below grid
  - no SwapBadge / compliance UI (deferred to phase 4)
```

### Files

**New:**
- `packages/shared/evaluation/card-reward/deck-state.ts` + `.test.ts`
- `packages/shared/evaluation/card-reward/card-tags.ts` + `.test.ts`
- `packages/shared/evaluation/card-reward/format-card-facts.ts` + `.test.ts`
- `packages/shared/evaluation/card-reward/card-roles.json` — scraped lookup, committed
- `packages/shared/evaluation/card-reward-coach-schema.ts` + `.test.ts`
- `apps/web/scripts/scrape-card-roles.ts` — one-off / on-demand scraper
- `apps/desktop/src/components/card-pick-coaching.tsx` + `.test.tsx`

**Modified:**
- `packages/shared/evaluation/eval-schemas.ts` — extend `buildCardRewardSchema` (or compose with coaching shape)
- `packages/shared/evaluation/prompt-builder.ts` — add `CARD_REWARD_SCAFFOLD`, trim `TYPE_ADDENDA["card_reward"]`
- `apps/web/src/app/api/evaluate/route.ts` — wire enrichment + tagging + facts block into card/shop branch
- `apps/desktop/src/views/card-pick/card-pick-view.tsx` — render `CardPickCoaching` when present
- `apps/desktop/src/features/evaluation/types.ts` (or wherever `CardRewardEvaluation` is declared) — add optional `coaching` field
- `apps/desktop/src/services/evaluationApi.ts` — adapter passes `coaching` through snake→camel

**No DB migration.** `coaching` rides inside the existing `rankings_snapshot` jsonb payload.

## Deck-state enrichment

Pure function; runs once per card_reward eval; takes the request `context` (deck list + act + floor + ascension + HP) and emits a `DeckState`:

```ts
export type SizeVerdict = "too_thin" | "healthy" | "bloated";

export interface ArchetypeSignal {
  name: string;              // "Strength", "Poison", "Block/Barricade", "Exhaust", ...
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
    nextNodeType: "elite" | "monster" | "boss" | "rest" | "shop" | "event" | "treasure" | "unknown" | null;
    bossesPossible: string[];
    dangerousMatchups: string[];
  };
}
```

### Thresholds

- `sizeVerdict`: Act 1 (ideal 10-14), Act 2 (14-20), Act 3 (18-24). "too_thin" < ideal-2, "bloated" > ideal+4.
- `deadCards = strikes + defends + cards whose role === "scaling" && !engine.hasScaling && act === 1`.
- `archetype.viable` requires `supportCount >= 2`.
- `archetype.committed` is the archetype with `hasKeystone === true` (at most one — if multiple, pick highest support).
- `orphaned` lists archetypes that have support but no keystone AND aren't committed.

### Reuse existing archetype-detector

`packages/shared/evaluation/archetype-detector.ts` already ships. `deriveArchetypes(deck)` wraps it for the card_reward shape.

## Per-card tagging

For each offered card, compute:

```ts
export interface CardTags {
  role: "damage" | "block" | "scaling" | "draw" | "removal" | "utility" | "power_payoff" | "unknown";
  keystoneFor: string | null;
  fitsArchetypes: string[];
  deadWithCurrentDeck: boolean;
  duplicatePenalty: boolean;
  upgradeLevel: 0 | 1;
}
```

### Detection rules

1. Look up the card by id/name in `card-roles.json` (scraped). If present, read `role`, `keystoneFor`, `fitsArchetypes` directly.
2. If missing from lookup, fall back to keyword heuristics over the card description (e.g., description contains "gain X Strength" → `role = "scaling"`). Heuristics are a short list; log a warning when they fire so the scrape can be extended.
3. `deadWithCurrentDeck`:
   - `role === "scaling"` AND deck has no payoff for that scaling mechanism AND act === 1.
   - OR `keystoneFor === X` AND deck has zero support cards for X.
   - OR `role === "power_payoff"` (e.g., something that consumes Strength) AND deck has no scaling source.
4. `duplicatePenalty = true` if deck already has the same card AND it's not an archetype-critical anchor (don't penalize second copy of a keystone).

Pure function; colocated tests for 6-8 representative cards.

## Scraping card roles

Script at `apps/web/scripts/scrape-card-roles.ts`:

- Fetches STS2 wiki cards module (`slaythespire.wiki.gg/wiki/Module:Cards/StS2_data` or equivalent).
- Parses Lua / JSON payload.
- For each card: emits `{ id: string, name: string, role, keystoneFor, fitsArchetypes }`.
- Writes `packages/shared/evaluation/card-reward/card-roles.json`.
- Committed to the repo; re-run on-demand when wiki data changes.

Initial seed covers the Ironclad class (user's confirmed main). Other characters get placeholder `role: "unknown"` entries and rely on keyword fallbacks until the scrape is widened.

## Facts block

Runs after enrichment + tagging; emits a string slotted into the prompt before the offered-items list.

Format (see Section 3 of this design for the full template):

```
=== DECK STATE ===
Deck: {size} cards, {upgraded} upgraded ({upgradeRatio}%) | Basics: {strikes} Strike, {defends} Defend | Dead-card count: {deadCards} | Size verdict: {SIZE_VERDICT}
Act {act}, Floor {floor}, Ascension {ascension} | HP: {current}/{max} ({ratio}%)

Archetypes viable:
  - {name} (support: {supportCount}, keystone: {YES|NO})
Committed archetype: {committed ?? "none yet"}
Orphaned support: {orphaned list or "none"}

Engine status:
  scaling: {yes/no} | block_payoff: {yes/no} | draw_power: {yes/no} | upgrades_remaining: {count}

Upcoming: next node = {nextNodeType} | act bosses possible: {comma list}
Dangerous matchups (from history): {list or "none"}

=== OFFERED CARDS ===
{index}. {name} ({rarity} {type}, cost {cost}) — {description}
   Tags: role={role} | fits_archetypes=[{list}] | keystone_for={keystone or null} | dead_with_current_deck={bool} | duplicate_penalty={bool}
```

Existing community tier + win-rate blocks continue to inject before the scaffold, unchanged.

## Reasoning scaffold

New addendum, ~120 tokens, exported from `prompt-builder.ts` as `CARD_REWARD_SCAFFOLD`:

```
Before ranking, reason step-by-step:

1. DECK STATE: restate the deck's size verdict, committed archetype (or lack
   thereof), and what the deck needs most (damage, block, scaling, removal).
2. PICK RATIONALE: for each offered card, state its best-case role in THIS
   deck (not in a vacuum). Flag if a card is dead_with_current_deck per the
   facts.
3. COMMITMENT: if a keystone is offered and the deck already supports the
   archetype, picking it may be correct even if the card's raw tier is lower —
   keystones unlock scaling. Say so explicitly.

Then produce the output. Do not restate game rules; the DECK STATE block
has them. Your job is judgment under this specific deck, not general theory.
```

## Output schema

New file `packages/shared/evaluation/card-reward-coach-schema.ts`:

```ts
import { z } from "zod";

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
```

`buildCardRewardSchema` in `eval-schemas.ts` is extended (or composed) so the output includes `coaching: cardRewardCoachingSchema.optional()` alongside `rankings`, `skip_recommended`, `skip_reasoning`, `spending_plan`.

### Post-parse sanitize

`sanitizeCardRewardCoachOutput(raw)`:
- `coaching.key_tradeoffs` → slice(0, 3).
- `coaching.teaching_callouts` → slice(0, 3).
- `coaching.confidence` → clamp `[0, 1]`.
- Dedupe `key_tradeoffs` by `position`.

No schema-level caps on arrays — Anthropic structured-output rejects them. Same pattern phase 2 used for `mapCoachOutputSchema`.

## UI

`apps/desktop/src/components/card-pick-coaching.tsx`:

```tsx
interface CardPickCoachingProps {
  coaching: CardRewardCoachingEvaluation | undefined;
}
```

Renders `null` when `coaching` is absent. When present:
- Headline + `ConfidencePill` (reuse phase-1 component).
- "Why this pick" block — `reasoning.deck_state` and `reasoning.commitment` (full visibility).
- "Tradeoffs" list — one entry per `key_tradeoffs[]` entry.
- Teaching callouts strip at the bottom — one entry per `teaching_callouts[]`, 💡-prefixed.

`CardPickView` renders `<CardPickCoaching coaching={evaluation?.coaching}>` between its existing header row and the card grid.

The existing per-card tier badge grid is unchanged. "Pick: X" inline summary stays accurate — it keys off `rankings[]` + `skipRecommended`, which are orthogonal to coaching.

## Testing

### Unit (vitest, colocated)

- `deck-state.test.ts` — size verdict thresholds by act, archetype detection, engine status booleans, dead-card count, orphan detection.
- `card-tags.test.ts` — 6-8 representative cards: a keystone, a dead scaling card, a duplicate penalty case, a plain damage card, a Power requiring support.
- `format-card-facts.test.ts` — facts block rendering with full state + empty-archetype edge case.
- `card-reward-coach-schema.test.ts` — zod round-trip valid example, sanitize truncates over-cap arrays, clamps confidence, dedupes tradeoffs.
- `card-pick-coaching.test.tsx` — renders null on absent coaching; renders all sections on full coaching; renders partial gracefully.

### Integration

One new case in `evaluate/route.test.ts`:
- **"card_reward response with coaching block is accepted and passes through unchanged"** — mock LLM returns a valid fixture including coaching; assert legacy rankings still parse, coaching present and sanitized, no regressions to the existing card_reward tests.

### Regression

- Route test asserting responses WITHOUT coaching still parse (backwards compatibility).
- UI test asserting `CardPickView` with no coaching renders the legacy layout unchanged.

### Manual smoke

Trigger a card_reward eval in a real run (via desktop). Verify:
1. Coaching block renders headline + reasoning above the grid.
2. Tradeoffs list correct per-card references.
3. Teaching callouts appear when present.
4. Legacy tier badges still correct.
5. `choices.rankings_snapshot->'coaching'` populated in Supabase.

## Rollout

Single release. No feature flag. `coaching` optional on the wire means legacy clients fall back to the current UI automatically; new responses layer coaching on top.

## Risks and mitigations

- **LLM ignores facts (phase-1 compliance echo).** Phase 3 does NOT ship the compliance layer for card_reward; if the LLM picks a card tagged `deadWithCurrentDeck: true`, nothing catches it server-side. Mitigation: coaching output surfaces the dead-card flag to the player, who can override. Full compliance is phase 4.
- **Scraping rot.** Wiki data changes; `card-roles.json` goes stale. Mitigation: keyword fallback in `tagCard` for missing lookups; re-run scrape on-demand.
- **Over-tagging cards as "dead with current deck".** False positives dissuade correct picks. Mitigation: threshold rules conservative — require clear evidence (scaling without payoff, act-1 only); tests cover the false-positive edge.
- **`deckState.upcoming.nextNodeType` wrong.** If the card_reward eval fires without map context, the matchup signal is empty. That's fine — the prompt says "Upcoming: unknown" rather than fabricating.
- **Coaching output bloats token budget.** Cap sanitize keeps arrays short; scaffold is ~120 tokens; facts block is ~400-600 tokens. Net: probably +800 tokens per eval. Acceptable for the quality lift; re-check if cost dashboards spike.

## Out of scope / future phases

- **Phase 4:** card_reward compliance layer (repair + rerank) using the telemetry patterns from phase 2.
- **Phase 5:** shop coaching — shares schema shell, different reasoning frame (gold budget, removal priority).
- **Phase 6:** ancient coaching — relic selection, different shape entirely.
- **Phase 7:** deviation-aware calibration — unblocked by phases 2-6 producing clean compliance/coaching telemetry.
