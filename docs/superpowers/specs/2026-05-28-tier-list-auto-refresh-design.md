# Tier List Auto-Refresh — Design

## Problem

Manual refresh ([2026-05-28-tier-list-refresh-and-staleness-design.md](2026-05-28-tier-list-refresh-and-staleness-design.md)) closes the loop on *editing* existing tier lists. But with the staleness threshold dropping to 28 days, even a small library of sources turns into a weekly chore for whoever runs the admin panel. Authors publish refreshes on their own cadence; the admin shouldn't have to remember to pull them.

This spec defines an auto-refresh system: a cron job that periodically re-scrapes opted-in sources, applies the result if quality is high, and queues it for review otherwise. The goal word from the requirements is "robust" — that means observable, gracefully degraded, recoverable, and conservative about mutating live data.

## Prerequisites

This spec **builds on** [2026-05-28-tier-list-refresh-and-staleness-design.md](2026-05-28-tier-list-refresh-and-staleness-design.md). The auto-refresh path reuses:
- The `ScrapedSection[]` adapter contract (multi-character splitting).
- The confirm endpoint's `sections[]` payload and supersession logic.
- The 28 / 84-day staleness thresholds.

That spec ships first; this one assumes those changes are landed.

## Goals / non-goals

**In scope**
- Weekly per-source automated re-scraping for adapters that opt in.
- Server-side URL fetch from a Vercel cron function.
- Quality gate that classifies each scrape result as auto-apply, queue-for-review, or hard-fail.
- Pending-review queue surfaced in the existing admin UI.
- Backoff + dormancy when a source persistently fails.
- Audit log of every cron-source attempt.
- Manual "Refresh now" trigger reusing the same code path.

**Out of scope**
- Image-source auto-refresh. By definition image sources have no `source_url` to re-fetch.
- Headless-browser rendering (Playwright / Vercel Sandbox). Initial fetch is plain HTTP with realistic headers; if blocked, source is flagged for manual refresh. We can layer in a paid scraping API later if blocking is widespread.
- Auto-OCR'ing screenshots from social media / YouTube thumbnails. Out of scope forever in this design — that's a different product surface.
- Per-card edits during auto-refresh. Quality gate is whole-snapshot; if it fails, the *whole* snapshot is queued, not a diff.
- Slack / email alerts in v1. Failures surface in the admin UI and Vercel cron logs; richer alerting is a follow-up.
- Multi-character coverage requirements for *new* sources. A source can be auto-refresh-enabled even if it only covers one character; the "every prior character present" gate is a delta check, not a coverage requirement.

## Architecture

```
                        Vercel Cron (daily 04:00 UTC)
                                  │
                                  ▼
                  POST /api/cron/refresh-tier-lists
                                  │
                                  ▼
   load due sources: auto_refresh_enabled AND !dormant
                  AND next_refresh_at <= now()
                  AND adapter.supportsAutoRefresh
                                  │
                                  ▼
          ┌─────────── for each source ───────────┐
          │                                       │
          │   fetch(source_url, browser-UA)       │
          │           │                           │
          │           ├─ fetch fails ─► record    │
          │           │   failure +  backoff      │
          │           │                           │
          │           ▼                           │
          │   adapter.parse(html, url)            │
          │   → ScrapedSection[]                  │
          │           │                           │
          │           ▼                           │
          │   per-section quality gate            │
          │   ├─ pass  ──► confirm path           │
          │   │              (deactivate prior,   │
          │   │               insert active)      │
          │   ├─ fail  ──► insert as              │
          │   │              review_status=pending│
          │   └─ no-data ─► record failure        │
          │                                       │
          │   write tier_list_refresh_logs row    │
          │   update next_refresh_at = now()+7d   │
          │                                       │
          └────── next source / time-budget check ┘
                                  │
                                  ▼
                  return run summary as JSON
```

### Vercel Cron registration

Append to existing [apps/web/vercel.json](apps/web/vercel.json) (the file already declares one cron for `sync-codex`):

```json
{
  "crons": [
    { "path": "/api/cron/sync-codex", "schedule": "0 6 * * *" },
    { "path": "/api/cron/refresh-tier-lists", "schedule": "0 4 * * *" }
  ]
}
```

