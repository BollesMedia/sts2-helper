# Ancient Eval Addendum + Base Prompt Cleanup

**Date:** 2026-04-13
**Status:** Approved
**Motivation:** Ancient event evaluations produce hallucinated reasoning (e.g., "Gold worthless post-Act3" at Act 1 Floor 1). Root cause: the base prompt contains gold language that Haiku parrots in irrelevant contexts, and the generic event addendum provides no ancient-specific guidance. Ancients are a unique decision point — they appear at the start of each act, heal the player, and offer 3 options from a curated relic pool. They need their own eval type with data-driven prompt enrichment.

## Current State

### Base Prompt Issues

Line 39 of `prompt-builder.ts` GAME FACTS:
```
- STS2 has 3 acts (no Act 4). Gold is valuable throughout Acts 1-2 for shops (removal, relics, potions). Only in Act 3 should you spend all remaining gold before the final boss — nothing comes after.
```
This gold fact is already covered in the shop addendum (line 76). Having it in the base prompt causes Haiku to parrot it in non-shop contexts (events, card rewards, etc.).

### Event Addendum Issues

Line 111:
```
- Gold: only valuable if shop is coming AND you need something from it.
```
Too reductive. Gold value is context-dependent — depends on act, current gold amount, remaining shops, what you need. This oversimplification contributes to bad gold reasoning.

### Ancient Handling

Currently ancients flow through the generic `event` eval type. The only ancient-specific logic is a warning in `buildEventPrompt` (event.ts:48-50):
```
(ANCIENT — this is an STS2-specific event. Do NOT assume you know what enchantments, relics, or effects do. Evaluate ONLY from the descriptions provided. If an option mentions an enchantment or effect you don't recognize, set confidence below 50.)
```
This is defensive but provides no positive guidance on HOW to evaluate ancient options.

### Data Available

The `events` table (just synced) contains:
- Each Ancient's `id`, `name`, `type`, `act`, and `relics` (full relic pool)
- 5 Ancients: NEOW (Act 1), DARV (Act 2), OROBAS (Act 2), PAEL (Act 2), NONUPEIPE (Act 3)

The `relics` table contains full descriptions for every relic in every Ancient's pool.

## Design

### 1. Base Prompt Cleanup

**Remove the gold sentence from GAME FACTS (line 39).** Replace with a simpler structural fact:
```
- STS2 has 3 acts. There is no Act 4.
```
The gold economics are context-specific and belong in type addenda (shop already has it).

**Remove the gold line from event addendum (line 111).** The ancient addendum and the remaining event addendum guidelines (HP loss, curse, transform, max HP) are sufficient for shrine events.

### 2. New `ancient` Eval Type

Add `"ancient"` to the `EvalType` union in `prompt-builder.ts`.

Add `"ancient"` to the `TYPE_ADDENDA` map with a dedicated addendum (see section 3).

### 3. Ancient Addendum

Static category-based rules that teach Haiku how to evaluate ancient option archetypes. This addendum replaces the generic event addendum when `evalType === "ancient"`.

```
ANCIENT EVENT:
- You MUST choose exactly one option. Evaluate all three against your current deck needs, act timing, and ascension.
- OPTION CATEGORIES — identify each option's type and apply the right framework:
  - CARD REMOVAL (remove N cards): High priority when Strikes/Defends remain. Value decreases as deck thins. In Acts 1-2, removal is almost always the best option.
  - GOLD TRADE (lose/gain gold): Gold buys card removal (75-100g), relics, and potions at shops. Evaluate gold loss against remaining shop opportunities. Losing 99g at Act 1 is significant — it's a removal. Gaining 150-300g is strong if shops remain.
  - TRANSFORM (transform N cards): Strong when transforming Strikes/Defends into random cards. Risky when transforming engine cards. Astrolabe-style "transform + upgrade" is premium.
  - MAX HP (raise max HP by N): Scales with ascension — more valuable at Ascension 8+. Always solid, never bad.
  - RELIC (obtain random relic/specific relic): Permanent power. High priority unless the specific relic has a downside (curse, HP loss, boss relics with drawbacks).
  - ENCHANTMENT (enchant cards with X): Archetype-dependent. Evaluate the enchantment effect against current deck composition. Strong when it enhances core cards.
  - CARD ADD (add specific cards): Evaluate added cards the same as a card reward — do they advance the deck's win condition?
  - HP TRADE (lose HP/Max HP for reward): Only take if reward is high-value AND current HP can absorb the cost safely.
- CRITICAL: Evaluate based on DESCRIPTIONS PROVIDED. Do not assume you know what an enchantment, relic, or card does beyond what the description says.
- If unsure about an option's effect, set confidence below 50.
- Reasoning must reference the specific trade-off: what you gain vs what you lose.
```

