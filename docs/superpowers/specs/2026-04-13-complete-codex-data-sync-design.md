# Complete Spire Codex Data Sync

**Date:** 2026-04-13
**Status:** Approved
**Motivation:** The STS2 Helper currently syncs 5 of 14 Spire Codex API endpoints. Missing data (events, enchantments, powers, encounters, characters, orbs, afflictions) limits evaluation quality — most critically, the lack of event data means ancient evaluations have no structured reference for what options do, causing Haiku to hallucinate reasoning (e.g., "Gold worthless post-Act3" at Act 1 Floor 1). This spec brings the data foundation to parity with what Spire Codex offers.

## Current State

### Syncing (5 endpoints)

| Endpoint | Supabase Table | Records |
|---|---|---|
| `/api/cards` | `cards` | ~576 |
| `/api/relics` | `relics` | ~288 |
| `/api/potions` | `potions` | ~63 |
| `/api/monsters` | `monsters` | ~116 |
| `/api/keywords` | `keywords` | ~97 |

### Not Syncing (6 evaluation-relevant endpoints)

| Endpoint | Records | Impact |
|---|---|---|
| `/api/events` | ~66 | Ancient relic pools, shrine event options — direct fix for ancient eval quality |
| `/api/enchantments` | ~22 | Currently hardcoded in `enchantment-lookup.ts`, goes stale on game updates |
| `/api/powers` | ~257 | Buff/debuff definitions — helps Haiku understand game mechanics |
| `/api/encounters` | ~87 | Combat encounters by act — useful for map pathing evaluations |
| `/api/orbs` | ~5 | Defect-specific orb types |
| `/api/afflictions` | ~6 | Card constraint types (Bound, Galvanized, etc.) |

### Existing but unpopulated

| Table | Status |
|---|---|
| `characters` | Schema exists in `001_initial_schema.sql` but `sync-codex.ts` never populates it. Missing columns vs API: `description`, `orb_slots`, `unlocks_after`, `gender`, `color`, `image_url`. |

### Not relevant for evaluations

| Endpoint | Reason |
|---|---|
| `/api/achievements` | Meta/collection tracking, no eval impact |
| `/api/stats` | Entity counts, no eval impact |

## API Reference

- **Base URL:** `https://spire-codex.com/api`
- **Beta URL:** `https://beta.spire-codex.com/api` (unreleased Steam beta content)
- **Auth:** None (public API)
- **Rate limit:** 60 req/min
- **Localization:** `?lang=[code]` query param (eng default)
- **Docs:** https://spire-codex.com/developers

## Design

### Approach

Extend the existing sync script (`apps/web/src/game-data/sync-codex.ts`) — add 7 new sync functions following the same `fetchCodex<T>()` -> map -> upsert pattern with 1200ms rate-limit delays between each. One new Supabase migration creates 6 new tables and adds missing columns to `characters`.

### New Tables

#### `events`

The most complex table. Ancient events use `relics` (text array of relic IDs from their option pool) and `dialogue` (character-keyed NPC lines). Shrine events use `options` (initial choices) and `pages` (branching multi-step outcomes). JSONB for all nested/variable structures.

```sql
create table events (
  id text primary key,
  name text not null,
  type text not null,              -- 'Event', 'Ancient', 'Shared'
  act text,                         -- e.g. 'Act 1 - Overgrowth', null for shared
  description text,
  preconditions jsonb,              -- nullable, filter conditions
  options jsonb,                    -- [{id, title, description}] for shrine events
  pages jsonb,                      -- [{id, description, options[]}] branching outcomes
  epithet text,                     -- Ancient-only (e.g. "Mother of Resurrection")
  dialogue jsonb,                   -- Ancient-only, character-keyed dialogue trees
  image_url text,
  relics text[],                    -- Ancient-only, relic ID pool for options
  game_version text references game_versions(version),
  updated_at timestamptz default now()
);
```

#### `enchantments`

Replaces the hardcoded `ENCHANTMENTS` map in `apps/desktop/src/lib/enchantment-lookup.ts`.

```sql
create table enchantments (
  id text primary key,
  name text not null,
  description text not null,
  description_raw text,
  extra_card_text text,
  card_type text,                   -- e.g. 'Attack', null if any
  applicable_to text,               -- e.g. 'Defend cards', null if any
  is_stackable boolean not null default false,
  image_url text,
  game_version text references game_versions(version),
  updated_at timestamptz default now()
);
```

#### `powers`

Buff/debuff/status effect definitions. 257 records.

