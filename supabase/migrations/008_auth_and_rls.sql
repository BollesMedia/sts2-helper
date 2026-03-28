-- ============================================
-- Add user_id to user-scoped tables
-- ============================================

alter table runs add column user_id uuid references auth.users(id);
alter table evaluations add column user_id uuid references auth.users(id);
alter table choices add column user_id uuid references auth.users(id);

-- ============================================
-- Enable RLS on all tables
-- ============================================

-- User-scoped tables: users can only see/modify their own data
alter table runs enable row level security;
alter table evaluations enable row level security;
alter table choices enable row level security;

-- Runs
create policy "Users can view own runs"
  on runs for select using (auth.uid() = user_id);
create policy "Users can insert own runs"
  on runs for insert with check (auth.uid() = user_id);
create policy "Users can update own runs"
  on runs for update using (auth.uid() = user_id);

-- Evaluations
create policy "Users can view own evaluations"
  on evaluations for select using (auth.uid() = user_id);
create policy "Users can insert own evaluations"
  on evaluations for insert with check (auth.uid() = user_id);

-- Choices
create policy "Users can view own choices"
  on choices for select using (auth.uid() = user_id);
create policy "Users can insert own choices"
  on choices for insert with check (auth.uid() = user_id);

-- Game data tables: public read, no write from client
alter table cards enable row level security;
alter table relics enable row level security;
alter table potions enable row level security;
alter table monsters enable row level security;
alter table keywords enable row level security;
alter table characters enable row level security;
alter table game_versions enable row level security;
alter table character_strategies enable row level security;

create policy "Public read cards" on cards for select using (true);
create policy "Public read relics" on relics for select using (true);
create policy "Public read potions" on potions for select using (true);
create policy "Public read monsters" on monsters for select using (true);
create policy "Public read keywords" on keywords for select using (true);
create policy "Public read characters" on characters for select using (true);
create policy "Public read game_versions" on game_versions for select using (true);
create policy "Public read strategies" on character_strategies for select using (true);

-- Evaluation stats view: accessible to authenticated users
-- (views inherit RLS from underlying tables)

-- ============================================
-- Allow anonymous auth users (for frictionless onboarding)
-- ============================================
-- Anonymous users get full access to their own data via RLS
-- They can later link an email to upgrade their account
