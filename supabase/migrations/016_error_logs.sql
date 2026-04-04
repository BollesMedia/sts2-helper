-- Error and feedback logging for remote debugging
CREATE TABLE IF NOT EXISTS error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  user_id uuid,
  source text NOT NULL,
  level text DEFAULT 'error',
  message text NOT NULL,
  context jsonb,
  app_version text,
  platform text
);

ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users insert own errors" ON error_logs FOR INSERT WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users read own errors" ON error_logs FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_error_logs_user ON error_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_source ON error_logs (source, created_at DESC);
