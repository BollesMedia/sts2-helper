# Complete Spire Codex Data Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync all evaluation-relevant data from the Spire Codex API into Supabase — events, enchantments, powers, encounters, orbs, afflictions, and characters — so the app has a complete game data foundation.

**Architecture:** One new Supabase migration creates 6 tables + extends `characters`. The existing `sync-codex.ts` script gains 7 new sync functions following the established `fetchCodex<T>()` → map → upsert pattern. Types are added manually to `database.types.ts` and exported from `helpers.ts`.

**Tech Stack:** Supabase (Postgres), TypeScript, `@supabase/supabase-js`

**Spec:** `docs/superpowers/specs/2026-04-13-complete-codex-data-sync-design.md`

---

### Task 1: Supabase Migration — New Tables + Character Columns

**Files:**
- Create: `supabase/migrations/021_complete_codex_sync.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- ============================================
-- Complete Spire Codex data sync
-- Adds: events, enchantments, powers, encounters, orbs, afflictions
-- Extends: characters with additional API fields
-- ============================================

-- Events (shrine events + Ancient encounters)
create table events (
  id text primary key,
  name text not null,
  type text not null,
  act text,
  description text,
  preconditions jsonb,
  options jsonb,
  pages jsonb,
  epithet text,
  dialogue jsonb,
  image_url text,
  relics text[],
  game_version text references game_versions(version),
  updated_at timestamptz default now()
);

-- Enchantments (card modifiers)
create table enchantments (
  id text primary key,
  name text not null,
  description text not null,
  description_raw text,
  extra_card_text text,
  card_type text,
  applicable_to text,
  is_stackable boolean not null default false,
  image_url text,
  game_version text references game_versions(version),
  updated_at timestamptz default now()
);

-- Powers (buffs, debuffs, status effects)
create table powers (
  id text primary key,
  name text not null,
  description text not null,
  description_raw text,
  type text not null,
  stack_type text,
  allow_negative boolean,
  image_url text,
  game_version text references game_versions(version),
  updated_at timestamptz default now()
);

-- Encounters (combat encounters by act/room type)
create table encounters (
  id text primary key,
  name text not null,
  room_type text not null,
  is_weak boolean not null default false,
  act text,
  tags text[],
  monsters jsonb,
  loss_text text,
  game_version text references game_versions(version),
  updated_at timestamptz default now()
);

-- Orbs (Defect-specific orb types)
create table orbs (
  id text primary key,
  name text not null,
  description text not null,
  description_raw text,
  image_url text,
  game_version text references game_versions(version),
  updated_at timestamptz default now()
);

-- Afflictions (card constraints: Bound, Galvanized, etc.)
create table afflictions (
  id text primary key,
  name text not null,
  description text not null,
  extra_card_text text,
  is_stackable boolean not null default false,
  game_version text references game_versions(version),
  updated_at timestamptz default now()
);

-- Extend characters with additional API fields
alter table characters
  add column if not exists description text,
  add column if not exists orb_slots int,
  add column if not exists unlocks_after text,
  add column if not exists gender text,
  add column if not exists color text,
  add column if not exists image_url text;

-- ============================================
-- RLS policies (public read, same as existing tables)
-- ============================================

alter table events enable row level security;
create policy "Public read" on events for select using (true);

alter table enchantments enable row level security;
create policy "Public read" on enchantments for select using (true);

alter table powers enable row level security;
create policy "Public read" on powers for select using (true);

alter table encounters enable row level security;
create policy "Public read" on encounters for select using (true);

alter table orbs enable row level security;
create policy "Public read" on orbs for select using (true);

alter table afflictions enable row level security;
create policy "Public read" on afflictions for select using (true);
```

- [ ] **Step 2: Apply the migration**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && npx supabase db push`
Expected: Migration applies successfully, 6 new tables created, characters table altered.

If using remote Supabase (no local instance), apply via Supabase dashboard SQL editor or `supabase db push --linked`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/021_complete_codex_sync.sql
git commit -m "feat: add migration for events, enchantments, powers, encounters, orbs, afflictions tables"
```

---

### Task 2: Update TypeScript Types — database.types.ts

**Files:**
- Modify: `packages/shared/types/database.types.ts`

The project uses generated Supabase types. After applying the migration, regenerate or manually add types for the 6 new tables and the extended characters columns.