Daily at 04:00 UTC. Per-source weekly cadence is enforced by `next_refresh_at`, not by the cron schedule itself — so a daily cron is fine and gives us same-day retry after a failure.

### Cron endpoint

`GET /api/cron/refresh-tier-lists` — matches the existing [sync-codex cron pattern](apps/web/src/app/api/cron/sync-codex/route.ts) (GET handler, `Authorization: Bearer ${CRON_SECRET}` check, `export const maxDuration = 300`). No `withCron` wrapper needed; if it gets reused a second time we can extract one then.

Skeleton:

```ts
export const maxDuration = 300;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (process.env.TIER_LIST_AUTO_REFRESH_DISABLED === "true") {
    return NextResponse.json({ disabled: true });
  }

  const supabase = createServiceClient();

  // Concurrency guard: a row-level claim with a stale-lease fallback. Vercel
  // can retry cron invocations and the supersession path is not idempotent.
  // We avoid pg advisory locks because Supabase's connection pooler (PgBouncer
  // in transaction mode) releases them between RPC calls. A claimed_at row
  // outlives the connection.
  const invocationId = request.headers.get("x-vercel-id") ?? crypto.randomUUID();
  const { data: claimed } = await supabase
    .from("tier_list_refresh_runs")
    .update({ claimed_at: new Date().toISOString(), claimed_by: invocationId })
    .eq("id", "singleton")
    .or(
      `claimed_at.is.null,claimed_at.lt.${new Date(Date.now() - 15 * 60 * 1000).toISOString()}`,
    )
    .select();

  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ skipped: "run_already_in_progress" });
  }

  try {
    return await runCronCycle(supabase);
  } finally {
    await supabase
      .from("tier_list_refresh_runs")
      .update({ claimed_at: null, claimed_by: null })
      .eq("id", "singleton")
      .eq("claimed_by", invocationId);
  }
}
```

The 15-minute stale-lease is well above the 270s function budget so a normal run releases the claim itself, and a crashed run's claim auto-expires before the next day's cron.

`runCronCycle` behavior:

- Loads due sources (`auto_refresh_enabled AND !dormant AND next_refresh_at <= now() AND adapter.supportsAutoRefresh`) in source-id order.
- Iterates sequentially. Each source attempt has a 60s per-source soft budget; the overall function has a 270s budget; if either is exhausted, bail.
- **Does not refresh the MV per source** — collects the set of source_ids whose snapshots changed and refreshes the MV once at the end of the run. (Avoids the lock storm flagged in review.)
- Returns a summary: `{ runStartedAt, runFinishedAt, sourcesAttempted, sourcesApplied, sourcesQueued, sourcesFailed, perSource: [{ sourceId, status, reason? }] }`.


### Server-side fetch

```ts
const REFRESH_UA =
  "Mozilla/5.0 (compatible; sts2-helper-tier-refresh/1.0; +https://sts2-helper.app/bots)";

async function fetchSourceHtml(url: string): Promise<
  | { ok: true; html: string }
  | { ok: false; reason: string }
> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": REFRESH_UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return { ok: false, reason: `http_${res.status}` };
  const html = await res.text();
  if (html.length > 8 * 1024 * 1024) return { ok: false, reason: "html_too_large" };
  return { ok: true, html };
}
```

Cloudflare-fronted sites (mobalytics) may return 403 to non-browser UAs. If they do consistently, the source falls into the failure / backoff path and the admin gets visibility into "we can't auto-fetch this; you'll need to paste HTML manually." Plan-B is a paid scraping-API adapter; explicitly deferred.

### Adapter opt-in

Add to the adapter interface:

```ts
interface TierListSourceAdapter {
  // … existing …
  readonly supportsAutoRefresh: boolean;
}
```

v1 sets `supportsAutoRefresh: true` only on `mobalytics`. Other adapters get `false` until their fetch+parse path is validated end-to-end. This is a code-level flag (not DB) because it's a property of the adapter implementation, not the source row.

### Quality gate

Run **per section** (per character) returned by the adapter:

| Check | Threshold | Why |
|-------|-----------|-----|
| Match rate | ≥ 95% (matched cards / total extracted) | Catches adapter-level drift when a site changes its DOM and extraction starts producing garbage |
| Adapter warnings | empty array | Adapter signals it couldn't trust its own output |
| Entry count delta | outside `max(±10%, ±3 cards)` of prior active snapshot for the same `(source_id, character)` triggers queue | Catches truncation / over-extraction. The 3-card floor stops borderline-small lists (20-card characters in early access) from queueing on every normal author update |
| Character coverage | every character present in the *prior* active snapshot set for this source must also appear in *this* run's sections | Prevents partial scrapes from silently dropping a character |

The **character-coverage** check is a source-level gate (compared once across all sections), the other three are per-section. If a single section fails any per-section check, that section is queued for review; other sections in the same run can still auto-apply.

If the source-level coverage check fails, *all* sections from that run are queued, even if they individually would have passed.

Concrete failure-reason payload stored in `tier_lists.gate_failure_reasons`:

```jsonc
{
  "perSection": [
    { "checks": [], "passed": true },
    {
      "checks": [
        { "name": "match_rate", "value": 0.78, "threshold": 0.95 },
        { "name": "entry_count_delta", "value": 0.18, "threshold": 0.10, "prior": 119, "current": 97 }
      ],
      "passed": false
    }
  ],
  "sourceLevel": {
    "coverage": { "priorCharacters": ["ironclad","silent","regent","necrobinder","defect"], "currentCharacters": ["ironclad","silent"], "passed": false }
  }
}
```

### Pending review storage

No new table. `tier_lists` gets two columns:

- `review_status text not null default 'none'`. Values: `'none' | 'pending'`. Active and inactive rows from manual ingestion stay `'none'`.
- `gate_failure_reasons jsonb`. Null unless `review_status = 'pending'`.

A queued snapshot is inserted with `is_active = false` and `review_status = 'pending'`. Because the `community_tier_consensus` materialized view already filters on `is_active = true`, queued rows are invisible to the evaluator — they do not influence card scoring.

Acceptance flow (admin clicks Accept on a pending row):
1. Find the currently-active row for `(source_id, game_version, character)` and set `is_active = false`.
2. Update the pending row: `is_active = true, review_status = 'none'`.
3. Refresh the MV.

This is the same supersession logic confirm uses, just with a different starting point.

Rejection: delete the pending row. We don't keep a record of rejected drafts; the audit log in `tier_list_refresh_logs` is sufficient.

### Backoff and dormancy

Two counters on `tier_list_sources` track different failure modes:

- `consecutive_failures` — incremented when a refresh produces no usable data (fetch error, zero sections, adapter throw).
- `consecutive_queue_only` — incremented when a refresh ran cleanly but every section landed in the review queue (no sections auto-applied). Reset to 0 whenever any section auto-applies.

Behavior per attempt:

- **Applied** (at least one section auto-applied): reset both counters, set `last_refresh_succeeded_at = now()`, `next_refresh_at = now() + 7d`.
- **Queued-only** (sections produced, none auto-applied): increment `consecutive_queue_only`, set `next_refresh_at = now() + 7d`.
  - `consecutive_queue_only >= 3`: set `dormant = true`. Three weeks of every-section-queued means the source is systematically drifting against our gate — probably a site restructure — and the admin needs to investigate before we keep producing review work.
- **Failure** (no data flowed): increment `consecutive_failures`, set `last_failure_reason`.
  - `consecutive_failures < 3`: `next_refresh_at = now() + 1d` (retry tomorrow).
  - `consecutive_failures in [3, 5]`: `next_refresh_at = now() + 14d` (cooldown).
  - `consecutive_failures >= 6`: set `dormant = true`.

A pure-queue run does *not* reset `consecutive_failures`, and a successful apply resets both. Admin manual "Refresh now" clears `dormant`. The two counters are independent because the failure modes are unrelated: one is "we can't get data," the other is "data is consistently below our quality bar."

### Game version tagging

The new snapshot's `game_version` is set to the latest `game_versions` row where `released_at <= now()`. If multiple, pick the one with the most recent `released_at`. This matches what the evaluator considers "current" today. Adapters don't try to detect game version from the page (too noisy).

### Manual "Refresh now"

Per-row button in the admin table that calls `POST /api/admin/tier-lists/refresh/[sourceId]`. The route:
1. Re-uses the same per-source logic as the cron iterator.
2. Bypasses the `next_refresh_at` and `dormant` checks (admin override).
3. Returns the same per-source result payload.