### 4. DB Enrichment in API Route

When `evalType === "ancient"`, the API route performs two additional queries (in parallel with existing context loads):

**a) Relic descriptions for offered options:**
The request body contains `mapPrompt` which includes option titles. The `event_id` will be included in the prompt (see section 5). Query the `relics` table for the relic descriptions of the offered options by name.

**b) Ancient's full relic pool from events table:**
Query `events` table by `event_id` to get the `relics` array — the full pool of options this Ancient can offer. This gives context for relative value (e.g., "you got Scroll Boxes instead of Empty Cage").

**Injection into prompt:**
Add an `[Ancient Reference]` section to the user prompt, before the options:
```
[Ancient: Neow | Act 1 | Pool: 20 options]
Offered options (3 of 20):
1. Scroll Boxes — Upon pickup, lose all Gold and choose 1 of 2 packs of cards. [Category: GOLD TRADE + CARD ADD]
2. Booming Conch — At the start of Elite combats, draw 2 additional cards. [Category: RELIC]
3. Neow's Torment — Upon pickup, add 1 Neow's Fury to your Deck. [Category: CARD ADD]
```

The category tags are derived by pattern-matching the relic description:
- Contains "remove" → CARD REMOVAL
- Contains "gold" or "Gold" in cost/gain context → GOLD TRADE
- Contains "Transform" → TRANSFORM
- Contains "Max HP" or "raise your Max HP" → MAX HP
- Contains "obtain" + "Relic" → RELIC
- Contains "Enchant" → ENCHANTMENT
- Contains "add" + "Deck" or "obtain" + "Card" → CARD ADD
- Contains "lose" + "HP" or "lose" + "Max HP" → HP TRADE
- Default: UNKNOWN (triggers low confidence)

This categorization runs server-side before prompt construction — it's a simple string match, not an LLM call.

### 5. Desktop Changes

**`eventEvalListener.ts`:**
When `eventState.event.is_ancient` is true, pass `evalType: "ancient"` instead of `"event"` in the API call.

**`event.ts` (`buildEventPrompt`):**
When `isAncient`, include the `event_id` in the prompt output so the API can look up the Ancient's data. Change the format to:
```
ANCIENT_EVENT_ID: NEOW
EVENT: Neow (ANCIENT)
...
```

The existing `ancientWarning` text (lines 48-50) is removed — the ancient addendum supersedes it with positive guidance instead of just defensive warnings.

## File Changes

| File | Change |
|---|---|
| `packages/shared/evaluation/prompt-builder.ts` | Remove gold from GAME FACTS. Remove gold from event addendum. Add `"ancient"` to `EvalType`. Add `"ancient"` to `TYPE_ADDENDA`. |
| `apps/web/src/app/api/evaluate/route.ts` | Add ancient DB enrichment: query `relics` + `events` tables when `evalType === "ancient"`. Inject `[Ancient Reference]` section into prompt. Add `categorizeAncientOption()` helper for description pattern matching. |
| `apps/desktop/src/features/evaluation/eventEvalListener.ts` | Pass `evalType: "ancient"` when `is_ancient` is true. |
| `apps/desktop/src/lib/eval-inputs/event.ts` | Include `event_id` in prompt output when `isAncient`. Remove `ancientWarning` (replaced by addendum). |

## Out of Scope

- Full addenda audit for all eval types (Approach 3 follow-up)
- Replacing `enchantment-lookup.ts` with DB-backed lookup
- Statistical evaluation fallback for ancient options (needs more data first)
