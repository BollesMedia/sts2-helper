-- Add upgrade data columns to cards table
-- upgrade: JSON object with upgrade deltas (e.g., {"damage": "+5", "vulnerable": "+1"})
-- upgrade_description: full text of the upgraded card description
alter table cards add column if not exists upgrade jsonb;
alter table cards add column if not exists upgrade_description text;