This is also how the admin recovers from dormant: hit Refresh Now once, and on success the source un-dormants and goes back into the weekly rotation.

## Data flow

Successful weekly refresh of mobalytics:

1. Cron fires at 04:00. Endpoint loads sources due today; mobalytics is one of them (last refreshed 7 days ago).
2. Endpoint fetches `https://mobalytics.gg/slay-the-spire-2/tier-lists/cards` with the bot UA. Cloudflare returns 200 + the SSR'd HTML.
3. `mobalyticsAdapter.parse(html, url)` returns 5 `ScrapedSection`s (one per character).
4. For each section, the scrape route's matching logic runs (using `detectedCharacter` as the dHash candidate filter).
5. Quality gate: all 5 sections match ≥97% of cards, no warnings, entry counts within ±3% of prior, all 5 characters present. Pass.
6. Confirm path runs in `{ sections: [5 sections] }` mode: deactivates the 5 prior active rows, inserts 5 new active rows. The shared `runSourceRefresh` call from cron passes `deferMvRefresh: true`, so the MV is *not* refreshed yet.
7. `tier_list_refresh_logs` row written: `{ status: 'applied', sections_attempted: 5, sections_applied: 5, sections_queued: 0 }`.
8. `tier_list_sources` row updated: both failure counters reset to 0, `last_refresh_succeeded_at = now()`, `next_refresh_at = now() + 7d`.
9. After the cron loop finishes all due sources, `runCronCycle` calls the MV-refresh RPC once. Subsequent evaluator requests see the new data.

Degraded refresh (site restructure):

1. Same cron, same source.
2. Adapter returns 5 sections, but the Defect section's match rate is 62% (a new card-rendering pattern broke the image-URL regex).
3. Per-section gate: 4 pass, Defect fails on `match_rate`.
4. Source-level coverage check passes (all 5 prior characters are present in this run).
5. Confirm path applies the 4 passing sections (deactivating their priors). The Defect section gets inserted as `is_active = false, review_status = 'pending'` with the gate failure reasons — the partial unique index allows it to coexist with the still-active prior Defect row on the same `(source_id, game_version, published_at, character)` tuple.
6. Audit log: `{ status: 'partial', sections_applied: 4, sections_queued: 1 }`. Both counters reset because at least one section auto-applied.
7. Admin sees a "Needs review" row in the admin table for the Defect draft, with the failure reasons inline.

Hard fetch failure:

1. Cron fires. Mobalytics now returns 403 (Cloudflare started enforcing).
2. `fetchSourceHtml` returns `{ ok: false, reason: 'http_403' }`.
3. Audit log: `{ status: 'failed', error: 'http_403' }`.
4. `consecutive_failures = 1, next_refresh_at = now() + 1d, last_failure_reason = 'http_403'`.
5. Next 5 days repeat. On day 4 (`consecutive_failures = 3`), the source's `next_refresh_at` jumps to +14d cooldown.
6. Admin can hit "Refresh now" any time — and would also see the source flagged in the admin UI with the recent failure history.

## Schema

Single migration adds the columns + audit table + replaces the `tier_lists_unique` constraint. Default values keep all existing rows opt-out.

```sql
-- tier_list_sources
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

-- tier_lists: review_status + replace uniqueness with a partial index
ALTER TABLE tier_lists
  ADD COLUMN review_status text NOT NULL DEFAULT 'none'
    CHECK (review_status IN ('none', 'pending')),
  ADD COLUMN gate_failure_reasons jsonb;

-- The existing `tier_lists_unique` constraint (migration 022, line 40) covers
-- (source_id, game_version, published_at, character). With pending drafts now
-- coexisting with their active counterparts on the same key, that constraint
-- must scope to non-pending rows or auto-refresh inserts will collide.
ALTER TABLE tier_lists DROP CONSTRAINT tier_lists_unique;
CREATE UNIQUE INDEX tier_lists_unique_non_pending
  ON tier_lists (source_id, game_version, published_at, character)
  WHERE review_status = 'none';

CREATE INDEX tier_lists_pending_review_idx
  ON tier_lists (review_status)
  WHERE review_status = 'pending';

-- audit log
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
  rejected_snapshot jsonb  -- populated when a pending row is rejected; see Routes section
);

CREATE INDEX tier_list_refresh_logs_source_started_idx
  ON tier_list_refresh_logs (source_id, started_at DESC);

-- Singleton row used as a concurrency claim by the cron endpoint.
CREATE TABLE tier_list_refresh_runs (
  id text PRIMARY KEY,
  claimed_at timestamptz,
  claimed_by text
);
INSERT INTO tier_list_refresh_runs (id) VALUES ('singleton');

-- When an admin flips auto_refresh_enabled false→true the source must be
-- immediately due, or it'll never be picked up (NULL next_refresh_at fails
-- the `<= now()` check). Enforce via a row-level trigger so both PATCH and
-- direct DB edits get the behavior.
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
```

