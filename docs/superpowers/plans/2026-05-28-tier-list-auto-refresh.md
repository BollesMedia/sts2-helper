# Tier List Auto-Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A weekly Vercel cron re-scrapes opted-in tier-list sources, auto-applies high-quality results and queues borderline ones for admin review, with backoff/dormancy, an audit log, and a manual "Refresh now" trigger — all surfaced in the existing admin page.

**Architecture:** A single shared orchestrator `runSourceRefresh(source, { trigger, deferMvRefresh })` ties together fetch → adapter parse → per-section card matching → quality gate → apply-or-queue → source-row bookkeeping + audit log. The cron endpoint loops due sources through it (deferring the MV refresh to once per run); the manual route calls it for one source (refreshing the MV immediately). The card-matching and section-apply logic — currently inline in the scrape and confirm routes from PR #146 — gets lifted into shared `apps/web/src/lib/tier-refresh/` helpers so both the interactive routes and the cron path use one implementation.

**Tech Stack:** Next.js 15 App Router (route handlers), TypeScript strict, Supabase (service client + a SQL migration + regenerated types), `sharp`-based dHash image matching, vitest, pnpm + turbo monorepo, zod for route schemas, Tailwind for the admin UI.

**Spec:** [docs/superpowers/specs/2026-05-28-tier-list-auto-refresh-design.md](../specs/2026-05-28-tier-list-auto-refresh-design.md)

