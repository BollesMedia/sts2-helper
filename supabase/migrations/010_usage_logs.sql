create table usage_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  user_id uuid references auth.users(id),
  eval_type text not null,
  model text not null,
  input_tokens int,
  output_tokens int,
  cost_estimate float
);

create index idx_usage_user_date on usage_logs (user_id, created_at);
create index idx_usage_type on usage_logs (eval_type);

-- Public read for aggregate stats, authenticated write
alter table usage_logs enable row level security;
create policy "Public read usage" on usage_logs for select using (true);
create policy "Authenticated insert usage" on usage_logs for insert with check (auth.uid() = user_id);