RLS policies on the new table: admin-only writes via the service client, admin-only reads. No public access. Existing `tier_lists` and `tier_list_sources` policies cover the new columns automatically.

## Admin UI changes

[apps/web/src/app/admin/tier-lists/page.tsx](apps/web/src/app/admin/tier-lists/page.tsx) gets four additions, all narrowly scoped:

1. **"Recent refresh activity" panel** at the top of the page (always visible, not behind a modal). Shows the last ~10 audit-log rows across all sources with: source name, status badge (applied/partial/queued/failed), trigger, started_at, and a short reason if non-success. Clicking a row opens that source's full history modal. This is the default-visible observability surface — anyone glancing at the admin UI sees "did refresh fire today, did it work" without drilling in.
2. **"Needs review" section** below the activity panel. Renders pending-review rows grouped by source. Each row shows the source name, character, captured-at time, and the gate failure reasons as a bulleted list. Two buttons: Accept (calls `POST /api/admin/tier-lists/accept-pending/[id]`) and Reject (calls `DELETE /api/admin/tier-lists/[id]`).
3. **Edit modal** gains an "Auto-refresh" toggle (writes `auto_refresh_enabled` via the existing PATCH route) and shows: dormant status, last attempted, last succeeded, both failure counters, last failure reason. A "Refresh now" button at the bottom of the modal.
4. **Source row** gains a small badge showing auto-refresh state: ✓ green if enabled and not dormant, dot grey if disabled, ! red if dormant. Sortable column too.

No new pages. All changes flow through the existing admin-table architecture.

## Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/cron/refresh-tier-lists` | GET | Cron entry point (`Authorization: Bearer ${CRON_SECRET}`) |
| `/api/admin/tier-lists/refresh/[sourceId]` | POST | Manual "Refresh now" for one source |
| `/api/admin/tier-lists/accept-pending/[id]` | POST | Promote a `review_status = 'pending'` row to active |
| `/api/admin/tier-lists/[id]` | DELETE | Reject a pending row. Before deleting, write a `tier_list_refresh_logs` row with `rejected_snapshot` populated from the pending row's `entries` summary, `gate_failure_reasons`, and `entry_count` so post-mortems on "why did we lose this draft" remain debuggable. |
| `/api/admin/tier-lists/refresh-logs` | GET | Recent activity feed for the top-of-page panel (last ~10 across all sources, optional `?sourceId=` filter) |
| `/api/admin/tier-lists/refresh-logs/[sourceId]` | GET | Full history for one source (admin-modal "History" tab) |

The PATCH route gains the `auto_refresh_enabled` field. The DB trigger from the Schema section handles the false→true transition; the PATCH route doesn't need special-case logic for `next_refresh_at`.

## Shared helper

The per-source refresh logic gets factored into one function used by both cron and manual triggers:

```ts
// packages/shared/tier-refresh/run-source-refresh.ts
export async function runSourceRefresh(
  supabase: SupabaseClient<Database>,
  source: TierListSourceRow,
  options: { trigger: "cron" | "manual"; deferMvRefresh: boolean },
): Promise<RefreshResult> {
  // 1. fetchSourceHtml
  // 2. resolveAdapter + parse
  // 3. per-section matching (reuses logic from scrape route)
  // 4. quality gate
  // 5. apply / queue / fail (writes snapshot rows, updates source row, audit log)
  // 6. if !deferMvRefresh, call refresh_community_tier_consensus RPC
}
```

Both endpoints become thin wrappers around this:
- **Cron** passes `deferMvRefresh: true` and calls the MV refresh RPC once at the end of `runCronCycle` after all sources finished (avoiding the per-source lock-storm flagged in review).
- **Manual "Refresh now"** passes `deferMvRefresh: false` so the admin sees the result reflected immediately.

