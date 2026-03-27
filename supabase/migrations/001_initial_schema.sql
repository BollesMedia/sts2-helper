-- ============================================
-- Game reference data (synced from Spire Codex)
-- ============================================

create table game_versions (
  id uuid primary key default gen_random_uuid(),
  version text unique not null,
  synced_at timestamptz default now()
);

create table cards (
  id text primary key,
  name text not null,
  description text not null,
  description_raw text,
  cost int,
  star_cost int,
  type text not null,
  rarity text not null,
  color text not null,
  target text,
  damage int,
  block int,
  hit_count int,
  keywords text[],
  tags text[],
  image_url text,
  game_version text references game_versions(version),
  updated_at timestamptz default now()
);

create table relics (
  id text primary key,
  name text not null,
  description text not null,
  rarity text,
  pool text,
  image_url text,
  game_version text references game_versions(version),
  updated_at timestamptz default now()
);

create table potions (
  id text primary key,
  name text not null,
  description text not null,
  rarity text,
  pool text,
  image_url text,
  game_version text references game_versions(version),
  updated_at timestamptz default now()
);

create table monsters (
  id text primary key,
  name text not null,
  type text not null,
  min_hp int not null,
  max_hp int not null,
  moves jsonb,
  image_url text,
  game_version text references game_versions(version),
  updated_at timestamptz default now()
);

create table keywords (
  id text primary key,
  name text not null,
  description text not null,
  game_version text references game_versions(version)
);

create table characters (
  id text primary key,
  name text not null,
  starting_hp int not null,
  starting_gold int not null,
  starting_energy int not null,
  starting_deck text[],
  starting_relics text[],
  game_version text references game_versions(version)
);

-- ============================================
-- Decision tracking
-- ============================================

create table runs (
  id uuid primary key default gen_random_uuid(),
  run_id text unique not null,
  started_at timestamptz default now(),
  ended_at timestamptz,
  character text not null,
  final_floor int,
  victory boolean,
  ascension_level int,
  game_version text
);

create table evaluations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  run_id text references runs(run_id),
  game_version text,

  -- What was evaluated
  item_type text not null,
  item_id text not null,
  item_name text not null,

  -- Context at time of evaluation
  character text not null,
  archetypes text[],
  primary_archetype text,
  act int not null,
  floor int not null,
  deck_size int not null,
  hp_percent float not null,
  gold int,
  energy int,
  relic_ids text[],
  has_scaling boolean,
  curse_count int default 0,

  -- Evaluation result
  tier_value int not null,
  synergy_score int not null,
  confidence int not null,
  recommendation text not null,
  reasoning text not null,
  source text not null default 'claude',

  -- For querying similar contexts
  context_hash text not null
);

create table choices (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  run_id text references runs(run_id),

  choice_type text not null,
  floor int not null,
  act int not null,

  offered_item_ids text[] not null,
  chosen_item_id text,
  evaluation_ids uuid[]
);

-- ============================================
-- Indexes
-- ============================================

create index idx_eval_item on evaluations (item_id, character);
create index idx_eval_context on evaluations (context_hash, item_id);
create index idx_eval_lookup on evaluations (item_id, character, primary_archetype, act);
create index idx_eval_run on evaluations (run_id);
create index idx_choices_run on choices (run_id);

-- ============================================
-- Aggregated stats view
-- ============================================

create view evaluation_stats as
select
  item_id,
  item_name,
  character,
  primary_archetype,
  act,
  count(*) as eval_count,
  avg(confidence)::int as avg_confidence,
  round(sum(tier_value * confidence)::numeric / nullif(sum(confidence), 0), 1) as weighted_tier,
  round(sum(synergy_score * confidence)::numeric / nullif(sum(confidence), 0))::int as weighted_synergy,
  mode() within group (order by recommendation) as most_common_rec,
  stddev(tier_value)::numeric(3,1) as tier_stddev
from evaluations
where source = 'claude'
group by item_id, item_name, character, primary_archetype, act;
