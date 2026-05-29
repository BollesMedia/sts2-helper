# Tier List Refresh + 4-Week Staleness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Refresh" action to the admin tier-lists page that re-runs ingestion with source metadata pre-filled and locked; teach the mobalytics adapter to split a single multi-character page into per-character sections; tighten the staleness threshold from 180/365 to 28/84 days.

**Architecture:** No schema changes. The adapter contract gains a `sections: ScrapedSection[]` return shape (most adapters return length 1; mobalytics returns one per character). Scrape and confirm endpoints accept the new multi-section payload. The admin page gains a Refresh button per row and a multi-tab preview when the adapter detects multiple characters. Staleness becomes two constant changes plus admin-table chips.

**Tech Stack:** Next.js 15 App Router, React (`use client`), TypeScript strict, Tailwind, Supabase (service client for admin routes), vitest, pnpm + turbo monorepo, zod for route schemas, `node-html-parser` for adapter DOM walks.

**Spec:** [docs/superpowers/specs/2026-05-28-tier-list-refresh-and-staleness-design.md](../specs/2026-05-28-tier-list-refresh-and-staleness-design.md)

**Repo conventions to honor:**
- pnpm only — never invoke npm/yarn.
- Conventional commits, lowercase imperative subjects, ≤ 70 chars. Group changes per task → 1 commit.
- For non-trivial code, the user's workflow expects `gh issue create` → `.worktrees/<branch>` → PR with `Closes #<num>`. Start with that before Task 1.

---

## Precursor: issue + worktree

- [ ] **Step 1: Create the GitHub issue**

```bash
gh issue create \
  --title "feat(tier-lists): refresh action + multi-character split + 4-week staleness" \
  --body "Implements docs/superpowers/specs/2026-05-28-tier-list-refresh-and-staleness-design.md"
```

Capture the issue number returned by `gh`. The branch name uses it: `feat/<num>-tier-list-refresh`.

- [ ] **Step 2: Create the worktree**

```bash
git worktree add .worktrees/feat/<num>-tier-list-refresh -b feat/<num>-tier-list-refresh
cd .worktrees/feat/<num>-tier-list-refresh
scripts/setup-worktree.sh
```

The `setup-worktree.sh` script symlinks `.vercel/` and `.env.local` from main so the app and CLI work.

- [ ] **Step 3: Verify the dev server boots from the worktree**

```bash
pnpm install
pnpm dev
```

Expected: web app starts on `http://localhost:3000`. Ctrl-C once verified.

---

## Phase 1: Staleness threshold (independent, ship-first)

Smallest change; lands first so the rest of the work doesn't block it. Once merged, all existing snapshots immediately re-classify against the new boundaries.

### Task 1: Update day-boundary tests

**Files:**
- Modify: `packages/shared/evaluation/community-tier.test.ts`

The current tests assert specific day boundaries against the old 180/365 thresholds (e.g., `published 179 days ago → 'fresh'`, `published 200 days ago → 'aging'`, `published 364 days ago → 'aging'`). Move them to 28/84 first so they fail with the current code, then change the constants.

- [ ] **Step 1: Update day-boundary assertions to new thresholds**

In `packages/shared/evaluation/community-tier.test.ts`, find the `classifyByTime` `describe` block and update:

```ts
it("published 27 days ago → 'fresh' (just under AGING_DAYS threshold)", () => {
  expect(classifyByTime(daysAgo(27))).toBe("fresh");
});

it("published 28 days ago → 'aging'", () => {
  expect(classifyByTime(daysAgo(28))).toBe("aging");
});

it("published 83 days ago → 'aging' (just under STALE_DAYS threshold)", () => {
  expect(classifyByTime(daysAgo(83))).toBe("aging");
});

it("published 84 days ago → 'excluded'", () => {
  expect(classifyByTime(daysAgo(84))).toBe("excluded");
});
```

Delete the now-obsolete `100 days` / `179 days` / `200 days` / `364 days` cases. Keep the `null publishedAt → 'fresh'`, `invalid date → 'fresh'`, `today → 'fresh'` cases — they're threshold-independent.

Any test elsewhere in the file that constructs fixtures with `daysAgo(100)` or similar mid-range values to test the combined `computeStaleness` path needs the same audit. Adjust the input days so the expected `staleness` value still holds against the new boundaries.

- [ ] **Step 2: Run the test file to verify the boundary tests fail**

Run: `pnpm --filter @sts2/shared test community-tier`

Expected: 4 boundary tests FAIL (`expected 'fresh' to be 'aging'` etc.); other tests in the file pass or fail depending on whether they used mid-range day values.

### Task 2: Change the constants

