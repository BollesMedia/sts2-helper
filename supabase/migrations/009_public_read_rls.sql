-- Drop existing restrictive select policies
drop policy if exists "Users can view own runs" on runs;
drop policy if exists "Users can view own evaluations" on evaluations;
drop policy if exists "Users can view own choices" on choices;

-- Public read on user data tables (for leaderboards, community stats)
create policy "Public read runs" on runs for select using (true);
create policy "Public read evaluations" on evaluations for select using (true);
create policy "Public read choices" on choices for select using (true);

-- Write policies stay restricted to authenticated users owning the data
-- (insert/update policies from migration 008 are already correct)
