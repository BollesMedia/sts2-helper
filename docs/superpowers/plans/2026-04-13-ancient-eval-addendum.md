# Ancient Eval Addendum + Base Prompt Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix ancient event evaluations by adding a dedicated `ancient` eval type with data-driven prompt enrichment, and clean up the base prompt to remove gold language that causes Haiku hallucinations.

**Architecture:** Add `"ancient"` to the EvalType union and TYPE_ADDENDA in prompt-builder. When the desktop detects an ancient event, it passes `evalType: "ancient"` to the API. The API route enriches the prompt with relic descriptions and Ancient pool data from Supabase, then uses the ancient-specific system prompt addendum.

**Tech Stack:** TypeScript, Supabase, Vercel AI SDK, Claude Haiku 4.5

**Spec:** `docs/superpowers/specs/2026-04-13-ancient-eval-addendum-design.md`

---

### Task 1: Base Prompt Cleanup

**Files:**
- Modify: `packages/shared/evaluation/prompt-builder.ts`

- [ ] **Step 1: Remove gold sentence from GAME FACTS**

In `prompt-builder.ts`, replace line 39:

```typescript
// OLD (line 39):
- STS2 has 3 acts (no Act 4). Gold is valuable throughout Acts 1-2 for shops (removal, relics, potions). Only in Act 3 should you spend all remaining gold before the final boss — nothing comes after.

// NEW:
- STS2 has 3 acts. There is no Act 4.
```

- [ ] **Step 2: Remove gold line from event addendum**

In the `event` entry of `TYPE_ADDENDA`, remove this line:

```
- Gold: only valuable if shop is coming AND you need something from it.
```

The event addendum should become:
```typescript
  event: `
EVENT:
- HP loss: only take if reward advances win condition AND HP >60%.
- Curse: avoid unless reward is exceptional AND removal available soon.
- Card transform: only if transforming a Strike/Defend.
- Max HP: always valuable at higher ascension.`,
```

- [ ] **Step 3: Verify types compile**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && npx tsc --noEmit -p packages/shared/tsconfig.json`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/evaluation/prompt-builder.ts
git commit -m "fix: remove gold language from base prompt and event addendum"
```

---

### Task 2: Add `ancient` Eval Type and Addendum

**Files:**
- Modify: `packages/shared/evaluation/prompt-builder.ts`

- [ ] **Step 1: Add `"ancient"` to EvalType union**

Find the `EvalType` union (line 14) and add `"ancient"`:

```typescript
export type EvalType =
  | "card_reward"
  | "shop"
  | "map"
  | "rest_site"
  | "event"
  | "ancient"
  | "card_removal"
  | "card_upgrade"
  | "card_select"
  | "relic_select"
  | "boss_briefing";
```

- [ ] **Step 2: Add ancient addendum to TYPE_ADDENDA**

Add a new `ancient` entry to `TYPE_ADDENDA`, after the `event` entry:

```typescript
  ancient: `
ANCIENT EVENT:
- You MUST choose exactly one option. Evaluate all three against your current deck needs, act timing, and ascension.
- OPTION CATEGORIES — identify each option's category tag and apply the matching framework:
  - CARD REMOVAL (remove N cards): High priority when Strikes/Defends remain. Value decreases as deck thins. In Acts 1-2, removal is almost always the best option.
  - GOLD TRADE (lose/gain gold): Gold buys card removal (75-100g), relics, and potions at shops. Evaluate gold loss against remaining shop opportunities. Losing 99g at Act 1 is significant — that is one card removal. Gaining 150-300g is strong if shops remain.
  - TRANSFORM (transform N cards): Strong when transforming Strikes/Defends into random cards. Risky when transforming engine cards. Transform + upgrade is premium.
  - MAX HP (raise max HP by N): Scales with ascension — more valuable at Ascension 8+. Always solid, never bad.
  - RELIC (obtain random relic/specific relic): Permanent power. High priority unless the specific relic has a downside (curse, HP loss, boss relics with drawbacks).
  - ENCHANTMENT (enchant cards with X): Archetype-dependent. Evaluate the enchantment effect against current deck composition. Strong when it enhances core cards.
  - CARD ADD (add specific cards): Evaluate added cards the same as a card reward — do they advance the deck's win condition?
  - HP TRADE (lose HP/Max HP for reward): Only take if reward is high-value AND current HP can absorb the cost safely.
- Evaluate based on DESCRIPTIONS PROVIDED. Do not assume you know what an enchantment, relic, or card does beyond what the description says.
- If unsure about an option's effect, set confidence below 50.
- Reasoning must reference the specific trade-off: what you gain vs what you lose.`,
```

