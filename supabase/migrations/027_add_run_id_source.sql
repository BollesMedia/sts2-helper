-- Add run_id_source column to runs. NULL means legacy client-minted;
-- 'save_file' means canonical (derived from STS2 save-file start_time);
-- 'client_fallback' means the save reader was unavailable at detection time.
ALTER TABLE public.runs
  ADD COLUMN IF NOT EXISTS run_id_source text;

COMMENT ON COLUMN public.runs.run_id_source IS
  'Provenance of run_id: NULL=legacy client-minted, save_file=canonical (start_time), client_fallback=save reader unavailable.';