**Files:**
- Modify: `packages/shared/evaluation/community-tier.ts:26-27`

- [ ] **Step 1: Update the two constants**

```ts
const DAY_MS = 1000 * 60 * 60 * 24;
const AGING_DAYS = 28;
const STALE_DAYS = 84;
```

- [ ] **Step 2: Run the test file to verify all tests pass**

Run: `pnpm --filter @sts2/shared test community-tier`

Expected: all tests in the file PASS.

- [ ] **Step 3: Run the desktop test suite (consumer of community-tier signals)**

Run: `pnpm --filter @sts2/desktop test`

Expected: PASS. If any test fails because it baked in 180/365 day values, fix the fixture inline before committing.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/evaluation/community-tier.ts packages/shared/evaluation/community-tier.test.ts
# any consumer test files touched too
git commit -m "feat(community-tier): tighten staleness to 28/84 days"
```

---

## Phase 2: Adapter contract — sections[] shape (preserves single-section behavior)

Introduce the new `ScrapedSection` type and make every adapter return `sections: [single-section]` without changing what gets matched. This lets the rest of the pipeline migrate to the new shape before mobalytics learns to split.

### Task 3: Add the ScrapedSection type

**Files:**
- Modify: `packages/shared/tier-sources/types.ts`

- [ ] **Step 1: Add the new types**

Replace the existing `ScrapedTierList` and `TierListSourceAdapter` interfaces with:

```ts
import type { ScaleType } from "../evaluation/tier-normalize";

export interface ScrapedCard {
  tier: string;
  imageUrl: string;
  externalId?: string;
  name?: string;
}

export interface ScrapedSection {
  /** "ironclad" | "silent" | "regent" | "necrobinder" | "defect" | null */
  detectedCharacter: string | null;
  scaleType: ScaleType;
  scaleConfig?: { map: Record<string, number> };
  cards: ScrapedCard[];
  warnings: string[];
}

export interface ScrapedTierList {
  adapterId: string;
  sections: ScrapedSection[];
  /** Adapter-level warnings (vs section-level). */
  warnings: string[];
}