- [ ] **Step 3: Verify types compile**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && npx tsc --noEmit -p packages/shared/tsconfig.json`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/evaluation/prompt-builder.ts
git commit -m "feat: add ancient eval type with dedicated addendum"
```

---

### Task 3: Desktop — Pass `evalType: "ancient"` for Ancient Events

**Files:**
- Modify: `apps/desktop/src/features/evaluation/eventEvalListener.ts`
- Modify: `apps/desktop/src/lib/eval-inputs/event.ts`

- [ ] **Step 1: Update eventEvalListener to pass ancient evalType**

In `eventEvalListener.ts`, find the API dispatch call (around line 85-95). Change the `evalType` to be conditional on `is_ancient`:

```typescript
        const raw = await listenerApi
          .dispatch(
            evaluationApi.endpoints.evaluateEvent.initiate({
              evalType: eventState.event.is_ancient ? "ancient" : "event",
              context: ctx,
              runNarrative: getPromptContext(),
              mapPrompt,
              runId,
              gameVersion: null,
            })
          )
          .unwrap();
```

The only change is line `evalType: eventState.event.is_ancient ? "ancient" : "event",` — replacing the hardcoded `"event"`.

- [ ] **Step 2: Update buildEventPrompt to include event_id for ancients**

In `event.ts`, modify `buildEventPrompt` to include the `event_id` when `isAncient` is true, and remove the old `ancientWarning` (the addendum replaces it).

Replace the `ancientWarning` logic and the `EVENT:` line (lines 48-54):

```typescript
  // For ancients, include the event_id so the API can enrich from DB
  const eventHeader = params.isAncient
    ? `ANCIENT_EVENT_ID: ${params.eventId}\nANCIENT EVENT: ${params.eventName}`
    : `EVENT: ${params.eventName}`;

  return `${contextStr}