The matching logic currently inlined in the scrape route should be lifted into a shared helper too (`packages/shared/tier-sources/match-cards.ts`) so the cron isn't reimplementing dHash + filename + alt-text matching.

## Error handling

Per-attempt failures:

| Failure | Logged status | Counter increment | Next refresh |
|---------|---------------|-------------------|--------------|
| Network timeout / DNS / unknown error | `failed` | yes | +1d |
| HTTP 4xx / 5xx | `failed` (reason `http_<code>`) | yes | +1d |
| HTML too large or empty | `failed` (`html_invalid`) | yes | +1d |
| Adapter throws | `failed` (`adapter_error`, stack in error_detail) | yes | +1d |
| Adapter returns 0 sections | `no_data` | yes | +1d |
| Some sections applied, some queued | `partial` | no (resets `consecutive_queue_only`) | +7d |
| All sections queued, none applied | `queued` | no (increments `consecutive_queue_only`) | +7d; dormant at 3 |
| All sections applied cleanly | `applied` | no (resets `consecutive_queue_only`) | +7d |
| MV refresh fails after the cron loop | per-source statuses unchanged | no | +7d; warning surfaced in cron summary response |

DB write of audit log uses a separate transaction from the snapshot inserts, so an audit-log write failure can't roll back an applied refresh.

Time-budget exhaustion mid-loop: cron stops, returns its summary, remaining sources keep their old `next_refresh_at` and naturally roll to tomorrow. No special state to track.

## Testing

**Unit tests**
- `runSourceRefresh` covers each branch above with a stubbed `fetch` and a stubbed Supabase client.
- Quality gate has its own unit tests for each check at boundary values (94/95% match rate; 9.9/10.1% entry-count delta; missing-character coverage).
- Backoff math: failure-count transitions and `next_refresh_at` deltas.

**Integration tests** (real Supabase test schema)
- Successful refresh: source row updated, snapshots inserted, MV refreshed, log row present.
- Partial refresh: mix of applied and pending rows.
- Dormancy after 6 failures.
- Acceptance flow: pending row promoted, prior active deactivated.

**Manual smoke test** before flipping the cron on in prod:
- Enable `auto_refresh_enabled` on the mobalytics source only.
- Hit `/api/admin/tier-lists/refresh/[sourceId]` manually.
- Verify the result, the log row, the source row state, and the MV.

## Rollout

1. Land the prerequisite spec (manual refresh + multi-section + 4-week staleness). The `supportsAutoRefresh: boolean` adapter field is added in that PR with every existing adapter set to `false` — the auto-refresh PR then just flips mobalytics to `true`. Bundling the contract change with the rest of the adapter refactor keeps the auto-refresh PR focused on the cron + gate + queue logic.
2. Ship migration + cron endpoint + shared helper. Cron registered but no sources have `auto_refresh_enabled = true` yet — cron iterates, finds nothing, returns `{ sourcesAttempted: 0 }`.
3. Ship admin UI changes.
4. Manually enable auto-refresh on the mobalytics source. Verify a full cycle by manual trigger.
5. Let weekly cadence take over.
6. Add other adapters' `supportsAutoRefresh = true` as we validate their fetch+parse path.

## Open questions / known risks

- **Cloudflare 403 on mobalytics.** We don't know until we try. If consistent, the source falls into the failure path and we either (a) defer auto-refresh for that source, (b) add a scraping-API adapter, or (c) ship a manually-curated workflow that pings the admin to paste HTML. The system degrades gracefully into option (c) without code changes — the dormancy flag + admin UI surfacing makes the failure obvious.
- **Game version misclassification at a major patch boundary.** If a major balance patch lands between two refresh runs, the snapshot might still carry the old game version. The existing `versionMeta.is_major_balance_patch` staleness path handles this on read — but it does mean the first auto-refresh after a major patch will get tagged with the new game version, which is correct behavior.
- **No Sentry / structured error capture in this codebase yet.** v1 leans on `console.error` + Vercel cron logs + the in-UI activity panel. If we add Sentry later, the `runSourceRefresh` and `runCronCycle` boundaries are the obvious places to wire `Sentry.captureException` with the source_id + status as tags.