```sql
create table powers (
  id text primary key,
  name text not null,
  description text not null,
  description_raw text,
  type text not null,               -- 'Buff' or 'Debuff'
  stack_type text,                  -- 'Counter', 'Single', 'None'
  allow_negative boolean,
  image_url text,
  game_version text references game_versions(version),
  updated_at timestamptz default now()
);
```

#### `encounters`

Combat encounters by act and room type. 87 records.

```sql
create table encounters (
  id text primary key,
  name text not null,
  room_type text not null,          -- 'Monster', 'Elite', 'Boss'
  is_weak boolean not null default false,
  act text,
  tags text[],
  monsters jsonb,                   -- [{id, name}]
  loss_text text,
  game_version text references game_versions(version),
  updated_at timestamptz default now()
);
```

#### `orbs`

Defect-specific orb types. 5 records.

```sql
create table orbs (
  id text primary key,
  name text not null,
  description text not null,
  description_raw text,
  image_url text,
  game_version text references game_versions(version),
  updated_at timestamptz default now()
);
```

#### `afflictions`

Card constraint types (Bound, Galvanized, etc.). 6 records.

```sql
create table afflictions (
  id text primary key,
  name text not null,
  description text not null,
  extra_card_text text,
  is_stackable boolean not null default false,
  game_version text references game_versions(version),
  updated_at timestamptz default now()
);
```

### Characters Table Migration

Add columns the API provides that the existing table lacks:

```sql
alter table characters
  add column if not exists description text,
  add column if not exists orb_slots int,
  add column if not exists unlocks_after text,
  add column if not exists gender text,
  add column if not exists color text,
  add column if not exists image_url text;
```

### Sync Script Changes

**File:** `apps/web/src/game-data/sync-codex.ts`

Add TypeScript interfaces for each new Codex response type following the existing pattern (`CodexCard`, `CodexRelic`, etc.):

- `CodexEvent` — `{id, name, type, act, description, preconditions, options, pages, epithet, dialogue, image_url, relics}`
- `CodexEnchantment` — `{id, name, description, description_raw, extra_card_text, card_type, applicable_to, is_stackable, image_url}`
- `CodexPower` — `{id, name, description, description_raw, type, stack_type, allow_negative, image_url}`
- `CodexEncounter` — `{id, name, room_type, is_weak, act, tags, monsters, loss_text}`
- `CodexOrb` — `{id, name, description, description_raw, image_url}`
- `CodexAffliction` — `{id, name, description, extra_card_text, is_stackable}`
- `CodexCharacter` — `{id, name, description, starting_hp, starting_gold, max_energy, orb_slots, starting_deck, starting_relics, unlocks_after, gender, color, image_url}`

Add 7 sync functions, each following the pattern:
1. Fetch from Codex API
2. Map to insert type (handling nullable fields)
3. Upsert into Supabase

Update `main()` to call all sync functions with 1200ms delays between each. Total API calls goes from 5 to 12, well within the 60 req/min rate limit.

### Shared Types

**File:** `packages/shared/supabase/helpers.ts`

Add insert types for new tables: `EventInsert`, `EnchantmentInsert`, `PowerInsert`, `EncounterInsert`, `OrbInsert`, `AfflictionInsert`. Update `CharacterInsert` to include new columns.

### RLS Policies

All new tables need public read access (same as existing reference tables). No write access from client — only service role via sync script.

```sql
alter table <table> enable row level security;
create policy "Public read" on <table> for select using (true);
```

## Out of Scope

These are follow-up work enabled by this foundation:

- **Replace `enchantment-lookup.ts`** with DB-backed lookup — the hardcoded file still works, it just goes stale between syncs
- **Ancient-specific eval addendum** — use events + relics tables to provide structured option guidance to Haiku
- **Prompt builder improvements** — remove gold language from base prompt, add act-aware ancient guidance
- **Encounter-aware map pathing** — use encounters table to inform "what elites can I face in this act?"
- **Power definitions in eval context** — include buff/debuff definitions so Haiku doesn't guess what Vulnerable does
- **Regenerate `database.types.ts`** from Supabase — or manually add types; depends on whether the project uses `supabase gen types`

## File Changes Summary

| File | Change |
|---|---|
| `supabase/migrations/0XX_complete_codex_sync.sql` | New migration: 6 tables + character columns + RLS |
| `apps/web/src/game-data/sync-codex.ts` | 7 new sync functions + interfaces + main() wiring |
| `packages/shared/supabase/helpers.ts` | 6 new insert types + CharacterInsert update |
