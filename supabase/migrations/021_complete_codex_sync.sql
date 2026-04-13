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
