-- Adds structured run-state snapshot for map coach evals.
-- Phase 1 is backward-compatible: column is NULL for legacy rows. No index
-- in phase 1; queries will be added in phase 2 (calibration loop) where
-- an appropriate GIN index can be defined against real query patterns.

ALTER TABLE choices
  ADD COLUMN run_state_snapshot jsonb NULL;

COMMENT ON COLUMN choices.run_state_snapshot IS
  'RunState object computed by the map coach at eval time. Used by phase-2 calibration to analyze in which contexts recommendations were followed/diverged.';
