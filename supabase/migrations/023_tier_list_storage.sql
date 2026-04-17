-- ============================================
-- Supabase Storage bucket for tier list images
-- ============================================

-- Public read bucket for admin-uploaded tier list images.
-- MIME allowlist prevents attacker-controlled content-types (e.g. HTML) from
-- being served through the public URL. Keep in sync with extract/route.ts.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tier-list-images',
  'tier-list-images',
  true,
  26214400,  -- 25 MB — matches next.config proxyClientMaxBodySize + route limit
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Allow public read access
create policy "Public read tier list images" on storage.objects
  for select using (bucket_id = 'tier-list-images');

-- Only service role writes (handled via RLS bypass — no policy needed)