- [ ] **Step 1: Regenerate types from Supabase**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && npx supabase gen types typescript --linked > packages/shared/types/database.types.ts`

If `supabase gen types` is not configured for this project, manually add the table types. The manual additions go inside `public > Tables` in `database.types.ts`:

```typescript
      events: {
        Row: {
          id: string
          name: string
          type: string
          act: string | null
          description: string | null
          preconditions: Json | null
          options: Json | null
          pages: Json | null
          epithet: string | null
          dialogue: Json | null
          image_url: string | null
          relics: string[] | null
          game_version: string | null
          updated_at: string | null
        }
        Insert: {
          id: string
          name: string
          type: string
          act?: string | null
          description?: string | null
          preconditions?: Json | null
          options?: Json | null
          pages?: Json | null
          epithet?: string | null
          dialogue?: Json | null
          image_url?: string | null
          relics?: string[] | null
          game_version?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          type?: string
          act?: string | null
          description?: string | null
          preconditions?: Json | null
          options?: Json | null
          pages?: Json | null
          epithet?: string | null
          dialogue?: Json | null
          image_url?: string | null
          relics?: string[] | null
          game_version?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_game_version_fkey"
            columns: ["game_version"]
            isOneToOne: false
            referencedRelation: "game_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      enchantments: {
        Row: {
          id: string
          name: string
          description: string
          description_raw: string | null
          extra_card_text: string | null
          card_type: string | null
          applicable_to: string | null
          is_stackable: boolean
          image_url: string | null
          game_version: string | null
          updated_at: string | null
        }
        Insert: {
          id: string
          name: string
          description: string
          description_raw?: string | null
          extra_card_text?: string | null
          card_type?: string | null
          applicable_to?: string | null
          is_stackable?: boolean
          image_url?: string | null
          game_version?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          description?: string
          description_raw?: string | null
          extra_card_text?: string | null
          card_type?: string | null
          applicable_to?: string | null
          is_stackable?: boolean
          image_url?: string | null
          game_version?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enchantments_game_version_fkey"
            columns: ["game_version"]
            isOneToOne: false
            referencedRelation: "game_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      powers: {
        Row: {
          id: string
          name: string
          description: string
          description_raw: string | null
          type: string
          stack_type: string | null
          allow_negative: boolean | null
          image_url: string | null
          game_version: string | null
          updated_at: string | null
        }
        Insert: {
          id: string
          name: string
          description: string
          description_raw?: string | null
          type: string
          stack_type?: string | null
          allow_negative?: boolean | null
          image_url?: string | null
          game_version?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          description?: string
          description_raw?: string | null
          type?: string
          stack_type?: string | null
          allow_negative?: boolean | null
          image_url?: string | null
          game_version?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "powers_game_version_fkey"
            columns: ["game_version"]
            isOneToOne: false
            referencedRelation: "game_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      encounters: {
        Row: {
          id: string
          name: string
          room_type: string
          is_weak: boolean
          act: string | null
          tags: string[] | null
          monsters: Json | null
          loss_text: string | null
          game_version: string | null
          updated_at: string | null
        }
        Insert: {
          id: string
          name: string
          room_type: string
          is_weak?: boolean
          act?: string | null
          tags?: string[] | null
          monsters?: Json | null
          loss_text?: string | null
          game_version?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          room_type?: string
          is_weak?: boolean
          act?: string | null
          tags?: string[] | null
          monsters?: Json | null
          loss_text?: string | null
          game_version?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "encounters_game_version_fkey"
            columns: ["game_version"]
            isOneToOne: false
            referencedRelation: "game_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      orbs: {
        Row: {
          id: string
          name: string
          description: string
          description_raw: string | null
          image_url: string | null
          game_version: string | null
          updated_at: string | null
        }
        Insert: {
          id: string
          name: string
          description: string
          description_raw?: string | null
          image_url?: string | null
          game_version?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          description?: string
          description_raw?: string | null
          image_url?: string | null
          game_version?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orbs_game_version_fkey"
            columns: ["game_version"]
            isOneToOne: false
            referencedRelation: "game_versions"
            referencedColumns: ["version"]
          },
        ]
      }
      afflictions: {
        Row: {
          id: string
          name: string
          description: string
          extra_card_text: string | null
          is_stackable: boolean
          game_version: string | null
          updated_at: string | null
        }
        Insert: {
          id: string
          name: string
          description: string
          extra_card_text?: string | null
          is_stackable?: boolean
          game_version?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          description?: string
          extra_card_text?: string | null
          is_stackable?: boolean
          game_version?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "afflictions_game_version_fkey"
            columns: ["game_version"]
            isOneToOne: false
            referencedRelation: "game_versions"
            referencedColumns: ["version"]
          },
        ]
      }
```

Also update the `characters` Row/Insert/Update types to include the new columns:

```typescript
      // Add these fields to the existing characters.Row:
          description: string | null
          orb_slots: number | null
          unlocks_after: string | null
          gender: string | null
          color: string | null
          image_url: string | null
      // Add as optional to characters.Insert and characters.Update:
          description?: string | null
          orb_slots?: number | null
          unlocks_after?: string | null
          gender?: string | null
          color?: string | null
          image_url?: string | null
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && npx tsc --noEmit -p packages/shared/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/types/database.types.ts
git commit -m "feat: add database types for events, enchantments, powers, encounters, orbs, afflictions"
```

---

### Task 3: Export New Types from helpers.ts

**Files:**
- Modify: `packages/shared/supabase/helpers.ts`

- [ ] **Step 1: Add Row and Insert type exports**

Add after the existing type exports:

```typescript
// Row types — new tables
export type Event = Database["public"]["Tables"]["events"]["Row"];
export type Enchantment = Database["public"]["Tables"]["enchantments"]["Row"];
export type Power = Database["public"]["Tables"]["powers"]["Row"];
export type Encounter = Database["public"]["Tables"]["encounters"]["Row"];
export type Orb = Database["public"]["Tables"]["orbs"]["Row"];
export type Affliction = Database["public"]["Tables"]["afflictions"]["Row"];

// Insert types — new tables
export type EventInsert = Database["public"]["Tables"]["events"]["Insert"];
export type EnchantmentInsert = Database["public"]["Tables"]["enchantments"]["Insert"];
export type PowerInsert = Database["public"]["Tables"]["powers"]["Insert"];
export type EncounterInsert = Database["public"]["Tables"]["encounters"]["Insert"];
export type OrbInsert = Database["public"]["Tables"]["orbs"]["Insert"];
export type AfflictionInsert = Database["public"]["Tables"]["afflictions"]["Insert"];
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && npx tsc --noEmit -p packages/shared/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/supabase/helpers.ts
git commit -m "feat: export Row and Insert types for new codex tables"
```

---

### Task 4: Add Sync Functions — Events, Enchantments, Powers

**Files:**
- Modify: `apps/web/src/game-data/sync-codex.ts`

- [ ] **Step 1: Add CodexEvent interface and syncEvents function**

Add after the existing `CodexKeyword` interface:

```typescript
interface CodexEvent {
  id: string;
  name: string;
  type: string;
  act: string | null;
  description: string | null;
  preconditions: unknown[] | null;
  options: { id: string; title: string; description: string }[] | null;
  pages: { id: string; description: string; options: { id: string; title: string; description: string }[] | null }[] | null;
  epithet: string | null;
  dialogue: Record<string, { order: string; speaker: string; text: string }[]> | null;
  image_url: string | null;
  relics: string[] | null;
}

interface CodexEnchantment {
  id: string;
  name: string;
  description: string;
  description_raw: string | null;
  extra_card_text: string | null;
  card_type: string | null;
  applicable_to: string | null;
  is_stackable: boolean;
  image_url: string | null;
}

interface CodexPower {
  id: string;
  name: string;
  description: string;
  description_raw: string | null;
  type: string;
  stack_type: string | null;
  allow_negative: boolean | null;
  image_url: string | null;
}
```

Add the sync functions after `syncKeywords`:

```typescript
async function syncEvents(version: string) {
  console.log("Syncing events...");
  const events = await fetchCodex<CodexEvent[]>("/events");

  const rows = events.map((e) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    act: e.act ?? null,
    description: e.description ?? null,
    preconditions: e.preconditions ? JSON.parse(JSON.stringify(e.preconditions)) : null,
    options: e.options ? JSON.parse(JSON.stringify(e.options)) : null,
    pages: e.pages ? JSON.parse(JSON.stringify(e.pages)) : null,
    epithet: e.epithet ?? null,
    dialogue: e.dialogue ? JSON.parse(JSON.stringify(e.dialogue)) : null,
    image_url: e.image_url ?? null,
    relics: e.relics ?? null,
    game_version: version,
  }));

  const { error } = await supabase.from("events").upsert(rows);
  if (error) throw error;
  console.log(`  ✓ ${rows.length} events synced`);
}

