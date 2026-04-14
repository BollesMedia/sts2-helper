-- ============================================
-- Community tier list aggregation signal
-- Adds tier list sources, snapshots, per-card entries + consensus MV
-- Extends game_versions with release metadata for staleness detection
-- ============================================

-- Extend game_versions with release metadata
alter table game_versions
  add column if not exists released_at date,
  add column if not exists release_notes text,
  add column if not exists is_major_balance_patch boolean not null default false,
  add column if not exists notes_url text;

-- Tier list sources — metadata about where a tier list came from
create table tier_list_sources (
  id text primary key,                    -- slug, e.g. 'baalorlord_2026q1'
  author text not null,
  source_type text not null check (source_type in ('image', 'spreadsheet', 'website', 'reddit', 'youtube')),
  source_url text,
  trust_weight real not null default 1.0 check (trust_weight >= 0 and trust_weight <= 2),
  scale_type text not null check (scale_type in ('letter_6', 'letter_5', 'numeric_10', 'numeric_5', 'binary')),
  scale_config jsonb,                     -- per-source tier overrides (e.g. S+/SS tiers)
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Tier lists — per-snapshot of a source (version/date-scoped)
create table tier_lists (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references tier_list_sources(id) on delete cascade,
  game_version text references game_versions(version),
  published_at date not null,
  character text check (character is null or character = lower(character)),
  is_active boolean not null default true,
  source_image_url text,                  -- Supabase Storage URL for original image
  ingestion_method text not null check (ingestion_method in ('vision_llm', 'manual_confirm', 'scraped')),
  ingested_at timestamptz not null default now(),
  entry_count int not null default 0,
  constraint tier_lists_unique unique (source_id, game_version, published_at, character)
);

create index idx_tier_lists_active on tier_lists (is_active, game_version) where is_active;
create index idx_tier_lists_source on tier_lists (source_id);

-- Tier list entries — per-card tier data
create table tier_list_entries (
  id uuid primary key default gen_random_uuid(),
  tier_list_id uuid not null references tier_lists(id) on delete cascade,
  card_id text not null references cards(id) on delete cascade,
  raw_tier text not null,                 -- source's original label (e.g. 'S', '9', 'good')
  normalized_tier real not null check (normalized_tier >= 1 and normalized_tier <= 6),
  note text,
  extraction_confidence real check (extraction_confidence >= 0 and extraction_confidence <= 1),
  created_at timestamptz not null default now(),
  constraint tier_list_entries_unique unique (tier_list_id, card_id)
);

create index idx_tier_list_entries_card on tier_list_entries (card_id);
create index idx_tier_list_entries_list on tier_list_entries (tier_list_id);

-- Materialized view: aggregated consensus across active tier lists.
-- `character_scope` is lowercased so 'Ironclad' and 'ironclad' merge into
-- a single group regardless of how source rows are stored.
create materialized view community_tier_consensus as
with active as (
  select
    tle.card_id,
    tle.normalized_tier,
    tls.trust_weight,
    coalesce(lower(tl.character), 'any') as character_scope,
    tl.game_version,
    tl.published_at
  from tier_list_entries tle
  join tier_lists tl on tl.id = tle.tier_list_id
  join tier_list_sources tls on tls.id = tl.source_id
  where tl.is_active = true
)
select
  card_id,
  character_scope,
  count(*)::int as source_count,
  round(
    (sum(normalized_tier * trust_weight) / nullif(sum(trust_weight), 0))::numeric,
    2
  )::real as weighted_tier,
  coalesce(stddev(normalized_tier)::real, 0) as tier_stddev,
  max(published_at) as most_recent_published,
  min(published_at) as oldest_published,
  array_agg(distinct game_version) filter (where game_version is not null) as game_versions
from active
group by card_id, character_scope;

create unique index idx_ctc_pk on community_tier_consensus (card_id, character_scope);

-- ============================================
-- RLS policies (public read, same as other reference tables)
-- ============================================

alter table tier_list_sources enable row level security;
create policy "Public read" on tier_list_sources for select using (true);

alter table tier_lists enable row level security;
create policy "Public read" on tier_lists for select using (true);

alter table tier_list_entries enable row level security;
create policy "Public read" on tier_list_entries for select using (true);
