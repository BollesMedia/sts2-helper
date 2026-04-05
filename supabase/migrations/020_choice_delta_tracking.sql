-- 020_choice_delta_tracking.sql
-- Adds game_context, eval_pending, and sequence columns to choices table.
-- Creates act_paths table for per-act path comparison.

-- --- choices table changes ---

alter table choices add column if not exists game_context jsonb;
alter table choices add column if not exists eval_pending boolean not null default false;
alter table choices add column if not exists sequence smallint not null default 0;

-- Deduplicate existing rows before adding unique constraint.
-- Keeps the most recent row per (run_id, floor, choice_type, sequence).
delete from choices
where id in (
  select id from (
    select id,
           row_number() over (
             partition by run_id, floor, choice_type, sequence
             order by created_at desc nulls last, id desc
           ) as rn
    from choices
  ) dupes
  where rn > 1
);

-- Unique constraint for upsert backfill pattern.
-- Allows ON CONFLICT to update recommendation data after eval completes.
create unique index if not exists uq_choices_run_floor_type_seq
  on choices (run_id, floor, choice_type, sequence);

-- Index for finding pending choices that need backfill
create index if not exists idx_choices_eval_pending
  on choices (run_id, eval_pending)
  where eval_pending = true;

-- --- act_paths table ---

create table if not exists act_paths (
  id uuid primary key default gen_random_uuid(),
  run_id text not null references runs(run_id) on delete cascade,
  act int not null,
  recommended_path jsonb not null default '[]'::jsonb,
  actual_path jsonb not null default '[]'::jsonb,
  node_preferences jsonb,
  deviation_count int not null default 0,
  deviation_nodes jsonb not null default '[]'::jsonb,
  context_at_start jsonb,
  user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint uq_act_paths_run_act unique (run_id, act)
);

-- RLS: users can view and insert their own act_paths
alter table act_paths enable row level security;

create policy "Users can view own act_paths"
  on act_paths for select
  using (user_id = auth.uid());

create policy "Users can insert own act_paths"
  on act_paths for insert
  with check (user_id = auth.uid());

-- Public read (matches existing pattern from 009_public_read_rls.sql)
create policy "Public read act_paths"
  on act_paths for select
  using (true);

-- Indexes
create index if not exists idx_act_paths_run on act_paths (run_id);

-- --- Update analytics views to exclude eval_pending rows ---

drop materialized view if exists recommendation_follow_rates;
create materialized view recommendation_follow_rates as
select
  c.choice_type,
  r.character,
  case
    when r.ascension_level <= 4 then 'low'
    when r.ascension_level <= 10 then 'mid'
    else 'high'
  end as ascension_tier,
  count(*) filter (where c.was_followed = true) as followed,
  count(*) filter (where c.was_followed = false) as diverged,
  count(*) as total,
  round(
    count(*) filter (where c.was_followed = true)::numeric /
    nullif(count(*), 0), 3
  ) as follow_rate
from choices c
join runs r on c.run_id = r.run_id
where c.was_followed is not null
  and c.eval_pending = false
group by c.choice_type, r.character, ascension_tier;
