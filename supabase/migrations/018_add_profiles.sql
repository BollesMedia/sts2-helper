-- User profiles with role-based access control
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user',
  created_at timestamptz default now()
);

alter table profiles enable row level security;

-- Users can read their own profile
create policy "Users can read own profile" on profiles
  for select using (auth.uid() = id);

-- Auto-create profile on user signup via trigger
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, role) values (new.id, 'user');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