async function syncEnchantments(version: string) {
  console.log("Syncing enchantments...");
  const enchantments = await fetchCodex<CodexEnchantment[]>("/enchantments");

  const rows = enchantments.map((e) => ({
    id: e.id,
    name: e.name,
    description: e.description,
    description_raw: e.description_raw ?? null,
    extra_card_text: e.extra_card_text ?? null,
    card_type: e.card_type ?? null,
    applicable_to: e.applicable_to ?? null,
    is_stackable: e.is_stackable,
    image_url: e.image_url ?? null,
    game_version: version,
  }));

  const { error } = await supabase.from("enchantments").upsert(rows);
  if (error) throw error;
  console.log(`  ✓ ${rows.length} enchantments synced`);
}

async function syncPowers(version: string) {
  console.log("Syncing powers...");
  const powers = await fetchCodex<CodexPower[]>("/powers");

  const rows = powers.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    description_raw: p.description_raw ?? null,
    type: p.type,
    stack_type: p.stack_type ?? null,
    allow_negative: p.allow_negative ?? null,
    image_url: p.image_url ?? null,
    game_version: version,
  }));

  const { error } = await supabase.from("powers").upsert(rows);
  if (error) throw error;
  console.log(`  ✓ ${rows.length} powers synced`);
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/game-data/sync-codex.ts
git commit -m "feat: add sync functions for events, enchantments, powers"
```

---

### Task 5: Add Sync Functions — Encounters, Orbs, Afflictions, Characters

**Files:**
- Modify: `apps/web/src/game-data/sync-codex.ts`

- [ ] **Step 1: Add remaining interfaces**

Add after the `CodexPower` interface:

```typescript
interface CodexEncounter {
  id: string;
  name: string;
  room_type: string;
  is_weak: boolean;
  act: string | null;
  tags: string[] | null;
  monsters: { id: string; name: string }[] | null;
  loss_text: string | null;
}