${eventHeader}
You must choose EXACTLY ONE option:
${optionsStr}
```

Remove the old `ancientWarning` variable and its usage entirely (lines 48-54 of the original).

- [ ] **Step 3: Add `eventId` to buildEventPrompt params**

Update the `buildEventPrompt` function signature to accept `eventId`:

```typescript
export function buildEventPrompt(params: {
  context: EvaluationContext;
  eventName: string;
  eventId: string;
  isAncient: boolean;
  options: EventOption[];
  runNarrative: string | null;
}): string {
```

- [ ] **Step 4: Pass eventId from eventEvalListener**

In `eventEvalListener.ts`, update the `buildEventPrompt` call (around line 72) to include `eventId`:

```typescript
        const mapPrompt = buildEventPrompt({
          context: ctx,
          eventName: eventState.event.event_name,
          eventId: eventState.event.event_id,
          isAncient: eventState.event.is_ancient,
          options,
          runNarrative: getPromptContext(),
        });
```

- [ ] **Step 5: Verify types compile**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && npx tsc --noEmit -p apps/desktop/tsconfig.json`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/features/evaluation/eventEvalListener.ts apps/desktop/src/lib/eval-inputs/event.ts
git commit -m "feat: pass evalType ancient and event_id for ancient events"
```

---

### Task 4: API Route — Ancient DB Enrichment + Prompt Injection

**Files:**
- Modify: `apps/web/src/app/api/evaluate/route.ts`

This is the most complex task. When `evalType === "ancient"`, the API:
1. Extracts the `ANCIENT_EVENT_ID` from the mapPrompt
2. Queries the `events` table for the Ancient's relic pool
3. Queries the `relics` table for descriptions of offered options
4. Categorizes each option by pattern-matching its description
5. Injects an `[Ancient Reference]` section into the prompt

- [ ] **Step 1: Add the `categorizeAncientOption` helper**

Add this function near the top of route.ts (after the imports, before the request type):

```typescript
/**
 * Categorize an ancient event option by pattern-matching its relic description.
 * Returns a category tag that maps to guidance in the ancient addendum.
 */
function categorizeAncientOption(description: string): string {
  const lower = description.toLowerCase();
  if (lower.includes("remove") && lower.includes("card")) return "CARD REMOVAL";
  if (lower.includes("transform")) return "TRANSFORM";
  if (lower.includes("raise your max hp") || lower.includes("max hp")) return "MAX HP";
  if (lower.includes("enchant")) return "ENCHANTMENT";
  if (
    (lower.includes("lose") && lower.includes("gold")) ||
    (lower.includes("gain") && lower.includes("gold"))
  ) return "GOLD TRADE";
  if (lower.includes("obtain") && lower.includes("relic")) return "RELIC";
  if (
    lower.includes("add") && lower.includes("deck") ||
    lower.includes("obtain") && lower.includes("card") ||
    lower.includes("card reward")
  ) return "CARD ADD";
  if (
    (lower.includes("lose") && lower.includes("hp")) ||
    (lower.includes("lose") && lower.includes("max hp"))
  ) return "HP TRADE";
  return "UNKNOWN";
}
```

- [ ] **Step 2: Add ancient enrichment in the map/event evaluation block**

In the `POST` handler, find the map/event evaluation block (line 248: `if (type === "map" && body.mapPrompt)`). Add ancient enrichment BEFORE the prompt is constructed (before line 249: `let mapPromptFull = ""`).

```typescript
  // ─── MAP/EVENT/REST/ETC EVALUATION (via mapPrompt) ───
  if (type === "map" && body.mapPrompt) {
    // Ancient event enrichment: pull relic descriptions + pool from DB
    let ancientReference = "";
    if (evalType === "ancient") {
      const eventIdMatch = body.mapPrompt.match(/ANCIENT_EVENT_ID:\s*(\S+)/);
      const eventId = eventIdMatch?.[1] ?? null;

      if (eventId) {
        try {
          // Fetch Ancient's relic pool from events table
          const [eventResult, relicsResult] = await Promise.all([
            supabase
              .from("events")
              .select("name, act, relics")
              .eq("id", eventId)
              .single(),
            supabase
              .from("relics")
              .select("name, description")
              .not("description", "is", null),
          ]);

          const ancientEvent = eventResult.data;
          const allRelics = relicsResult.data;

          if (ancientEvent && allRelics) {
            const relicMap = new Map(allRelics.map((r) => [r.name, r.description]));
            const poolSize = ancientEvent.relics?.length ?? 0;

            // Extract offered option names from the mapPrompt (format: "N. Title: Description")
            const optionMatches = body.mapPrompt.matchAll(/^\d+\.\s+(.+?):/gm);
            const offeredOptions: { name: string; description: string; category: string }[] = [];
            for (const match of optionMatches) {
              const optionName = match[1].trim();
              const relicDesc = relicMap.get(optionName) ?? "";
              offeredOptions.push({
                name: optionName,
                description: relicDesc,
                category: categorizeAncientOption(relicDesc),
              });
            }

            if (offeredOptions.length > 0) {
              const optionLines = offeredOptions
                .map((o, i) => `${i + 1}. ${o.name} — ${o.description} [${o.category}]`)
                .join("\n");
              ancientReference = `[Ancient: ${ancientEvent.name} | ${ancientEvent.act ?? "Unknown Act"} | Pool: ${poolSize} options]\nOffered options with categories:\n${optionLines}\n\n`;
            }
          }
        } catch (err) {
          console.error("[Evaluate] Ancient enrichment failed:", err);
          // Non-critical — continue without enrichment
        }
      }
    }

    let mapPromptFull = "";
    if (ancientReference) mapPromptFull += ancientReference;
    if (runHistory) mapPromptFull += `${runHistory}\n\n`;
```

Note: the existing line `if (runHistory) mapPromptFull += ...` moves after the ancient reference injection.

- [ ] **Step 3: Verify types compile**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/evaluate/route.ts
git commit -m "feat: add ancient DB enrichment with option categorization"
```

---

### Task 5: Integration Test — Verify End-to-End

**Files:**
- No file changes — validation only

- [ ] **Step 1: Verify the prompt builder changes**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && npx tsc --noEmit -p packages/shared/tsconfig.json`
Expected: No errors.

- [ ] **Step 2: Verify the desktop app changes**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && npx tsc --noEmit -p apps/desktop/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Verify the web app changes**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: No errors.

- [ ] **Step 4: Run existing tests**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && npx vitest run --reporter=verbose 2>&1 | tail -30`
Expected: All existing tests pass. No regressions.

- [ ] **Step 5: Manual verification — check prompt output**

Add a temporary `console.log` in the API route (or check server logs) when processing an ancient event. Verify:
- `evalType` is `"ancient"` (not `"event"`)
- System prompt includes the ancient addendum text ("ANCIENT EVENT:")
- `ancientReference` section is populated with relic descriptions and category tags
- The gold language does NOT appear in the base prompt GAME FACTS

Remove the temporary log after verification.

- [ ] **Step 6: Final commit (if adjustments needed)**

```bash
git add -A
git commit -m "fix: integration adjustments from testing"
```

Only commit if changes were needed.