**Prerequisite:** Builds on the merged manual-refresh work (PR #146): the `ScrapedSection[]` adapter contract, the scrape route's `sections[]` response, and the confirm route's `sections[]` payload with per-section supersession. All landed on `main`.

---

## Critical file-structure decision (read before starting)

The spec proposes `packages/shared/tier-refresh/run-source-refresh.ts` and `packages/shared/tier-sources/match-cards.ts`. **Do not put these in `packages/shared`.** The card-matching path depends on `apps/web/src/lib/image-hash` which imports `sharp` (native), `node:net`, and `node:dns/promises`. `sharp` is a dependency of `apps/web` only — `packages/shared` is also consumed by `apps/desktop` (Tauri), and forcing `sharp` into it risks the desktop build. The cron route, manual-refresh route, confirm route, Supabase service client (`@/lib/supabase/server`), and the MV-refresh RPC all already live in `apps/web`.

**Therefore every new orchestration/helper module in this plan lives under `apps/web/src/lib/tier-refresh/`, not `packages/shared`.** The only `packages/shared` changes are: the `supportsAutoRefresh` adapter flag (Phase 0) and the regenerated `database.types.ts` (Phase 1).

## File structure

Created:
- `supabase/migrations/029_tier_list_auto_refresh.sql` — schema (columns, partial unique index, audit + claim tables, trigger)
- `apps/web/src/lib/tier-refresh/types.ts` — shared TS types (`RefreshOutcome`, `RefreshResult`, `GateResult`, etc.)
- `apps/web/src/lib/tier-refresh/fetch-source-html.ts` (+ `.test.ts`) — server-side HTML fetch
- `apps/web/src/lib/tier-refresh/quality-gate.ts` (+ `.test.ts`) — per-section + source-level gate (pure)
- `apps/web/src/lib/tier-refresh/backoff.ts` (+ `.test.ts`) — counter transitions + `next_refresh_at` (pure)
- `apps/web/src/lib/tier-refresh/match-cards.ts` (+ `.test.ts`) — lifted from scrape route
- `apps/web/src/lib/tier-refresh/apply-sections.ts` (+ `.test.ts`) — lifted from confirm route
- `apps/web/src/lib/tier-refresh/run-source-refresh.ts` (+ `.test.ts`) — orchestrator
- `apps/web/src/lib/tier-refresh/run-cron-cycle.ts` — loop over due sources
- `apps/web/src/app/api/cron/refresh-tier-lists/route.ts` — cron entry
- `apps/web/src/app/api/admin/tier-lists/refresh/[sourceId]/route.ts` — manual refresh
- `apps/web/src/app/api/admin/tier-lists/accept-pending/[id]/route.ts` — promote pending
- `apps/web/src/app/api/admin/tier-lists/refresh-logs/route.ts` — activity feed
- `apps/web/src/app/api/admin/tier-lists/refresh-logs/[sourceId]/route.ts` — per-source history

Modified:
- `packages/shared/tier-sources/types.ts` + the 5 adapters — add `supportsAutoRefresh`
- `packages/shared/types/database.types.ts` — regenerated after migration
- `apps/web/vercel.json` — register the cron
- `apps/web/src/app/api/admin/tier-lists/scrape/route.ts` — import lifted `matchSection`
- `apps/web/src/app/api/admin/tier-lists/confirm/route.ts` — import lifted `applySection`
- `apps/web/src/app/api/admin/tier-lists/[id]/route.ts` — add DELETE (reject) + `auto_refresh_enabled` to PATCH
- `apps/web/src/app/admin/tier-lists/page.tsx` — activity panel, needs-review, edit-modal controls, source-row badge

**Repo conventions:** pnpm only; conventional commits (lowercase imperative ≤70 chars, no Co-Authored-By trailer); one commit per task unless a task says otherwise. Doc-only edits may go direct to main, but all code here goes through the worktree → PR flow.

---

## Precursor: issue + worktree

- [ ] **Step 1: Create the GitHub issue**

```bash
gh issue create \
  --title "feat(tier-lists): auto-refresh cron + quality gate + review queue" \
  --body "Implements docs/superpowers/specs/2026-05-28-tier-list-auto-refresh-design.md. Plan: docs/superpowers/plans/2026-05-28-tier-list-auto-refresh.md"
```

Capture the issue number. Branch: `feat/<num>-tier-list-auto-refresh`.

- [ ] **Step 2: Create the worktree**

```bash
git worktree add .worktrees/feat/<num>-tier-list-auto-refresh -b feat/<num>-tier-list-auto-refresh
cd .worktrees/feat/<num>-tier-list-auto-refresh
scripts/setup-worktree.sh
pnpm install --prefer-offline
```

- [ ] **Step 3: Verify the worktree boots**

Run: `pnpm --filter @sts2/web exec tsc --noEmit`
Expected: clean (this is the merged-main baseline).

---

## Phase 0: Adapter opt-in flag

The spec's rollout assumed `supportsAutoRefresh` landed in the prerequisite PR. It did NOT (verified: `grep supportsAutoRefresh packages/shared/tier-sources/*.ts` returns nothing). Add it now. This is the one unavoidable `packages/shared` change.

### Task 0: Add `supportsAutoRefresh` to the adapter contract

**Files:**
- Modify: `packages/shared/tier-sources/types.ts`
- Modify: `packages/shared/tier-sources/mobalytics.ts`, `tiermaker.ts`, `sts2companion.ts`, `nat1gaming.ts`, `slaythetierlist.ts`
- Modify: `packages/shared/tier-sources/registry.test.ts` (if it asserts adapter shape) or add a new assertion

- [ ] **Step 1: Add a registry test asserting the flag exists on every adapter**

In `packages/shared/tier-sources/registry.test.ts` (create the test if the file doesn't exist; check first with `ls packages/shared/tier-sources/registry.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { mobalyticsAdapter } from "./mobalytics";
import { tiermakerAdapter } from "./tiermaker";
import { sts2companionAdapter } from "./sts2companion";
import { nat1gamingAdapter } from "./nat1gaming";
import { slaythetierlistAdapter } from "./slaythetierlist";

describe("supportsAutoRefresh flag", () => {
  it("mobalytics opts in", () => {
    expect(mobalyticsAdapter.supportsAutoRefresh).toBe(true);
  });
  it("all other adapters opt out for now", () => {
    for (const a of [tiermakerAdapter, sts2companionAdapter, nat1gamingAdapter, slaythetierlistAdapter]) {
      expect(a.supportsAutoRefresh).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sts2/shared test registry`
Expected: FAIL (`supportsAutoRefresh` is undefined on every adapter).

- [ ] **Step 3: Add the field to the interface**

In `packages/shared/tier-sources/types.ts`, add to `TierListSourceAdapter` (after `label`):

```ts
export interface TierListSourceAdapter {
  readonly id: string;
  readonly label: string;
  /** Whether the cron auto-refresh path may fetch + re-scrape this source. */
  readonly supportsAutoRefresh: boolean;
  canHandle(url: string): boolean;
  parse(html: string, url: string): ScrapedTierList;
}
```

- [ ] **Step 4: Set the flag on each adapter**

In `mobalytics.ts`, add `supportsAutoRefresh: true,` to the adapter object (next to `id` / `label`). In the other four (`tiermaker.ts`, `sts2companion.ts`, `nat1gaming.ts`, `slaythetierlist.ts`), add `supportsAutoRefresh: false,`.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @sts2/shared test tier-sources && pnpm --filter @sts2/shared exec tsc --noEmit`
Expected: all green (the new test passes, existing adapter tests unaffected).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/tier-sources/
git commit -m "feat(tier-sources): add supportsAutoRefresh adapter flag"
```

---

## Phase 1: Migration + regenerated types

### Task 1: Write the migration

**Files:**
- Create: `supabase/migrations/029_tier_list_auto_refresh.sql`

- [ ] **Step 1: Write the migration file**

Paste verbatim (this is the spec's Schema block; the existing constraint name `tier_lists_unique` is confirmed in migration 022):

```sql
-- 029_tier_list_auto_refresh.sql
-- Auto-refresh: source scheduling/backoff columns, pending-review on snapshots,
-- audit log, cron concurrency claim, and an auto-enable trigger.

ALTER TABLE tier_list_sources
  ADD COLUMN auto_refresh_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN dormant boolean NOT NULL DEFAULT false,
  ADD COLUMN next_refresh_at timestamptz,
  ADD COLUMN last_refresh_attempted_at timestamptz,
  ADD COLUMN last_refresh_succeeded_at timestamptz,
  ADD COLUMN consecutive_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN consecutive_queue_only integer NOT NULL DEFAULT 0,
  ADD COLUMN last_failure_reason text;

CREATE INDEX tier_list_sources_due_idx
  ON tier_list_sources (next_refresh_at)
  WHERE auto_refresh_enabled = true AND dormant = false;

ALTER TABLE tier_lists
  ADD COLUMN review_status text NOT NULL DEFAULT 'none'
    CHECK (review_status IN ('none', 'pending')),
  ADD COLUMN gate_failure_reasons jsonb;

-- Pending drafts coexist with their active counterparts on the same
-- (source_id, game_version, published_at, character) key, so the old unique
-- constraint must scope to non-pending rows.
ALTER TABLE tier_lists DROP CONSTRAINT tier_lists_unique;
CREATE UNIQUE INDEX tier_lists_unique_non_pending
  ON tier_lists (source_id, game_version, published_at, character)
  WHERE review_status = 'none';

CREATE INDEX tier_lists_pending_review_idx
  ON tier_lists (review_status)
  WHERE review_status = 'pending';

CREATE TABLE tier_list_refresh_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES tier_list_sources(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('applied','partial','queued','failed','no_data')),
  trigger text NOT NULL CHECK (trigger IN ('cron','manual')),
  sections_attempted integer NOT NULL DEFAULT 0,
  sections_applied integer NOT NULL DEFAULT 0,
  sections_queued integer NOT NULL DEFAULT 0,
  error_detail jsonb,
  rejected_snapshot jsonb
);

CREATE INDEX tier_list_refresh_logs_source_started_idx
  ON tier_list_refresh_logs (source_id, started_at DESC);

CREATE TABLE tier_list_refresh_runs (
  id text PRIMARY KEY,
  claimed_at timestamptz,
  claimed_by text
);
INSERT INTO tier_list_refresh_runs (id) VALUES ('singleton');

CREATE OR REPLACE FUNCTION tier_list_sources_auto_refresh_enable()
  RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.auto_refresh_enabled = true
     AND (OLD.auto_refresh_enabled = false OR OLD.auto_refresh_enabled IS NULL)
     AND NEW.next_refresh_at IS NULL THEN
    NEW.next_refresh_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tier_list_sources_auto_refresh_enable_trg
  BEFORE UPDATE ON tier_list_sources
  FOR EACH ROW EXECUTE FUNCTION tier_list_sources_auto_refresh_enable();

-- RLS: new tables are admin/service-only. Match the existing tier_lists policy
-- style (service-role writes; authenticated admins read). Mirror whatever
-- migration 022 used for tier_lists — read it first and copy the policy shape.
ALTER TABLE tier_list_refresh_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tier_list_refresh_runs ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Match the RLS policy style to migration 022**

Read `supabase/migrations/022_community_tier_lists.sql` and find the RLS policies on `tier_lists` / `tier_list_sources`. Append equivalent policies for `tier_list_refresh_logs` (admin read + service write) and `tier_list_refresh_runs` (service-only — no public/admin read needed; it's an internal claim row). If 022 used a `profiles.role = 'admin'` check via a helper, reuse that exact predicate. Do not invent a new auth pattern.

- [ ] **Step 3: Dry-run the migration**

Run: `pnpm db:migrate:dry`
Expected: the migration parses and shows the planned changes with no errors. If `supabase` CLI requires a running local DB or login, and you can't run it in this environment, report DONE_WITH_CONCERNS and note that the migration is unverified against a live DB — the human applies it during rollout.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/029_tier_list_auto_refresh.sql
git commit -m "feat(db): auto-refresh schema migration"
```

### Task 2: Regenerate Supabase types

**Files:**
- Modify: `packages/shared/types/database.types.ts`

- [ ] **Step 1: Apply the migration to the dev DB, then regenerate**

The repo generates types from the live Supabase project (`apps/web` script `gen-types`). This requires the migration to be applied first.

```bash
pnpm db:migrate        # push 029 to the dev project
pnpm db:gen-types      # regenerate packages/shared/types/database.types.ts
```

If you cannot reach the Supabase project from this environment (no credentials / offline), STOP and report BLOCKED — the typed `SupabaseClient<Database>` calls in later tasks need the new tables/columns in `database.types.ts`. The human must run these two commands and hand back the regenerated file, OR you hand-edit `database.types.ts` to add the new columns/tables (less reliable; prefer regeneration).

- [ ] **Step 2: Verify the new shapes are present**

Run: `grep -E "auto_refresh_enabled|tier_list_refresh_logs|tier_list_refresh_runs|review_status|gate_failure_reasons" packages/shared/types/database.types.ts`
Expected: matches for all five.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @sts2/shared exec tsc --noEmit && pnpm --filter @sts2/web exec tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/types/database.types.ts
git commit -m "chore(db): regenerate types for auto-refresh schema"
```

---

## Phase 2: Pure helpers (fetch, gate, backoff)

These are dependency-light and fully unit-testable. Build them first so the orchestrator (Phase 4) composes tested units.

### Task 3: Shared types module

**Files:**
- Create: `apps/web/src/lib/tier-refresh/types.ts`

- [ ] **Step 1: Define the shared types**

```ts
import type { ScaleType } from "@sts2/shared/evaluation/tier-normalize";

export type RefreshTrigger = "cron" | "manual";

export type RefreshStatus =
  | "applied"
  | "partial"
  | "queued"
  | "failed"
  | "no_data";

/** One section's gate evaluation. */
export interface SectionGateResult {
  detectedCharacter: string | null;
  passed: boolean;
  checks: Array<{
    name: "match_rate" | "adapter_warnings" | "entry_count_delta";
    value: number;
    threshold: number;
    prior?: number;
    current?: number;
  }>;
}

export interface CoverageGateResult {
  priorCharacters: string[];
  currentCharacters: string[];
  passed: boolean;
}

export interface GateResult {
  perSection: SectionGateResult[];
  sourceLevel: { coverage: CoverageGateResult };
}

export interface RefreshResult {
  status: RefreshStatus;
  sectionsAttempted: number;
  sectionsApplied: number;
  sectionsQueued: number;
  reason?: string;
  errorDetail?: unknown;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @sts2/web exec tsc --noEmit`
Expected: clean. No commit yet — commit at the end of Task 5 with the other pure helpers, OR commit per-task. Per-task commit is fine here:

```bash
git add apps/web/src/lib/tier-refresh/types.ts
git commit -m "feat(tier-refresh): shared types module"
```

### Task 4: `fetchSourceHtml`

**Files:**
- Create: `apps/web/src/lib/tier-refresh/fetch-source-html.ts`
- Create: `apps/web/src/lib/tier-refresh/fetch-source-html.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// fetch-source-html.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchSourceHtml } from "./fetch-source-html";

afterEach(() => vi.restoreAllMocks());

describe("fetchSourceHtml", () => {
  it("returns html on 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("<html>ok</html>", { status: 200 }),
    ));
    const r = await fetchSourceHtml("https://example.com");
    expect(r).toEqual({ ok: true, html: "<html>ok</html>" });
  });

  it("returns http_<code> reason on non-200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 403 })));
    const r = await fetchSourceHtml("https://example.com");
    expect(r).toEqual({ ok: false, reason: "http_403" });
  });

  it("rejects oversized html", async () => {
    const big = "x".repeat(8 * 1024 * 1024 + 1);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(big, { status: 200 })));
    const r = await fetchSourceHtml("https://example.com");
    expect(r).toEqual({ ok: false, reason: "html_too_large" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sts2/web test fetch-source-html`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// fetch-source-html.ts
const REFRESH_UA =
  "Mozilla/5.0 (compatible; sts2-helper-tier-refresh/1.0; +https://sts2-helper.app/bots)";

const MAX_HTML_BYTES = 8 * 1024 * 1024;

export async function fetchSourceHtml(
  url: string,
): Promise<{ ok: true; html: string } | { ok: false; reason: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": REFRESH_UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error && err.name === "TimeoutError" ? "timeout" : "fetch_error",
    };
  }
  if (!res.ok) return { ok: false, reason: `http_${res.status}` };
  const html = await res.text();
  if (html.length === 0) return { ok: false, reason: "html_invalid" };
  if (html.length > MAX_HTML_BYTES) return { ok: false, reason: "html_too_large" };
  return { ok: true, html };
}
```

- [ ] **Step 4: Run + commit**

Run: `pnpm --filter @sts2/web test fetch-source-html` → PASS.

```bash
git add apps/web/src/lib/tier-refresh/fetch-source-html.ts apps/web/src/lib/tier-refresh/fetch-source-html.test.ts
git commit -m "feat(tier-refresh): server-side source html fetch"
```

### Task 5: Quality gate + backoff (pure logic)

**Files:**
- Create: `apps/web/src/lib/tier-refresh/quality-gate.ts` (+ `.test.ts`)
- Create: `apps/web/src/lib/tier-refresh/backoff.ts` (+ `.test.ts`)

- [ ] **Step 1: Write the gate test**

The gate takes per-section match results + prior-snapshot entry counts + the prior character set, and returns a `GateResult`. Define the input shape to match what `runSourceRefresh` will have after matching: for each section, `{ detectedCharacter, matchedCount, totalCount, warnings }`, plus `priorEntryCountByCharacter: Map<string|null, number>` and `priorCharacters: string[]`.

```ts
// quality-gate.test.ts
import { describe, it, expect } from "vitest";
import { evaluateGate } from "./quality-gate";

const base = {
  priorCharacters: ["ironclad", "silent"],
  priorEntryCountByCharacter: new Map<string | null, number>([
    ["ironclad", 100],
    ["silent", 100],
  ]),
};

describe("evaluateGate", () => {
  it("passes when all sections clean and coverage intact", () => {
    const r = evaluateGate(
      [
        { detectedCharacter: "ironclad", matchedCount: 99, totalCount: 100, warnings: [] },
        { detectedCharacter: "silent", matchedCount: 100, totalCount: 100, warnings: [] },
      ],
      base,
    );
    expect(r.perSection.every((s) => s.passed)).toBe(true);
    expect(r.sourceLevel.coverage.passed).toBe(true);
  });

  it("queues a section below 95% match rate", () => {
    const r = evaluateGate(
      [{ detectedCharacter: "ironclad", matchedCount: 78, totalCount: 100, warnings: [] },
       { detectedCharacter: "silent", matchedCount: 100, totalCount: 100, warnings: [] }],
      base,
    );
    expect(r.perSection.find((s) => s.detectedCharacter === "ironclad")!.passed).toBe(false);
    expect(r.perSection.find((s) => s.detectedCharacter === "silent")!.passed).toBe(true);
  });

  it("entry-count delta uses max(10%, 3 cards) floor — small drop within 3 cards passes", () => {
    const small = {
      priorCharacters: ["defect"],
      priorEntryCountByCharacter: new Map<string | null, number>([["defect", 20]]),
    };
    // 20 → 18 is a 10% drop but only 2 cards; floor of 3 cards means it passes.
    const r = evaluateGate(
      [{ detectedCharacter: "defect", matchedCount: 18, totalCount: 18, warnings: [] }],
      small,
    );
    expect(r.perSection[0].passed).toBe(true);
  });

  it("entry-count delta beyond floor queues", () => {
    const small = {
      priorCharacters: ["defect"],
      priorEntryCountByCharacter: new Map<string | null, number>([["defect", 20]]),
    };
    // 20 → 14 is 6 cards and 30% — beyond both floors.
    const r = evaluateGate(
      [{ detectedCharacter: "defect", matchedCount: 14, totalCount: 14, warnings: [] }],
      small,
    );
    expect(r.perSection[0].passed).toBe(false);
  });

  it("warnings present → section fails", () => {
    const r = evaluateGate(
      [{ detectedCharacter: "ironclad", matchedCount: 100, totalCount: 100, warnings: ["bad"] },
       { detectedCharacter: "silent", matchedCount: 100, totalCount: 100, warnings: [] }],
      base,
    );
    expect(r.perSection.find((s) => s.detectedCharacter === "ironclad")!.passed).toBe(false);
  });

  it("coverage fails when a prior character is missing from this run", () => {
    const r = evaluateGate(
      [{ detectedCharacter: "ironclad", matchedCount: 100, totalCount: 100, warnings: [] }],
      base, // prior had ironclad + silent; silent missing now
    );
    expect(r.sourceLevel.coverage.passed).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @sts2/web test quality-gate` → FAIL (module missing).

- [ ] **Step 3: Implement the gate**

```ts
// quality-gate.ts
import type { GateResult, SectionGateResult } from "./types";

const MATCH_RATE_MIN = 0.95;
const ENTRY_DELTA_PCT = 0.1;
const ENTRY_DELTA_CARD_FLOOR = 3;

export interface SectionMatchSummary {
  detectedCharacter: string | null;
  matchedCount: number;
  totalCount: number;
  warnings: string[];
}

export interface GateContext {
  priorCharacters: string[];
  priorEntryCountByCharacter: Map<string | null, number>;
}

export function evaluateGate(
  sections: SectionMatchSummary[],
  ctx: GateContext,
): GateResult {
  const perSection: SectionGateResult[] = sections.map((s) => {
    const checks: SectionGateResult["checks"] = [];
    const matchRate = s.totalCount === 0 ? 0 : s.matchedCount / s.totalCount;
    if (matchRate < MATCH_RATE_MIN) {
      checks.push({ name: "match_rate", value: matchRate, threshold: MATCH_RATE_MIN });
    }
    if (s.warnings.length > 0) {
      checks.push({ name: "adapter_warnings", value: s.warnings.length, threshold: 0 });
    }
    const prior = ctx.priorEntryCountByCharacter.get(s.detectedCharacter);
    if (prior != null) {
      const delta = Math.abs(s.totalCount - prior);
      const allowed = Math.max(prior * ENTRY_DELTA_PCT, ENTRY_DELTA_CARD_FLOOR);
      if (delta > allowed) {
        checks.push({
          name: "entry_count_delta",
          value: delta,
          threshold: allowed,
          prior,
          current: s.totalCount,
        });
      }
    }
    return { detectedCharacter: s.detectedCharacter, passed: checks.length === 0, checks };
  });

  const currentCharacters = sections
    .map((s) => s.detectedCharacter)
    .filter((c): c is string => c != null);
  const coveragePassed = ctx.priorCharacters.every((c) => currentCharacters.includes(c));

  return {
    perSection,
    sourceLevel: {
      coverage: {
        priorCharacters: ctx.priorCharacters,
        currentCharacters,
        passed: coveragePassed,
      },
    },
  };
}
```

- [ ] **Step 4: Write the backoff test**

```ts
// backoff.test.ts
import { describe, it, expect } from "vitest";
import { computeBackoff } from "./backoff";

const NOW = new Date("2026-06-01T04:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

describe("computeBackoff", () => {
  it("applied resets both counters and schedules +7d", () => {
    const r = computeBackoff("applied", { failures: 4, queueOnly: 2 }, NOW);
    expect(r).toMatchObject({ consecutive_failures: 0, consecutive_queue_only: 0, dormant: false, next_refresh_at: day(7) });
  });
  it("partial resets queueOnly and schedules +7d", () => {
    const r = computeBackoff("partial", { failures: 0, queueOnly: 2 }, NOW);
    expect(r).toMatchObject({ consecutive_queue_only: 0, next_refresh_at: day(7) });
  });
  it("queued increments queueOnly, +7d, dormant at 3", () => {
    expect(computeBackoff("queued", { failures: 0, queueOnly: 1 }, NOW)).toMatchObject({ consecutive_queue_only: 2, dormant: false });
    expect(computeBackoff("queued", { failures: 0, queueOnly: 2 }, NOW)).toMatchObject({ consecutive_queue_only: 3, dormant: true });
  });
  it("failure <3 schedules +1d", () => {
    expect(computeBackoff("failed", { failures: 0, queueOnly: 0 }, NOW)).toMatchObject({ consecutive_failures: 1, next_refresh_at: day(1), dormant: false });
  });
  it("failure 3..5 schedules +14d", () => {
    expect(computeBackoff("failed", { failures: 2, queueOnly: 0 }, NOW)).toMatchObject({ consecutive_failures: 3, next_refresh_at: day(14) });
  });
  it("failure >=6 goes dormant", () => {
    expect(computeBackoff("failed", { failures: 5, queueOnly: 0 }, NOW)).toMatchObject({ consecutive_failures: 6, dormant: true });
  });
});
```

- [ ] **Step 5: Implement backoff**

```ts
// backoff.ts
import type { RefreshStatus } from "./types";

export interface Counters {
  failures: number;
  queueOnly: number;
}

export interface BackoffUpdate {
  consecutive_failures: number;
  consecutive_queue_only: number;
  dormant: boolean;
  next_refresh_at: string;
}

const days = (now: Date, n: number) =>
  new Date(now.getTime() + n * 86_400_000).toISOString();

export function computeBackoff(
  status: RefreshStatus,
  counters: Counters,
  now: Date,
): BackoffUpdate {
  // Applied or partial: at least one section auto-applied → reset both counters.
  if (status === "applied" || status === "partial") {
    return {
      consecutive_failures: 0,
      consecutive_queue_only: 0,
      dormant: false,
      next_refresh_at: days(now, 7),
    };
  }
  // Queued-only: data flowed but nothing met the gate → +7d, dormant at 3.
  if (status === "queued") {
    const queueOnly = counters.queueOnly + 1;
    return {
      consecutive_failures: counters.failures,
      consecutive_queue_only: queueOnly,
      dormant: queueOnly >= 3,
      next_refresh_at: days(now, 7),
    };
  }
  // "failed" or "no_data": no usable data → +1d for first two, then +14d cooldown,
  // dormant at 6.
  const failures = counters.failures + 1;
  return {
    consecutive_failures: failures,
    consecutive_queue_only: counters.queueOnly,
    dormant: failures >= 6,
    next_refresh_at: failures < 3 ? days(now, 1) : days(now, 14),
  };
}
```

- [ ] **Step 6: Run both test files + commit**

Run: `pnpm --filter @sts2/web test quality-gate backoff` → PASS.

```bash
git add apps/web/src/lib/tier-refresh/quality-gate.ts apps/web/src/lib/tier-refresh/quality-gate.test.ts apps/web/src/lib/tier-refresh/backoff.ts apps/web/src/lib/tier-refresh/backoff.test.ts
git commit -m "feat(tier-refresh): quality gate and backoff logic"
```

---

## Phase 3: Lift shared matching + apply logic out of the routes

PR #146 left card-matching inline in `scrape/route.ts` (`matchSection`) and the deactivate-insert-dedup-insert-entries loop inline in `confirm/route.ts`. Extract both so `runSourceRefresh` reuses one implementation. These are refactors — existing route tests are the safety net, plus new focused tests on the extracted units.

### Task 6: Lift `matchSection` into `match-cards.ts`

**Files:**
- Create: `apps/web/src/lib/tier-refresh/match-cards.ts` (+ `.test.ts`)
- Modify: `apps/web/src/app/api/admin/tier-lists/scrape/route.ts`

- [ ] **Step 1: Read the current `matchSection` in scrape/route.ts**

Read `apps/web/src/app/api/admin/tier-lists/scrape/route.ts` fully. Identify `matchSection`, its helper closures (`normName`, `unmatchedName`, the candidate-scoping block, `NEUTRAL_COLORS`), and the `CardWithHash` / `MatchedCard` types it uses. These all move together.

- [ ] **Step 2: Move the matching code into `match-cards.ts`**

Create `apps/web/src/lib/tier-refresh/match-cards.ts` exporting `matchSection` and any types the scrape route's response needs (`MatchedCard`, `CardWithHash`, `CharacterParam`). Move `NEUTRAL_COLORS` and the helper closures with it. Keep the imports it needs (`@/lib/image-hash`, the `ScrapedSection` type from `@sts2/shared/tier-sources`).

The signature stays as built in #146:

```ts
export async function matchSection(
  section: ScrapedSection,
  fallbackCharacter: CharacterParam,
  candidates: CardWithHash[],
  scrapeHost: string,
): Promise<{ matched: MatchedCard[]; warnings: string[] }>;
```

- [ ] **Step 3: Update scrape/route.ts to import from the new module**

Replace the inline `matchSection` (and the moved helpers/types) in `scrape/route.ts` with an import from `@/lib/tier-refresh/match-cards`. The route keeps building its `candidates` list and looping `adapterResult.sections` exactly as before — only the function's home changed.

- [ ] **Step 4: Add a focused test for the extracted module**

```ts
// match-cards.test.ts
import { describe, it, expect } from "vitest";
import { matchSection } from "./match-cards";
// Build a section with one card whose name exactly matches a candidate so the
// alt/filename tier resolves without network hashing. Assert matched[0].cardId.
```

If `matchSection` always calls `fetchAndHashAll` (network) even when a name match exists, stub `@/lib/image-hash` with `vi.mock` so the test stays offline. Model the mock on how `confirm/route.test.ts` and other web tests stub modules. If stubbing proves heavy, keep the test minimal (assert the function is exported and returns the right shape for an empty section) and rely on the scrape route's existing coverage — note this in your report.

- [ ] **Step 5: Run scrape tests + typecheck**

Run: `pnpm --filter @sts2/web test scrape match-cards && pnpm --filter @sts2/web exec tsc --noEmit`
Expected: green. The scrape route behaves identically; only the import moved.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/tier-refresh/match-cards.ts apps/web/src/lib/tier-refresh/match-cards.test.ts apps/web/src/app/api/admin/tier-lists/scrape/route.ts
git commit -m "refactor(tier-refresh): lift matchSection into shared module"
```

### Task 7: Lift section-apply into `apply-sections.ts`

**Files:**
- Create: `apps/web/src/lib/tier-refresh/apply-sections.ts` (+ `.test.ts`)
- Modify: `apps/web/src/app/api/admin/tier-lists/confirm/route.ts`

- [ ] **Step 1: Read the confirm route's per-section loop**

Read `apps/web/src/app/api/admin/tier-lists/confirm/route.ts`. The per-section body does: (a) deactivate prior active rows for `(source_id, game_version, character)`, (b) insert a `tier_lists` row, (c) dedup entries by `card_id` keeping highest confidence, (d) insert entries. The source upsert happens once before the loop and stays in the route.

- [ ] **Step 2: Extract `applySection`**

Create `apps/web/src/lib/tier-refresh/apply-sections.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@sts2/shared/types/database.types";

export interface ApplySectionInput {
  sourceId: string;
  list: { character: string | null; game_version: string; published_at: string };
  entries: Array<{ card_id: string; raw_tier: string; note?: string | null; extraction_confidence?: number | null }>;
  imageUrl: string | null;
  ingestionMethod: "vision_llm" | "scraped" | "manual_confirm";
  /** When true, insert as a pending review draft instead of an active row. */
  queue?: boolean;
  gateFailureReasons?: unknown;
}

export interface ApplySectionResult {
  listId: string;
  entryCount: number;
}

export async function applySection(
  supabase: SupabaseClient<Database>,
  input: ApplySectionInput,
): Promise<ApplySectionResult> {
  // queue === true  → insert is_active=false, review_status='pending', gate_failure_reasons=...
  //                   and DO NOT deactivate the prior active row.
  // queue !== true  → deactivate prior active rows for (sourceId, game_version, character),
  //                   insert is_active=true, review_status='none'.
  // Both paths: dedup entries by card_id (highest extraction_confidence), insert entries.
  // Return { listId, entryCount }.
}
```

Move the dedup + insert logic verbatim from the confirm route. The only new behavior is the `queue` branch (pending insert, no deactivation) — that's what the cron's queued sections use.

- [ ] **Step 3: Rewire confirm/route.ts to call `applySection`**

In the confirm route's per-section loop, replace the inline deactivate/insert/dedup/insert-entries with `await applySection(supabase, { sourceId: source.id, list, entries, imageUrl, ingestionMethod, queue: false })`. The source upsert, the `inserted[]` accumulation, the unique-violation 409 handling, and the MV refresh stay in the route. (The unique-violation path now wraps the `applySection` call in try/catch, or `applySection` rethrows the Supabase error and the route maps 23505 → 409 as before.)

- [ ] **Step 4: Add a focused test for `applySection`**

```ts
// apply-sections.test.ts — stub the Supabase client, assert:
//  - active path: update(is_active:false) called for prior, insert(is_active:true) called.
//  - queue path: NO deactivation update; insert with review_status:'pending' + gate_failure_reasons.
//  - dedup: two entries same card_id → one inserted (higher confidence wins).
```

Build the Supabase stub in the style of the existing web route tests (chainable `.from().update().eq()` / `.insert().select()` mocks). If the existing confirm test was schema-only and there's no Supabase-stub precedent, create a minimal chainable mock here and document it.

- [ ] **Step 5: Run confirm + apply tests + typecheck**

Run: `pnpm --filter @sts2/web test confirm apply-sections && pnpm --filter @sts2/web exec tsc --noEmit`
Expected: green. Confirm route behavior unchanged for the active path.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/tier-refresh/apply-sections.ts apps/web/src/lib/tier-refresh/apply-sections.test.ts apps/web/src/app/api/admin/tier-lists/confirm/route.ts
git commit -m "refactor(tier-refresh): lift section-apply into shared module"
```

---

## Phase 4: The orchestrator

### Task 8: `runSourceRefresh`

**Files:**
- Create: `apps/web/src/lib/tier-refresh/run-source-refresh.ts` (+ `.test.ts`)

- [ ] **Step 1: Write the orchestrator test (stubbed deps)**

The function composes already-tested units, so its test focuses on branching: fetch-fail → `failed`; 0 sections → `no_data`; all gate-pass → `applied`; mixed → `partial`; all-queued → `queued`. Stub `fetchSourceHtml`, the adapter registry, `matchSection`, and `applySection` via `vi.mock`, and pass a chainable Supabase stub. Assert the returned `RefreshResult.status` and that a `tier_list_refresh_logs` row is inserted with matching counts, and that the source row is updated with the backoff result.

Write at least these cases:
```ts
it("fetch failure → status 'failed', +1d, failures incremented");
it("adapter returns 0 sections → status 'no_data'");
it("all sections pass gate → status 'applied', sections_applied = N");
it("some pass some fail → status 'partial'");
it("all sections queued → status 'queued', consecutive_queue_only incremented");
it("deferMvRefresh:false calls refresh_community_tier_consensus; true does not");
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @sts2/web test run-source-refresh` → FAIL.

- [ ] **Step 3: Implement the orchestrator**

```ts
// run-source-refresh.ts (shape; fill in per the spec's step list)
export async function runSourceRefresh(
  supabase: SupabaseClient<Database>,
  source: TierListSourceRow,
  options: { trigger: RefreshTrigger; deferMvRefresh: boolean; now?: Date },
): Promise<RefreshResult> {
  const now = options.now ?? new Date();
  // 0. stamp last_refresh_attempted_at = now
  // 1. fetchSourceHtml(source.source_url) → on !ok: record failure (backoff + audit log 'failed'/'no_data'), return
  // 2. resolveAdapter(source.source_url); adapter.parse(html, url) → sections
  //    - 0 sections → 'no_data' failure path
  // 3. build candidate card list (same as scrape route prep) + matchSection per section
  // 4. load prior active snapshots for this source → priorCharacters + priorEntryCountByCharacter
  // 5. evaluateGate(sectionSummaries, ctx)
  // 6. for each section: if section gate passes AND coverage passes → applySection(queue:false);
  //       else → applySection(queue:true, gateFailureReasons: <this section's slice>)
  //    derive status: all applied → 'applied'; some applied/some queued → 'partial'; none applied → 'queued'
  // 7. computeBackoff(status, counters, now) → update source row (incl. last_refresh_succeeded_at when applied/partial)
  // 8. insert tier_list_refresh_logs row { status, trigger, sections_attempted/applied/queued, error_detail }
  // 9. if !deferMvRefresh && (applied || partial): supabase.rpc("refresh_community_tier_consensus")
  // return RefreshResult
}
```

The `now` option exists so tests get deterministic timestamps (the runtime can't use `Date.now()` freely in workflow scripts, but route handlers can — `now` defaults to `new Date()`). Game-version tagging: query `game_versions` for the latest `released_at <= now()` and use it for each applied/queued section's `list.game_version` (per spec "Game version tagging").

Build the candidate-card list the same way the scrape route does (load the wiki card set + hashes). If that prep is also worth sharing, extract it into `match-cards.ts` as `loadCandidates(supabase, character?)` and reuse in both — but only if it's a clean lift; otherwise inline it here and note the duplication.

- [ ] **Step 4: Run + commit**

Run: `pnpm --filter @sts2/web test run-source-refresh && pnpm --filter @sts2/web exec tsc --noEmit` → green.

```bash
git add apps/web/src/lib/tier-refresh/run-source-refresh.ts apps/web/src/lib/tier-refresh/run-source-refresh.test.ts
git commit -m "feat(tier-refresh): runSourceRefresh orchestrator"
```

---

## Phase 5: Cron endpoint

### Task 9: `runCronCycle` + cron route

**Files:**
- Create: `apps/web/src/lib/tier-refresh/run-cron-cycle.ts`
- Create: `apps/web/src/app/api/cron/refresh-tier-lists/route.ts`
- Modify: `apps/web/vercel.json`

- [ ] **Step 1: Implement `runCronCycle`**

```ts
// run-cron-cycle.ts
export async function runCronCycle(supabase: SupabaseClient<Database>): Promise<Response> {
  const runStartedAt = new Date().toISOString();
  // 1. load due sources: auto_refresh_enabled && !dormant && next_refresh_at <= now()
  //    ordered by id. Filter to adapters where resolveAdapter(url)?.supportsAutoRefresh.
  // 2. sequential loop with a 270s overall budget + 60s per-source soft budget.
  //    call runSourceRefresh(supabase, source, { trigger: "cron", deferMvRefresh: true }).
  //    accumulate perSource results + whether any applied/partial occurred.
  // 3. after loop: if any source applied/partial, supabase.rpc("refresh_community_tier_consensus")
  //    capture refreshWarning on failure.
  // 4. return NextResponse.json summary { runStartedAt, runFinishedAt, sourcesAttempted,
  //    sourcesApplied, sourcesQueued, sourcesFailed, refreshWarning, perSource }.
}
```

Budget tracking: record a start timestamp; before each source check `Date.now() - start < 270_000`; break if exceeded. Remaining sources keep their old `next_refresh_at` and roll to tomorrow naturally (no special state).

- [ ] **Step 2: Implement the cron route**

Paste the spec's skeleton verbatim into `apps/web/src/app/api/cron/refresh-tier-lists/route.ts`: `export const maxDuration = 300`, the `Authorization: Bearer ${CRON_SECRET}` check, the `TIER_LIST_AUTO_REFRESH_DISABLED` kill switch, the `tier_list_refresh_runs` row-claim guard (claim with 15-min stale lease keyed on `x-vercel-id`, release in `finally`), and `return await runCronCycle(supabase)` inside the try.

- [ ] **Step 3: Register the cron in vercel.json**

Edit `apps/web/vercel.json` to add the second cron entry (keep the existing `sync-codex` one):

```json
{
  "crons": [
    { "path": "/api/cron/sync-codex", "schedule": "0 6 * * *" },
    { "path": "/api/cron/refresh-tier-lists", "schedule": "0 4 * * *" }
  ]
}
```

- [ ] **Step 4: Test the auth + kill-switch + claim guard**

Add `apps/web/src/app/api/cron/refresh-tier-lists/route.test.ts`:
```ts
it("401 without the bearer secret");
it("returns { disabled: true } when TIER_LIST_AUTO_REFRESH_DISABLED=true");
it("returns { skipped: 'run_already_in_progress' } when the claim row is already held");
```
Stub `process.env.CRON_SECRET`, the env flag, and the Supabase claim `.update().or().select()` returning `[]` (already-claimed). Don't try to exercise the full cycle here — `runSourceRefresh` is tested separately.

- [ ] **Step 5: Run + typecheck + commit**

Run: `pnpm --filter @sts2/web test refresh-tier-lists && pnpm --filter @sts2/web exec tsc --noEmit` → green.

```bash
git add apps/web/src/lib/tier-refresh/run-cron-cycle.ts apps/web/src/app/api/cron/refresh-tier-lists/ apps/web/vercel.json
git commit -m "feat(tier-lists): auto-refresh cron endpoint"
```

---

## Phase 6: Manual + queue-management routes

### Task 10: Manual "Refresh now" route

**Files:**
- Create: `apps/web/src/app/api/admin/tier-lists/refresh/[sourceId]/route.ts`

- [ ] **Step 1: Implement**

`POST`, wrapped in `withAdmin`. Loads the source row by `sourceId` (404 if missing). Calls `runSourceRefresh(supabase, source, { trigger: "manual", deferMvRefresh: false })` — bypassing the `next_refresh_at` / `dormant` due-checks (admin override; just run it). Returns the `RefreshResult` as JSON. On a successful applied/partial run the backoff update clears `dormant` (because `computeBackoff` resets and never sets dormant on apply) — that's how the admin un-dormants a source.

- [ ] **Step 2: Test**

`route.test.ts`: stub `withAdmin` to pass through, stub `runSourceRefresh` via `vi.mock`, assert 404 on missing source and that the result is returned on success.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/admin/tier-lists/refresh/
git commit -m "feat(tier-lists): manual refresh-now route"
```

### Task 11: Accept-pending + reject (DELETE) + PATCH flag

**Files:**
- Create: `apps/web/src/app/api/admin/tier-lists/accept-pending/[id]/route.ts`
- Modify: `apps/web/src/app/api/admin/tier-lists/[id]/route.ts` (add DELETE; add `auto_refresh_enabled` to PATCH schema)

- [ ] **Step 1: Implement accept-pending**

`POST`, `withAdmin`. Loads the pending `tier_lists` row by `id` (404 if missing or `review_status !== 'pending'`). Then: deactivate the currently-active row for `(source_id, game_version, character)`; set the pending row `is_active = true, review_status = 'none'`; `supabase.rpc("refresh_community_tier_consensus")`. Return success. (This is `applySection`'s active-path supersession but starting from an existing pending row — implement inline here, it's a small distinct operation; don't overload `applySection`.)

- [ ] **Step 2: Add DELETE (reject) to the [id] route**

In `apps/web/src/app/api/admin/tier-lists/[id]/route.ts`, add a `DELETE` handler (`withAdmin`). Before deleting the pending row, write a `tier_list_refresh_logs` row with `rejected_snapshot` populated from the row's `entries` summary + `gate_failure_reasons` + `entry_count` (so a post-mortem survives the delete). Then delete the `tier_lists` row (entries cascade if FK is ON DELETE CASCADE; verify in migration 022 — if not cascading, delete entries first). The `source_id` for the log row comes from the pending row.

- [ ] **Step 3: Add `auto_refresh_enabled` to the PATCH schema**

In the same `[id]/route.ts`, the existing PATCH `source` sub-schema gains `auto_refresh_enabled: z.boolean().optional()`. No special handling for `next_refresh_at` — the DB trigger from Task 1 sets it on the false→true transition.

- [ ] **Step 4: Test**

Extend/author `[id]/route.test.ts` and `accept-pending/[id]/route.test.ts`: accept promotes the pending row (assert deactivate + update calls); reject writes a log row then deletes; PATCH accepts `auto_refresh_enabled`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/admin/tier-lists/accept-pending/ apps/web/src/app/api/admin/tier-lists/[id]/route.ts
git commit -m "feat(tier-lists): accept/reject pending review rows"
```

### Task 12: Refresh-logs feed routes

**Files:**
- Create: `apps/web/src/app/api/admin/tier-lists/refresh-logs/route.ts`
- Create: `apps/web/src/app/api/admin/tier-lists/refresh-logs/[sourceId]/route.ts`

- [ ] **Step 1: Implement both GETs**

`refresh-logs/route.ts` (`GET`, `withAdmin`): returns the latest ~10 `tier_list_refresh_logs` rows across all sources (join source name), ordered `started_at DESC`. Accept optional `?sourceId=` to filter. `refresh-logs/[sourceId]/route.ts` (`GET`, `withAdmin`): returns the latest ~20 rows for that source.

- [ ] **Step 2: Test**

Minimal: stub Supabase select chain, assert the ordering/limit args and admin gating.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/admin/tier-lists/refresh-logs/
git commit -m "feat(tier-lists): refresh-logs feed routes"
```

---

## Phase 7: Admin UI

### Task 13: Recent activity panel + needs-review section

**Files:**
- Modify: `apps/web/src/app/admin/tier-lists/page.tsx`

- [ ] **Step 1: Add the "Recent refresh activity" panel**

At the top of the page (above the existing table), add a panel that fetches `/api/admin/tier-lists/refresh-logs` via the page's existing `useSWR` pattern. Render the last ~10 rows: source name, a status badge (applied=emerald, partial=amber, queued=sky, failed/no_data=rose), trigger, relative `started_at`, and the `error_detail`/reason when non-success. Clicking a row opens that source's history (reuse the Edit modal or a small new modal that hits `/refresh-logs/[sourceId]`).

- [ ] **Step 2: Add the "Needs review" section**

Below the activity panel, fetch pending rows. The page already loads tier_lists rows via `/api/admin/tier-lists`; extend that GET (in `apps/web/src/app/api/admin/tier-lists/route.ts`) to include `review_status` and `gate_failure_reasons`, then filter client-side for `review_status === 'pending'`. Group by source; for each pending row show source name, character, captured-at, and the gate-failure reasons as a bulleted list. Two buttons: Accept (`POST /accept-pending/[id]`) and Reject (`DELETE /[id]`). On success, revalidate the SWR keys.

- [ ] **Step 3: Typecheck + manual smoke (if dev server available) + commit**

Run: `pnpm --filter @sts2/web exec tsc --noEmit` → clean.

```bash
git add apps/web/src/app/admin/tier-lists/page.tsx apps/web/src/app/api/admin/tier-lists/route.ts
git commit -m "feat(admin/tier-lists): refresh activity + review queue UI"
```

### Task 14: Edit-modal auto-refresh controls + source-row badge

**Files:**
- Modify: `apps/web/src/app/admin/tier-lists/page.tsx`

- [ ] **Step 1: Edit-modal additions**

In the existing Edit modal, add an "Auto-refresh" toggle bound to `auto_refresh_enabled` (PATCHed via the existing source PATCH). Below it, show read-only status: dormant (yes/no), last attempted, last succeeded, `consecutive_failures`, `consecutive_queue_only`, last failure reason. Add a "Refresh now" button that POSTs `/api/admin/tier-lists/refresh/[sourceId]` and surfaces the returned status (toast or inline). These fields require the GET list route to return the new source columns — extend the `source:tier_list_sources!inner(...)` projection in `route.ts` to include `auto_refresh_enabled, dormant, next_refresh_at, last_refresh_attempted_at, last_refresh_succeeded_at, consecutive_failures, consecutive_queue_only, last_failure_reason`, and extend `IngestedRow.source` accordingly.

- [ ] **Step 2: Source-row badge + sort**

Add a small badge in each row: ✓ emerald if `auto_refresh_enabled && !dormant`, grey dot if disabled, ! rose if dormant. Add it as a sortable column alongside the existing staleness chip from PR #146.

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm --filter @sts2/web exec tsc --noEmit` → clean.

```bash
git add apps/web/src/app/admin/tier-lists/page.tsx apps/web/src/app/api/admin/tier-lists/route.ts
git commit -m "feat(admin/tier-lists): auto-refresh toggle and status badge"
```

---

## Phase 8: Final verification + PR

### Task 15: Full verification

- [ ] **Step 1: Full suite + lint + typecheck**

```bash
pnpm test
pnpm lint
pnpm -r exec tsc --noEmit
```
Expected: green; zero new lint warnings.

- [ ] **Step 2: Manual smoke (human, before enabling cron in prod)**

Per the spec's "Manual smoke test":
1. Apply migration 029 to the dev DB if not already (`pnpm db:migrate`).
2. In the admin UI, enable Auto-refresh on the mobalytics source only.
3. Hit "Refresh now" on that source. Verify: a snapshot set is applied or queued, a `tier_list_refresh_logs` row appears in the activity panel, the source row shows updated last-succeeded/last-attempted, and the consensus MV reflects new data.
4. Force a failure (temporarily point the source URL at a 404) and confirm the failure path: status `failed`, `consecutive_failures` increments, `next_refresh_at` moves +1d.
5. Confirm a pending row (if any) shows in "Needs review" with gate reasons, and Accept/Reject work.

The cron itself stays dormant in prod until a human flips `auto_refresh_enabled` on a source — shipping the code is safe (cron finds 0 due sources and returns `{ sourcesAttempted: 0 }`).

- [ ] **Step 3: Push + PR**

```bash
git push -u origin feat/<num>-tier-list-auto-refresh
gh pr create --title "feat(tier-lists): auto-refresh cron + quality gate + review queue" --body "$(cat <<'EOF'
## Summary
- Weekly Vercel cron (`/api/cron/refresh-tier-lists`, daily 04:00 UTC, per-source weekly cadence) re-scrapes opted-in sources via a shared `runSourceRefresh` orchestrator.
- Quality gate (per-section match-rate ≥95%, no adapter warnings, entry-count delta within max(±10%, ±3 cards); source-level character coverage) auto-applies clean sections and queues the rest for admin review.
- Backoff + dormancy on persistent failure or persistent queue-only outcomes; row-claim concurrency guard; audit log of every attempt.
- Manual "Refresh now" route reuses the same orchestrator. Admin UI gains a recent-activity panel, a needs-review queue with Accept/Reject, an auto-refresh toggle + status, and a source-row badge.
- Migration 029: scheduling/backoff columns, pending-review on snapshots, partial unique index, audit + claim tables, auto-enable trigger.

Closes #<num>

## Notes
- New orchestration code lives in `apps/web/src/lib/tier-refresh/` (NOT `packages/shared`) because card matching depends on `sharp`/node-only `image-hash`, an apps/web-only dependency. Spec's proposed `packages/shared` paths were adjusted accordingly.
- `supportsAutoRefresh` adapter flag added here (the prerequisite PR #146 did not include it).
- Cron ships dormant: no source has `auto_refresh_enabled=true` until a human flips it, so prod impact is zero until enabled.

## Test plan
- [x] `pnpm test` green
- [x] `pnpm lint` clean
- [x] `pnpm -r exec tsc --noEmit` clean
- [ ] Manual: migration applies; mobalytics manual "Refresh now" applies/queues + logs + MV refresh
- [ ] Manual: forced failure increments backoff; pending row Accept/Reject works

## Spec
[docs/superpowers/specs/2026-05-28-tier-list-auto-refresh-design.md](docs/superpowers/specs/2026-05-28-tier-list-auto-refresh-design.md)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: On merge — worktree cleanup (standing rule)**

```bash
cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper
git worktree remove .worktrees/feat/<num>-tier-list-auto-refresh
git branch -D feat/<num>-tier-list-auto-refresh
git checkout main && git pull --ff-only
```

---

## Spec-coverage cross-check

| Spec section | Covered by |
|---|---|
| Adapter `supportsAutoRefresh` opt-in | Task 0 |
| Migration: source columns, review_status, partial unique index, audit log, claim table, trigger, RLS | Task 1 |
| Regenerated types | Task 2 |
| Server-side fetch (UA, timeout, size cap) | Task 4 |
| Quality gate (match-rate, warnings, entry-count floor, coverage) + failure-reason payload | Task 5, Task 8 (wiring) |
| Backoff + dormancy (two counters) | Task 5 (logic), Task 8 (applied) |
| Lift matching into shared module | Task 6 |
| Lift section-apply + pending-queue insert | Task 7 |
| `runSourceRefresh` (fetch→parse→match→gate→apply/queue→bookkeeping→audit→MV) | Task 8 |
| Game-version tagging | Task 8 |
| Cron endpoint (auth, kill switch, claim guard, runCronCycle, deferred MV, summary) | Task 9 |
| vercel.json cron registration | Task 9 |
| Manual "Refresh now" (override due-checks, immediate MV, un-dormant) | Task 10 |
| Accept-pending (supersession from pending) | Task 11 |
| Reject with rejected_snapshot audit | Task 11 |
| PATCH `auto_refresh_enabled` (trigger handles next_refresh_at) | Task 11 |
| Refresh-logs feed + per-source history | Task 12 |
| Recent-activity panel | Task 13 |
| Needs-review queue (Accept/Reject) | Task 13 |
| Edit-modal auto-refresh toggle + status + Refresh now | Task 14 |
| Source-row badge + sort | Task 14 |
| Error-handling table (statuses, counters, next-refresh) | Task 5 + Task 8 |
| Unit + integration + manual smoke test coverage | Tasks 4-12 (unit), Task 15 (manual) |
| Rollout (cron ships dormant) | Task 15 |
