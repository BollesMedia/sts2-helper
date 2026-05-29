-- 029_tier_list_auto_refresh.sql
-- Auto-refresh: source scheduling/backoff columns, pending-review on snapshots,
-- audit log, cron concurrency claim, and an auto-enable trigger.

ALTER TABLE tier_list_sources
  ADD COLUMN auto_refresh_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN dormant boolean NOT NULL DEFAULT false,
  ADD COLUMN next_refresh_at timestamptz,
  ADD COLUMN last_refresh_attempted_at timestamptz,
  ADD COLUMN last_refresh_succeeded_at timestamptz,
  ADD COLUMN consecutive_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN consecutive_queue_only integer NOT NULL DEFAULT 0,
  ADD COLUMN last_failure_reason text;

CREATE INDEX tier_list_sources_due_idx
  ON tier_list_sources (next_refresh_at)
  WHERE auto_refresh_enabled = true AND dormant = false;

ALTER TABLE tier_lists
  ADD COLUMN review_status text NOT NULL DEFAULT 'none'
    CHECK (review_status IN ('none', 'pending')),
  ADD COLUMN gate_failure_reasons jsonb;

-- Pending drafts coexist with their active counterparts on the same
-- (source_id, game_version, published_at, character) key, so the old unique
-- constraint must scope to non-pending rows.
ALTER TABLE tier_lists DROP CONSTRAINT tier_lists_unique;
CREATE UNIQUE INDEX tier_lists_unique_non_pending
  ON tier_lists (source_id, game_version, published_at, character)
  WHERE review_status = 'none';

CREATE INDEX tier_lists_pending_review_idx
  ON tier_lists (review_status)
  WHERE review_status = 'pending';

CREATE TABLE tier_list_refresh_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES tier_list_sources(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('applied','partial','queued','failed','no_data')),
  trigger text NOT NULL CHECK (trigger IN ('cron','manual')),
  sections_attempted integer NOT NULL DEFAULT 0,
  sections_applied integer NOT NULL DEFAULT 0,
  sections_queued integer NOT NULL DEFAULT 0,
  error_detail jsonb,
  rejected_snapshot jsonb
);

CREATE INDEX tier_list_refresh_logs_source_started_idx
  ON tier_list_refresh_logs (source_id, started_at DESC);

CREATE TABLE tier_list_refresh_runs (
  id text PRIMARY KEY,
  claimed_at timestamptz,
  claimed_by text
);
INSERT INTO tier_list_refresh_runs (id) VALUES ('singleton');

CREATE OR REPLACE FUNCTION tier_list_sources_auto_refresh_enable()
  RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.auto_refresh_enabled = true
     AND (OLD.auto_refresh_enabled = false OR OLD.auto_refresh_enabled IS NULL)
     AND NEW.next_refresh_at IS NULL THEN
    NEW.next_refresh_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tier_list_sources_auto_refresh_enable_trg
  BEFORE UPDATE ON tier_list_sources
  FOR EACH ROW EXECUTE FUNCTION tier_list_sources_auto_refresh_enable();

-- ============================================
-- RLS policies (matching 022 public-read pattern)
-- ============================================

-- Audit + claim tables are admin-only. RLS enabled with no SELECT policy:
-- anon/authenticated (public anon key) are denied; the service-role client
-- used by the cron + admin API routes bypasses RLS.
ALTER TABLE tier_list_refresh_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tier_list_refresh_runs ENABLE ROW LEVEL SECURITY;
