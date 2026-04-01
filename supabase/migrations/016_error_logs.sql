-- Error and feedback logging for remote debugging
CREATE TABLE IF NOT EXISTS error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  user_id uuid,
  source text NOT NULL,        -- 'desktop_crash', 'evaluation', 'connection', 'startup', 'user_feedback', 'unhandled'
  level text DEFAULT 'error',  -- 'error', 'warn', 'info'
  message text NOT NULL,
  context jsonb,               -- stack trace, game state, eval type, etc.
  app_version text,
  platform text                -- 'macos', 'windows'
);

ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users insert own errors" ON error_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Users read own errors" ON error_logs FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX idx_error_logs_user ON error_logs (user_id, created_at DESC);
CREATE INDEX idx_error_logs_source ON error_logs (source, created_at DESC);