interface CodexOrb {
  id: string;
  name: string;
  description: string;
  description_raw: string | null;
  image_url: string | null;
}

interface CodexAffliction {
  id: string;
  name: string;
  description: string;
  extra_card_text: string | null;
  is_stackable: boolean;
}

interface CodexCharacter {
  id: string;
  name: string;
  description: string | null;
  starting_hp: number;
  starting_gold: number;
  max_energy: number;
  orb_slots: number | null;
  starting_deck: string[];
  starting_relics: string[];
  unlocks_after: string | null;
  gender: string | null;
  color: string | null;
  image_url: string | null;
}
```

- [ ] **Step 2: Add sync functions**

Add after `syncPowers`:

```typescript
async function syncEncounters(version: string) {
  console.log("Syncing encounters...");
  const encounters = await fetchCodex<CodexEncounter[]>("/encounters");

  const rows = encounters.map((e) => ({
    id: e.id,
    name: e.name,
    room_type: e.room_type,
    is_weak: e.is_weak,
    act: e.act ?? null,
    tags: e.tags ?? null,
    monsters: e.monsters ? JSON.parse(JSON.stringify(e.monsters)) : null,
    loss_text: e.loss_text ?? null,
    game_version: version,
  }));

  const { error } = await supabase.from("encounters").upsert(rows);
  if (error) throw error;
  console.log(`  ✓ ${rows.length} encounters synced`);
}

async function syncOrbs(version: string) {
  console.log("Syncing orbs...");
  const orbs = await fetchCodex<CodexOrb[]>("/orbs");

  const rows = orbs.map((o) => ({
    id: o.id,
    name: o.name,
    description: o.description,
    description_raw: o.description_raw ?? null,
    image_url: o.image_url ?? null,
    game_version: version,
  }));

  const { error } = await supabase.from("orbs").upsert(rows);
  if (error) throw error;
  console.log(`  ✓ ${rows.length} orbs synced`);
}

async function syncAfflictions(version: string) {
  console.log("Syncing afflictions...");
  const afflictions = await fetchCodex<CodexAffliction[]>("/afflictions");

  const rows = afflictions.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    extra_card_text: a.extra_card_text ?? null,
    is_stackable: a.is_stackable,
    game_version: version,
  }));

  const { error } = await supabase.from("afflictions").upsert(rows);
  if (error) throw error;
  console.log(`  ✓ ${rows.length} afflictions synced`);
}

