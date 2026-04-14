-- ============================================
-- Supabase Storage bucket for tier list images
-- ============================================

-- Public read bucket for admin-uploaded tier list images
insert into storage.buckets (id, name, public)
values ('tier-list-images', 'tier-list-images', true)
on conflict (id) do nothing;

-- Allow public read access
create policy "Public read tier list images" on storage.objects
  for select using (bucket_id = 'tier-list-images');

-- Only service role writes (handled via RLS bypass — no policy needed)
