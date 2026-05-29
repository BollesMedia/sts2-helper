# Tier List Refresh + 4-Week Staleness — Design

## Problem

Two changes to community tier list ingestion:

1. **Updating uploaded tier lists.** Today an admin can upload (vision LLM or HTML scrape) and edit metadata (author, trust weight, scale, etc.) via the `/admin/tier-lists` page, but cannot easily produce a *new snapshot* from the same source when the underlying author publishes a refresh. The current workflow is "fill the wizard from scratch and rely on the unique constraint to deactivate the prior list" — fine when it works, but lossy on source metadata (URL, author, scale config) and easy to fat-finger.
2. **Staleness threshold.** `getCommunityTierSignals` currently treats lists as fresh for 180 days, aging until 365, then drops them. The game patches faster than that; we want fresh < 4 weeks, aging 4–12 weeks, excluded > 12 weeks.

Both are limited improvements on existing infrastructure — no schema changes, no new auth, no new product surface.

## Goals / non-goals

**In scope**
- "Refresh" action on each row in the admin tier-list table that re-runs ingestion against the same source with metadata pre-filled and locked.
- Mobalytics adapter learns to split a single page into per-character sections, so refreshing produces N snapshots in one pass.
- Confirm endpoint accepts multi-section payloads.
- Staleness thresholds drop to 28 / 84 days; existing tests update.
- Admin table shows a staleness chip (fresh / aging / excluded) per row.

**Out of scope**
- Server-side URL fetching (Cloudflare / JS-rendered pages make this brittle; admin still pastes HTML).
- Background cron that auto-refreshes stale sources.
- Schema-level staleness columns. Staleness stays computed on read.
- Per-entry edits ("fix this single card's tier"). That remains a re-ingest in v1.
- Changing what staleness *does* downstream. `aging` continues to feed the LLM with a warning; `excluded` continues to drop from the signal. Only the time buckets shift.

## Architecture

### Refresh flow

Adds one entry point and reuses everything else:

```
Admin table row "Refresh" button
        │
        ▼
Wizard, pre-filled + locked (source_id, source_url, author, scale_type, scale_config, trust_weight)
        │
        ├─ Image source ──► <existing extract route> ──► preview ──► confirm
        └─ URL  source ──► paste HTML ──► <existing scrape route> ──► preview ──► confirm
                                                                              │
                                                                              ▼
                                                          confirm deactivates prior active list(s) for (source_id, game_version, character) and inserts new snapshot(s)
```

The wizard state already carries source metadata through to confirm. Refresh just opens it with that state pre-populated from an existing row and a "locked" flag on the source fields so the admin doesn't accidentally edit author / trust weight from this entry point (those have their own Edit modal).

### Multi-character source splitting

Today: `mobalyticsAdapter.parse(html, url)` walks the DOM and emits one flat `ScrapedTierList`. For mobalytics's `/slay-the-spire-2/tier-lists/cards` page that contains all 5 characters, this currently produces a single mashed list.

Change: adapters return a result whose `sections` field is always an array (most adapters keep returning length 1; mobalytics returns one entry per detected character).

```ts
// packages/shared/tier-sources/types.ts
export interface ScrapedSection {
  detectedCharacter: string | null;  // "ironclad" | "silent" | "regent" | "necrobinder" | "defect" | null
  scaleType: ScaleType;
  scaleConfig?: { map: Record<string, number> };
  cards: ScrapedCard[];
  warnings: string[];
}

export interface TierListSourceAdapter {
  readonly id: string;
  readonly label: string;
  canHandle(url: string): boolean;
  parse(html: string, url: string): {
    adapterId: string;
    sections: ScrapedSection[];
    warnings: string[];  // adapter-level warnings (vs section-level)
  };
}
```

Mobalytics implementation: find every `<h2>` whose trimmed text matches `/^(Ironclad|Silent|Regent|Necrobinder|Defect)\s+Tier\s*List$/i`, ascend to the nearest `<section>` ancestor, and run the existing tier-label-and-image walk inside that subtree. Each `<h2>` produces one `ScrapedSection` with `detectedCharacter` set from the matched name (lowercased).

If a page has zero matching h2s (e.g. an admin pastes a single character section directly), fall back to the existing whole-DOM walk and emit one section with `detectedCharacter: null`. Backwards-compatible with the current "paste just one section" workflow.

Other adapters (tiermaker, sts2companion, nat1gaming, slaythetierlist) trivially wrap their existing output as a 1-section array. No behavior change.

### Scrape + confirm endpoint updates

`POST /api/admin/tier-lists/scrape`:
- Returns `{ sections: PreviewSection[], warnings }` instead of `{ cards, ... }`. Each `PreviewSection` carries the existing `matchedCards` / `unmatchedCards` shape plus `detectedCharacter`.
- The `character` query param keeps working: when provided, used as a hint to filter the candidate-card set in dHash matching (same as today). When the adapter returns multiple sections, each section's matching uses *its own* `detectedCharacter` instead of the request param.