export interface TierListSourceAdapter {
  readonly id: string;
  readonly label: string;
  canHandle(url: string): boolean;
  parse(html: string, url: string): ScrapedTierList;
}
```

The previous flat `cards` / `scaleType` / `detectedCharacter` fields on `ScrapedTierList` are removed; consumers will read them from `sections[0]` (single-section adapters) or iterate sections (multi-section adapters).

### Task 4: Update mobalytics adapter to single-section sections[]

**Files:**
- Modify: `packages/shared/tier-sources/mobalytics.ts`
- Modify: `packages/shared/tier-sources/mobalytics.test.ts`

Keep the existing whole-DOM walking behavior, but wrap the output in `sections: [single-section]` with `detectedCharacter: null`.

- [ ] **Step 1: Update the existing test to assert the new shape**

In `packages/shared/tier-sources/mobalytics.test.ts`, update the existing fixture test so it asserts `result.sections[0].cards` instead of `result.cards`:

```ts
it("parses single-character section into sections[0]", () => {
  const result = mobalyticsAdapter.parse(FIXTURE_HTML, FIXTURE_URL);
  expect(result.adapterId).toBe("mobalytics");
  expect(result.sections).toHaveLength(1);
  expect(result.sections[0].detectedCharacter).toBe(null);
  expect(result.sections[0].scaleType).toBe("letter_6");
  expect(result.sections[0].cards.length).toBeGreaterThan(0);
  expect(result.warnings).toEqual([]);
});
```

- [ ] **Step 2: Run the test to verify it fails on the new shape**

Run: `pnpm --filter @sts2/shared test mobalytics`

Expected: FAIL (`Cannot read properties of undefined (reading '0')` or similar — `result.sections` doesn't exist yet).

- [ ] **Step 3: Update the adapter return**

In `packages/shared/tier-sources/mobalytics.ts`, change the bottom of `parse(...)`:

```ts
    if (cards.length === 0) {
      warnings.push(
        "No mobalytics CDN images found. Paste the outerHTML of the tier container.",
      );
    }

    return {
      adapterId: "mobalytics",
      sections: [
        {
          detectedCharacter: null,
          scaleType: "letter_6",
          cards,
          warnings,
        },
      ],
      warnings: [],
    };
  },
};
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @sts2/shared test mobalytics`

Expected: PASS.

### Task 5: Update other adapters to sections[] wrappers

**Files:**
- Modify: `packages/shared/tier-sources/tiermaker.ts`
- Modify: `packages/shared/tier-sources/sts2companion.ts`
- Modify: `packages/shared/tier-sources/nat1gaming.ts`
- Modify: `packages/shared/tier-sources/slaythetierlist.ts`
- Modify: each adapter's `*.test.ts`

Each adapter currently returns `{ adapterId, scaleType, detectedCharacter, cards, warnings }`. Wrap that into `{ adapterId, sections: [{ detectedCharacter, scaleType, scaleConfig?, cards, warnings }], warnings: [] }`.

- [ ] **Step 1: Update tiermaker test to assert sections[0] shape**

```ts
it("returns single section", () => {
  const result = tiermakerAdapter.parse(FIXTURE_HTML, FIXTURE_URL);
  expect(result.sections).toHaveLength(1);
  expect(result.sections[0].cards.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sts2/shared test tiermaker`
Expected: FAIL.

- [ ] **Step 3: Update tiermaker adapter to wrap output**

In `packages/shared/tier-sources/tiermaker.ts`, change the return at the bottom of `parse(...)`:

```ts
  return {
    adapterId: "tiermaker",
    sections: [
      {
        detectedCharacter,
        scaleType,
        ...(scaleConfig ? { scaleConfig } : {}),
        cards,
        warnings,
      },
    ],
    warnings: [],
  };
```

(`scaleType`, `detectedCharacter`, `scaleConfig` come from whatever variables the existing function uses — preserve them.)

- [ ] **Step 4: Repeat the same three-step cycle for sts2companion, nat1gaming, slaythetierlist**

For each of the three remaining adapters, in order:

(a) Open `<adapter>.test.ts`. Replace the existing "returns cards" / equivalent test with the sections-shape assertion:

```ts
it("returns single section", () => {
  const result = <adapter>Adapter.parse(FIXTURE_HTML, FIXTURE_URL);
  expect(result.sections).toHaveLength(1);
  expect(result.sections[0].cards.length).toBeGreaterThan(0);
});
```

(b) Run `pnpm --filter @sts2/shared test <adapter>` and confirm FAIL.

(c) Open `<adapter>.ts`. Find the bottom of `parse(...)` where it returns `{ adapterId, scaleType, detectedCharacter, cards, warnings }` (the exact field set may vary). Wrap that flat object into the new shape:

```ts
return {
  adapterId: "<adapter>",
  sections: [
    {
      detectedCharacter,        // whatever the existing function computed
      scaleType,                // whatever the existing function computed
      ...(scaleConfig ? { scaleConfig } : {}),
      cards,
      warnings,
    },
  ],
  warnings: [],
};
```

(d) Run `pnpm --filter @sts2/shared test <adapter>` and confirm PASS.

Do not introduce new fields or rename existing ones; the wrap is mechanical.

- [ ] **Step 5: Run the full adapter test suite**

Run: `pnpm --filter @sts2/shared test tier-sources`

Expected: all adapter tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/tier-sources/
git commit -m "refactor(tier-sources): wrap adapter output in sections[]"
```

---

## Phase 3: Scrape route consumes sections[]

The scrape route currently runs candidate matching on a single flat `cards` array. After this phase it runs matching per section and returns `sections[]` to the caller.

### Task 6: Update scrape route to per-section matching

**Files:**
- Modify: `apps/web/src/app/api/admin/tier-lists/scrape/route.ts`

The existing route reads the adapter result, runs `findNearest`/`matchByFilename` against a character-filtered candidate set, and returns `{ matched, unmatched, scaleType, detectedCharacter, warnings }`.

The new shape: iterate `result.sections`, run matching per section (using each section's `detectedCharacter` as the character hint when present, falling back to the request's `character` param), return `{ sections: [{ matched, unmatched, scaleType, detectedCharacter, warnings }] }`.

- [ ] **Step 1: Refactor the per-section matching into a helper**

The existing POST handler does (1) filter `candidates` to a character-scoped subset (using `NEUTRAL_COLORS` + the request's `character`), then (2) loop over `adapterResult.cards` calling `matchByFilename` and `findNearest`, building `matched` / `unmatched` arrays. Lift those two steps into one helper that takes a section instead of the request:

```ts
type CharacterParam =
  | "ironclad" | "silent" | "defect" | "regent" | "necrobinder"
  | null | undefined;

async function matchSection(
  section: ScrapedSection,
  fallbackCharacter: CharacterParam,
  candidates: CardWithHash[],
): Promise<{
  matched: Awaited<ReturnType<typeof matchOne>>[];
  unmatched: UnmatchedCard[];
  warnings: string[];
}> {
  const sectionCharacter = section.detectedCharacter ?? fallbackCharacter ?? null;

  // Lift the existing candidate-scoping block here. The current logic filters
  // `candidates` by joining the character's color + NEUTRAL_COLORS. Move the
  // exact same code; only the input changes from `character` (request param)
  // to `sectionCharacter`.
  const scopedCandidates = /* lifted as-is */;

  // Lift the existing per-card matching loop. Iterate `section.cards` and
  // produce the same matched/unmatched shapes the route returns today.
}
```

Don't introduce new behavior — this step is a pure extract-method. Keep `MatchedCard` / `UnmatchedCard` type aliases local to the route (or inline) since they're only used here. If TypeScript complains about implicit `any` on the lifted destructured types, infer with `Awaited<ReturnType<typeof helper>>` instead of writing the type out.

- [ ] **Step 2: Loop over sections in the POST handler and assemble new response**

```ts
const adapterResult = adapter.parse(html, url);

const sectionsOut = await Promise.all(
  adapterResult.sections.map(async (section) => {
    const result = await matchSection(section, character, candidates);
    return {
      detectedCharacter: section.detectedCharacter,
      scaleType: section.scaleType,
      scaleConfig: section.scaleConfig,
      matched: result.matched,
      unmatched: result.unmatched,
      warnings: [...section.warnings, ...result.warnings],
    };
  }),
);

return NextResponse.json({
  sections: sectionsOut,
  warnings: adapterResult.warnings,
});
```

- [ ] **Step 3: Add a route-level test for the new shape**

Create `apps/web/src/app/api/admin/tier-lists/scrape/route.test.ts` if it doesn't exist. The route is a Next.js route handler; test it by importing `POST` directly and calling with a `Request`.

```ts
import { describe, it, expect, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/api-admin-auth", () => ({
  withAdmin: (handler: unknown) => handler,
}));
// add minimal Supabase + image-hash mocks per the existing test patterns in the repo

describe("POST /api/admin/tier-lists/scrape", () => {
  it("returns sections[] from a single-section adapter", async () => {
    const html = readFileSync(
      join(__dirname, "__fixtures__/mobalytics-silent.html"),
      "utf8",
    );
    const req = new Request("http://localhost/api/admin/tier-lists/scrape", {
      method: "POST",
      body: JSON.stringify({
        url: "https://mobalytics.gg/sts2/tier-lists",
        html,
        character: "silent",
      }),
    });
    const res = await POST(req as never, {} as never);
    const data = await res.json();
    expect(data.sections).toHaveLength(1);
    expect(data.sections[0].matched).toBeInstanceOf(Array);
  });
});
```

If the repo has no precedent for testing Next.js route handlers, skip this test step and rely on the integration test from the admin page in Phase 5.

- [ ] **Step 4: Run tests + manual smoke**

Run: `pnpm --filter @sts2/web test` (or whatever the web package's test command resolves to)

Manual smoke: `pnpm dev`, go to `/admin/tier-lists`, paste a known-working tiermaker HTML, click Scrape, confirm the preview still renders. The admin page hasn't been updated yet to consume `sections[]`, so this step verifies the route in isolation via network tab or `curl`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/admin/tier-lists/scrape/
git commit -m "feat(tier-lists/scrape): return sections[] from adapter"
```

---

## Phase 4: Confirm route accepts sections[]

The confirm route currently runs the deactivate-and-insert flow for one `(source, list, entries)` triple. After this phase, the payload is `{ source, sections: [{ list, entries }] }` and the route loops.

### Task 7: Extend confirm route schema and handler

**Files:**
- Modify: `apps/web/src/app/api/admin/tier-lists/confirm/route.ts`

- [ ] **Step 1: Update the zod schema to accept sections[]**

The current `bodySchema` (in `confirm/route.ts:~30-60`) shapes the body as `{ imageUrl, ingestionMethod, source, list, entries }`. Refactor to extract the existing `list` and `entries` sub-schemas verbatim into a reusable `sectionSchema`, then add a `sections` field that wraps an array of those, gated by a `refine` for backwards compat:

```ts
// Verbatim copies of the existing `list` and `entries` zod sub-schemas.
const sectionListSchema = z.object({
  // ← copy of the existing `list` schema from the current file
});
const sectionEntriesSchema = z.array(/* ← copy of the existing entry schema */);

const sectionSchema = z.object({
  list: sectionListSchema,
  entries: sectionEntriesSchema,
});

const bodySchema = z.object({
  imageUrl: z.string().nullable(),
  ingestionMethod: z.enum(["vision_llm", "scraped", "manual_confirm"]),
  source: z.object({
    // ← copy of the existing `source` schema verbatim
  }),
  // Backwards-compat: accept either `sections: [...]` or the legacy `list`+`entries` pair.
  sections: z.array(sectionSchema).optional(),
  list: sectionListSchema.optional(),
  entries: sectionEntriesSchema.optional(),
}).refine(
  (b) => Boolean(b.sections) || (Boolean(b.list) && Boolean(b.entries)),
  { message: "Must include sections[] or (list + entries)" },
);
```

No new fields are introduced; this is purely a wrapping change so existing callers continue to work.

In the handler, normalize the single-shape into `sections`:

```ts
const sections = parsed.data.sections ?? [
  { list: parsed.data.list!, entries: parsed.data.entries! },
];
```

- [ ] **Step 2: Loop the existing deactivate-and-insert path per section**

Wrap the body of the existing handler that does "deactivate prior + insert tier_lists row + dedupe + insert entries" in a `for (const section of sections)` loop. The source upsert happens once before the loop.

For each section: deactivate priors scoped to `(source.id, section.list.game_version, section.list.character)`, then insert the new `tier_lists` row and its entries. The unique-violation error path stays per-section.

The response includes `{ inserted: [{ sectionIndex, listId, entryCount }] }`.

- [ ] **Step 3: Add a per-section unit/integration test**

If the repo has a confirm-route test, extend it. If not, write a focused test that calls `POST` with a 3-section payload (using a stub Supabase client) and asserts:
- 3 `tier_lists` rows inserted, each `is_active = true`.
- Prior active rows for each `(source, character)` got deactivated.
- Response payload includes 3 entries in `inserted`.

```ts
it("inserts one tier_lists row per section", async () => {
  const supabase = mockSupabaseWithPriorActive();
  // …build the request body with 3 sections, different characters…
  const res = await POST(req as never, {} as never);
  const data = await res.json();
  expect(data.inserted).toHaveLength(3);
  expect(supabase.from("tier_lists").update).toHaveBeenCalledTimes(3); // deactivate
  expect(supabase.from("tier_lists").insert).toHaveBeenCalledTimes(3); // insert
});
```

- [ ] **Step 4: Backwards-compat smoke test**

The schema's `refine` lets the old `list + entries` shape still work. Add a test asserting that:

```ts
it("accepts legacy { list, entries } payload as a single section", async () => {
  // …
  expect(data.inserted).toHaveLength(1);
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @sts2/web test confirm`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/admin/tier-lists/confirm/
git commit -m "feat(tier-lists/confirm): accept sections[] payload"
```

---

## Phase 5: Mobalytics multi-character splitting

With the contract migrated, mobalytics learns to walk character sections and emit one `ScrapedSection` per detected character.

### Task 8: Capture a multi-character fixture

**Files:**
- Create: `packages/shared/tier-sources/__fixtures__/mobalytics-all-characters.html`

- [ ] **Step 1: Save the page source**

Save a trimmed copy of the `https://mobalytics.gg/slay-the-spire-2/tier-lists/cards` HTML provided during brainstorming (or grab a fresh copy from the live page). The fixture needs to include:
- The 5 `<h2>` headers ("Ironclad Tier List", "Silent Tier List", "Regent Tier List", "Necrobinder Tier List", "Defect Tier List").
- For each, the surrounding `<section>` with tier-label divs (carrying `--x-backgroundColor`) and card `<img>` elements with `https://cdn.mobalytics.gg/...` srcs.

The full page is ~250kB and contains a lot of layout chrome. Trim non-relevant `<script>`, `<style>`, and navigation chrome to keep the fixture under ~100kB. Keep all 5 sections' card grids intact.

### Task 9: Detect character sections in mobalytics adapter

**Files:**
- Modify: `packages/shared/tier-sources/mobalytics.ts`
- Modify: `packages/shared/tier-sources/mobalytics.test.ts`

- [ ] **Step 1: Add the multi-character test**

In `mobalytics.test.ts`:

```ts
const ALL_CHARS_FIXTURE = readFileSync(
  join(__dirname, "__fixtures__/mobalytics-all-characters.html"),
  "utf8",
);

it("splits a multi-character page into one section per character", () => {
  const result = mobalyticsAdapter.parse(
    ALL_CHARS_FIXTURE,
    "https://mobalytics.gg/slay-the-spire-2/tier-lists/cards",
  );
  expect(result.sections).toHaveLength(5);
  const chars = result.sections.map((s) => s.detectedCharacter).sort();
  expect(chars).toEqual(["defect", "ironclad", "necrobinder", "regent", "silent"]);
  for (const section of result.sections) {
    expect(section.cards.length).toBeGreaterThan(5); // sanity: real lists have ≥10
    expect(section.scaleType).toBe("letter_6");
  }
});

it("single-section HTML still parses as one section with character=null", () => {
  // The existing FIXTURE_HTML is a single-character paste — no h2 split.
  const result = mobalyticsAdapter.parse(FIXTURE_HTML, FIXTURE_URL);
  expect(result.sections).toHaveLength(1);
  expect(result.sections[0].detectedCharacter).toBe(null);
});
```

- [ ] **Step 2: Run to verify the multi-character test fails**

Run: `pnpm --filter @sts2/shared test mobalytics`
Expected: FAIL — multi-character returns 1 section, not 5.

- [ ] **Step 3: Implement the section splitter**

In `mobalytics.ts`, add a character-detection regex and a section-walker:

```ts
const CHARACTER_HEADER_RE =
  /^(ironclad|silent|regent|necrobinder|defect)\s+tier\s*list$/i;

function findCharacterSections(root: HTMLElement): Array<{
  character: string;
  rootEl: HTMLElement;
}> {
  const sections: Array<{ character: string; rootEl: HTMLElement }> = [];
  const headers = root.querySelectorAll("h2");
  for (const h of headers) {
    const text = h.text.trim();
    const m = text.match(CHARACTER_HEADER_RE);
    if (!m) continue;
    // Walk up to the nearest <section> ancestor.
    let cur: HTMLElement | null = h as HTMLElement;
    while (cur && cur.tagName !== "SECTION") {
      cur = cur.parentNode as HTMLElement | null;
    }
    if (cur) {
      sections.push({ character: m[1].toLowerCase(), rootEl: cur });
    }
  }
  return sections;
}
```

Replace the bottom of `parse(...)` so it tries character splitting first and falls back to the existing whole-DOM walk:

```ts
parse(html) {
  const root = parseHtml(html);
  const characterSections = findCharacterSections(root as unknown as HTMLElement);

  if (characterSections.length > 0) {
    const sections: ScrapedSection[] = [];
    for (const { character, rootEl } of characterSections) {
      const cards: ScrapedCard[] = [];
      let currentTier: string | null = null;
      walkForCards(rootEl, (state) => {
        // …same walker as the existing whole-DOM logic, but scoped to rootEl
      }, { setTier: (t) => (currentTier = t), pushCard: (c) => cards.push(c) });
      sections.push({
        detectedCharacter: character,
        scaleType: "letter_6",
        cards,
        warnings: cards.length === 0
          ? [`No cards found in ${character} section`]
          : [],
      });
    }
    return { adapterId: "mobalytics", sections, warnings: [] };
  }

  // Fallback: existing whole-DOM walk → single section.
  const cards: ScrapedCard[] = [];
  let currentTier: string | null = null;
  walkForCards(root as unknown as HTMLElement, /* … */);
  const warnings: string[] = [];
  if (cards.length === 0) {
    warnings.push(
      "No mobalytics CDN images found. Paste the outerHTML of the tier container.",
    );
  }
  return {
    adapterId: "mobalytics",
    sections: [
      { detectedCharacter: null, scaleType: "letter_6", cards, warnings },
    ],
    warnings: [],
  };
},
```

Lift the existing `walk` function into a reusable `walkForCards(node, handlers)` that takes setTier/pushCard callbacks, so the multi-character path and the fallback path share the same tier-label + img detection logic. Don't duplicate.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @sts2/shared test mobalytics`
Expected: both new tests PASS, the existing single-section test still PASSes.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/tier-sources/mobalytics.ts \
  packages/shared/tier-sources/mobalytics.test.ts \
  packages/shared/tier-sources/__fixtures__/mobalytics-all-characters.html
git commit -m "feat(tier-sources/mobalytics): split multi-character pages"
```

---

## Phase 6: Admin UI — Refresh action + multi-section preview

The admin page gains a Refresh button per row, a wizard mode that pre-fills + locks source metadata, and a multi-section preview when the adapter returns >1 section.

### Task 10: Add Refresh button and pre-fill state

**Files:**
- Modify: `apps/web/src/app/admin/tier-lists/page.tsx`

- [ ] **Step 1: Add a `refreshing` state alongside the existing wizard state**

Near the existing `useState` declarations at the top of the page component:

```ts
type RefreshContext = {
  sourceId: string;
  sourceMeta: SourceMeta;
  // pre-fill: character, game_version, published_at, scale_type, trust_weight, source_url, author
};

const [refreshing, setRefreshing] = useState<RefreshContext | null>(null);
```

When `refreshing !== null`, the wizard renders with the source-meta inputs disabled (`readonly` + dimmed) and skips straight to the upload/paste step. The submit handler still calls `confirm` as today but with `source.id` taken from `refreshing.sourceId` (so the source row isn't re-derived from author + type).

- [ ] **Step 2: Add the Refresh button next to Edit in the row's actions cell**

Find the existing row action cell that renders Edit:

```tsx
<button onClick={() => setEditing(row)}>Edit</button>
<button onClick={() => beginRefresh(row)}>Refresh</button>
```

Add a `beginRefresh(row: IngestedRow)` handler that:
1. Builds a `RefreshContext` from the row's source + list fields.
2. Sets the wizard's current source-meta state to those values.
3. Sets `ingestMode` to `image` if the row's `source_type === "image"`, else `scrape`.
4. Pre-fills `sourceMeta.source_url` from the row (locked for `scrape` mode).
5. Sets `refreshing = ctx` so the UI knows to render the locked banner.

- [ ] **Step 3: Render a "Refreshing existing source" banner at the top of the wizard**

When `refreshing !== null`:

```tsx
<div className="rounded border border-amber-500 bg-amber-950/40 p-3 text-sm">
  Refreshing existing source <strong>{refreshing.sourceMeta.author}</strong>.
  Source fields are locked. Upload a new image / paste fresh HTML below.
</div>
```

Make sure the existing source-meta input fields render as read-only spans (or `<input disabled>`) when `refreshing !== null`.

### Task 11: Multi-section preview with per-character checkboxes

**Files:**
- Modify: `apps/web/src/app/admin/tier-lists/page.tsx`

After Phase 3 the scrape endpoint returns `sections: [...]`. The admin page already renders one preview pane; extend it to handle N.

- [ ] **Step 1: Update the preview state shape to hold sections[]**

The existing state probably looks something like `{ matched, unmatched, scaleType, ... }`. Change it to:

```ts
interface PreviewSection {
  detectedCharacter: string | null;
  scaleType: ScaleType;
  matched: MatchedCard[];
  unmatched: UnmatchedCard[];
  warnings: string[];
  /** Per-section opt-out checkbox state, default true. */
  include: boolean;
}

const [previewSections, setPreviewSections] = useState<PreviewSection[]>([]);
const [activeSectionIdx, setActiveSectionIdx] = useState(0);
```

- [ ] **Step 2: Render a tab bar above the preview when sections.length > 1**

```tsx
{previewSections.length > 1 && (
  <div className="flex border-b border-zinc-700">
    {previewSections.map((s, i) => (
      <button
        key={i}
        onClick={() => setActiveSectionIdx(i)}
        className={i === activeSectionIdx ? "border-b-2 border-amber-400" : ""}
      >
        {s.detectedCharacter ?? "Unknown"}
        <input
          type="checkbox"
          checked={s.include}
          onChange={(e) =>
            setPreviewSections((prev) =>
              prev.map((p, j) =>
                j === i ? { ...p, include: e.target.checked } : p,
              ),
            )
          }
          onClick={(e) => e.stopPropagation()}
        />
      </button>
    ))}
  </div>
)}
```

The existing preview body renders against `previewSections[activeSectionIdx]` instead of the old flat state.

- [ ] **Step 3: Confirm submits only the checked sections**

The submit handler builds `sections: previewSections.filter((s) => s.include).map(...)` and POSTs to `/api/admin/tier-lists/confirm` with the new payload shape from Phase 4.

- [ ] **Step 4: Manual smoke**

Run: `pnpm dev`, go to `/admin/tier-lists`, paste the mobalytics all-characters HTML, verify:
1. Preview renders 5 tabs.
2. Each tab's card grid is character-correct.
3. Unchecking a tab and confirming only inserts the checked sections (check the audit by visiting the table after).

- [ ] **Step 5: Refresh-from-existing-row smoke**

Edit a row → click Refresh → wizard opens with source-meta locked → paste fresh HTML → confirm → verify the prior row is `is_active = false` and the new one is `is_active = true`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/admin/tier-lists/page.tsx
git commit -m "feat(admin/tier-lists): refresh action + multi-section preview"
```

---

## Phase 7: Staleness badge on admin rows

Small visual polish so the admin can spot stale lists at a glance.

### Task 12: Render fresh/aging/excluded chips on each row

**Files:**
- Modify: `apps/web/src/app/admin/tier-lists/page.tsx`

- [ ] **Step 1: Add a `classifyRowStaleness(publishedAt: string)` helper**

Inline in the page (not pulled into a shared util yet — YAGNI):

```ts
function classifyRowStaleness(publishedAt: string): "fresh" | "aging" | "excluded" {
  const ageDays = (Date.now() - new Date(publishedAt).getTime()) / 86_400_000;
  if (Number.isNaN(ageDays)) return "fresh";
  if (ageDays < 28) return "fresh";
  if (ageDays < 84) return "aging";
  return "excluded";
}
```

The thresholds intentionally duplicate `AGING_DAYS`/`STALE_DAYS` from `community-tier.ts`. Don't import them — they're domain constants, and an inline copy keeps the UI dependency-light. If they ever diverge it's a one-line fix.

- [ ] **Step 2: Render a chip in the row**

Next to the existing `published_at` column:

```tsx
<span
  className={
    "ml-2 inline-block rounded px-1.5 py-0.5 text-xs " +
    (status === "fresh"
      ? "bg-emerald-900/40 text-emerald-300"
      : status === "aging"
      ? "bg-amber-900/40 text-amber-300"
      : "bg-rose-900/40 text-rose-300")
  }
>
  {status}
</span>
```

- [ ] **Step 3: Sort the table by staleness rank by default**

Order: excluded → aging → fresh, then by `ingested_at` desc. The existing fetch returns `.order("ingested_at", { ascending: false })`; sort client-side after staleness classification so the admin sees what needs attention first.

- [ ] **Step 4: Manual smoke**

Visit `/admin/tier-lists`. Existing 100+ day rows show as `excluded` (red), 30-day rows as `aging` (amber), recent rows as `fresh` (green). Sorted with red at the top.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/admin/tier-lists/page.tsx
git commit -m "feat(admin/tier-lists): staleness chip and sort order"
```

---

## Final verification + PR

- [ ] **Step 1: Run the full test suite**

```bash
pnpm test
```

Expected: green. If the repo has separate lint/typecheck commands:

```bash
pnpm lint
pnpm typecheck   # or: pnpm -r exec tsc --noEmit
```

- [ ] **Step 2: End-to-end manual smoke**

`pnpm dev`, then exercise:
1. Edit modal still works (metadata-only edits).
2. New upload still works (vision LLM + scrape paths).
3. Refresh on a website-source row pre-fills source-meta and accepts a re-paste.
4. Mobalytics all-characters paste produces 5 preview tabs; confirming inserts 5 active rows; the prior 5 active rows for that source are now `is_active = false`.
5. Mobalytics single-section paste (just one character's HTML) still works — produces 1 preview, 1 insert.
6. Staleness chips render correctly across the row population.

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin feat/<num>-tier-list-refresh
gh pr create --title "feat(tier-lists): refresh action + multi-character split + 4-week staleness" \
  --body "$(cat <<'EOF'
## Summary
- Adds Refresh action to admin tier-lists table with source-meta pre-fill and lock.
- Mobalytics adapter splits a single multi-character page into per-character sections; preview UI renders tabs + per-character checkboxes; confirm endpoint accepts sections[].
- Staleness thresholds tightened from 180/365 to 28/84 days. Admin table shows fresh/aging/excluded chip per row.

Closes #<num>

## Test plan
- [x] `pnpm test` green
- [x] Manual: existing Edit modal unchanged
- [x] Manual: existing upload flow unchanged
- [x] Manual: Refresh on Mobalytics row produces 5-tab preview; confirm replaces 5 active rows
- [x] Manual: Refresh on single-character paste still works as one section
- [x] Manual: staleness chips render across the row population

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: After PR merges, clean up**

```bash
cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper
git worktree remove .worktrees/feat/<num>-tier-list-refresh
git branch -D feat/<num>-tier-list-refresh
```

---

## Spec-coverage cross-check

| Spec section | Covered by |
|---|---|
| Adapter contract: `parse(html, url)` returns `{ sections: ScrapedSection[] }` | Tasks 3-5 |
| Mobalytics: detect `<h2>X Tier List</h2>`, ascend to `<section>`, emit per-character `ScrapedSection` | Tasks 8, 9 |
| Other adapters wrap output as single-section array | Task 5 |
| Scrape endpoint returns sections[]; per-section matching uses `detectedCharacter` as candidate filter | Task 6 |
| Confirm endpoint accepts sections[]; loops with deactivate-and-insert per character; backwards-compat for legacy single-shape | Task 7 |
| Admin table "Refresh" button per row | Task 10 |
| Wizard pre-fills + locks source meta when refreshing | Task 10 |
| Multi-section preview: tabs + per-character checkboxes | Task 11 |
| Single-section path unchanged (no tabs) | Task 11 (default render) |
| Staleness thresholds 28 / 84 in `classifyByTime` | Tasks 1-2 |
| Version-aware logic unchanged | Tasks 1-2 (constants only) |
| Admin table staleness chip + sort | Task 12 |
| No DB migration, no schema change | (entire plan touches no SQL) |
