-- Perceptual image hash for each card, used by tier-list scrape ingestion
-- to match community tier-list card images (e.g. tiermaker.com) back to
-- canonical cards without OCR. 16-char hex = 64-bit dHash.
--
-- render_url holds the source URL the hash was computed from (currently
-- slaythespire.wiki.gg full-card renders — chosen because they visually
-- match tiermaker-style community images, unlike the art-only crops in
-- image_url). Persisting it lets us (a) audit the hash source, (b) re-hash
-- in place if the algorithm changes, and (c) eventually mirror the assets
-- into our own storage bucket.
alter table cards
  add column if not exists phash text,
  add column if not exists render_url text;

create index if not exists idx_cards_phash on cards (phash) where phash is not null;