`POST /api/admin/tier-lists/confirm`:
- Accepts `{ sections: ConfirmSection[] }`. Each `ConfirmSection` has the snapshot-level fields (`character`, `game_version`, `published_at`, `entries[]`) plus the shared source fields (`source_id` or full source payload on first ingest).
- Iterates: for each section, deactivate prior active rows matching `(source_id, game_version, character)`, upsert a new `tier_lists` row, insert entries. All in one Supabase transaction (or sequential with rollback if Supabase RPC limits force it).
- Backwards-compatible: single-section payload (existing UI not yet updated) still works — wrapped server-side as `sections: [{...}]`.

### Admin UI changes

**Refresh button** in `apps/web/src/app/admin/tier-lists/page.tsx`:
- Lives next to the existing "Edit" button on each row.
- Clicking it sets the wizard to `mode: 'refresh'` with `sourceContext = { sourceId, sourceUrl, sourceType, author, scaleType, scaleConfig, trustWeight, character, gameVersion }`.
- The wizard renders the source fields read-only (badge style, not inputs) and skips straight to the upload/paste step.

**Preview supports multi-section** (only relevant for adapters that emit >1):
- A tab bar above the cards-by-tier preview, one tab per detected character.
- Per-tab checkbox in the confirm panel ("Replace existing Ironclad list" / "Replace existing Silent list" / etc.) defaulted to checked. Unchecking skips that section on confirm.
- If only 1 section, no tabs (same as today).

**Staleness chip** on each row:
- Computed client-side from `published_at` + the same 28/84 thresholds (matches what the evaluator does on read).
- Sorted with excluded → aging → fresh by default so the admin sees what needs refreshing first.
- Pure display; doesn't gate anything.

### Staleness constants

In `packages/shared/evaluation/community-tier.ts`:
```ts
const AGING_DAYS = 28;  // was 180
const STALE_DAYS = 84;  // was 365
```

`classifyByTime` and `classifyByVersion` retain their structure. The "excluded after major balance patch" rule via `versionMeta.is_major_balance_patch` stays as-is — that's an orthogonal staleness signal.

`community-tier.test.ts` and any fixtures asserting specific day counts (e.g. `181 days → 'aging'`) update to the new boundaries.

## Data flow

Refresh of a Mobalytics multi-character page, end to end:

1. Admin clicks Refresh on the Ironclad-Mobalytics row.
2. Wizard opens with `source_id` and metadata locked; URL is pre-filled.
3. Admin pastes the page HTML.
4. Scrape route resolves the mobalytics adapter, which now returns 5 `ScrapedSection`s — one per character.
5. Preview renders a 5-tab UI. The admin sees that Defect's list has 2 unmatched cards and uses the existing manual-match dropdowns to fix them. They uncheck Regent because they don't want to replace that one yet.
6. Confirm sends `{ sections: [ironclad, silent, necrobinder, defect] }`.
7. Server deactivates each character's existing active row (for that source_id + game_version) and inserts the new snapshots.
8. Materialized view `community_tier_consensus` refresh fires, evaluator sees the new data on next request.

## Error handling

- **Adapter returns 0 sections:** scrape route surfaces "No tier list data found" with adapter-level warnings, same as today's "0 cards" path.
- **One section has 0 matched cards:** that section's confirm button disables, others proceed. Matches existing one-list behavior.
- **Confirm partial failure (section 3 of 5 errors on insert):** transaction rolls back; UI surfaces which section failed. Admin retries the remaining sections by unchecking the succeeded ones.
- **MV refresh fails after successful insert:** same as today — log + warning in response, data is still correct.

## Testing

**Adapter unit tests** (`mobalytics.test.ts`):
- New fixture: `mobalytics-all-characters.html` from the page source the user provided. Asserts 5 sections, each with the right `detectedCharacter` and a plausible card count.
- Existing single-section fixtures: assert the new shape returns `sections: [single]` with `detectedCharacter: null`.

**Scrape route integration test:**
- Multi-section response shape verified.
- Existing single-section behavior unchanged.

**Confirm route integration test:**
- Multi-section payload inserts N rows and deactivates N prior rows.
- Single-section payload still works via the wrapped fallback.

**Staleness tests** (`community-tier.test.ts`):
- Update existing assertions to 28/84 boundaries.
- Add boundary cases at 27, 28, 83, 84 days.

**Admin UI:**
- Component test: Refresh button opens wizard with locked fields.
- Component test: Preview renders tabs when given 2+ sections, no tabs for 1.
- Existing tests for Edit modal continue to pass (Edit is unchanged).

## Migration

None. Pure code changes:
- `AGING_DAYS` / `STALE_DAYS` constants — instant on deploy.
- Adapter contract — all adapters updated in the same PR; no DB or API consumers outside this codebase.
- Confirm route accepts both old single-list and new `sections` payloads during the transition (admin UI may ship slightly behind).

## Open questions

None blocking. Ship this as a single PR; the refresh + multi-section + staleness changes are tightly related and easier to review together than split.