async function syncCharacters(version: string) {
  console.log("Syncing characters...");
  const characters = await fetchCodex<CodexCharacter[]>("/characters");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- new columns may not be in generated types yet
  const rows: any[] = characters.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description ?? null,
    starting_hp: c.starting_hp,
    starting_gold: c.starting_gold,
    starting_energy: c.max_energy,
    orb_slots: c.orb_slots ?? null,
    starting_deck: c.starting_deck,
    starting_relics: c.starting_relics,
    unlocks_after: c.unlocks_after ?? null,
    gender: c.gender ?? null,
    color: c.color ?? null,
    image_url: c.image_url ?? null,
    game_version: version,
  }));

  const { error } = await supabase.from("characters").upsert(rows);
  if (error) throw error;
  console.log(`  ✓ ${rows.length} characters synced`);
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/game-data/sync-codex.ts
git commit -m "feat: add sync functions for encounters, orbs, afflictions, characters"
```

---

### Task 6: Wire New Sync Functions into main()

**Files:**
- Modify: `apps/web/src/game-data/sync-codex.ts`

- [ ] **Step 1: Update main() to call all sync functions**

Replace the existing `main()` function:

```typescript
async function main() {
  const version = process.argv[2] ?? "unknown";
  console.log(`\nSyncing Spire Codex data (version: ${version})...\n`);

  // Ensure version exists
  await supabase
    .from("game_versions")
    .upsert({ version, synced_at: new Date().toISOString() });

  // Existing syncs
  await syncCards(version);
  await delay(1200);
  await syncRelics(version);
  await delay(1200);
  await syncPotions(version);
  await delay(1200);
  await syncMonsters(version);
  await delay(1200);
  await syncKeywords(version);
  await delay(1200);

  // New syncs
  await syncEvents(version);
  await delay(1200);
  await syncEnchantments(version);
  await delay(1200);
  await syncPowers(version);
  await delay(1200);
  await syncEncounters(version);
  await delay(1200);
  await syncOrbs(version);
  await delay(1200);
  await syncAfflictions(version);
  await delay(1200);
  await syncCharacters(version);

  console.log("\n✓ All game data synced successfully!\n");
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/game-data/sync-codex.ts
git commit -m "feat: wire all new sync functions into main()"
```

---

### Task 7: Run Full Sync and Verify

**Files:**
- No file changes — validation only

- [ ] **Step 1: Run the sync script**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && npx tsx apps/web/src/game-data/sync-codex.ts 0.3.2`

Expected output (approximate counts):
```
Syncing Spire Codex data (version: 0.3.2)...

Syncing cards...
  ✓ 576 cards synced
Syncing relics...
  ✓ 288 relics synced
Syncing potions...
  ✓ 63 potions synced
Syncing monsters...
  ✓ 116 monsters synced
Syncing keywords...
  ✓ ~97 keywords synced
Syncing events...
  ✓ 66 events synced
Syncing enchantments...
  ✓ 22 enchantments synced
Syncing powers...
  ✓ ~257 powers synced
Syncing encounters...
  ✓ 87 encounters synced
Syncing orbs...
  ✓ 5 orbs synced
Syncing afflictions...
  ✓ 6 afflictions synced
Syncing characters...
  ✓ 5 characters synced

✓ All game data synced successfully!
```

If any sync fails, check:
- Migration was applied (tables exist)
- Supabase env vars are set (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
- Rate limit not hit (1200ms delays should be sufficient)

- [ ] **Step 2: Verify data in Supabase**

Spot-check a few records to confirm data integrity:
- Events: Verify NEOW has `type = 'Ancient'` and `relics` array with 20 IDs
- Enchantments: Verify GOOPY has `applicable_to = 'Defend cards'`
- Powers: Verify VULNERABLE has `type = 'Debuff'`
- Encounters: Verify a Boss encounter has `monsters` array
- Characters: Verify Ironclad has new `description` and `color` fields populated

- [ ] **Step 3: Final commit (if any adjustments were needed)**

```bash
git add -A
git commit -m "fix: sync script adjustments from validation run"
```

Only commit if changes were needed. Skip if the sync ran cleanly.
