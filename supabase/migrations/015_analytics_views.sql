-- Analytics materialized views for data-driven evaluation improvements

-- Card win rates by context bucket
CREATE MATERIALIZED VIEW IF NOT EXISTS card_win_rates AS
SELECT
  e.item_id,
  e.item_name,
  e.character,
  e.act,
  e.primary_archetype,
  COALESCE(
    CASE WHEN r.ascension_level <= 4 THEN 'low'
         WHEN r.ascension_level <= 9 THEN 'mid'
         ELSE 'high' END,
    'low'
  ) as ascension_tier,
  COUNT(*) as times_offered,
  COUNT(*) FILTER (WHERE c.chosen_item_id IS NOT NULL) as times_picked,
  COUNT(*) FILTER (WHERE c.chosen_item_id IS NULL) as times_skipped,
  AVG(CASE WHEN r.victory AND c.chosen_item_id IS NOT NULL THEN 1.0
       WHEN NOT r.victory AND c.chosen_item_id IS NOT NULL THEN 0.0
       ELSE NULL END) as pick_win_rate,
  AVG(CASE WHEN r.victory AND c.chosen_item_id IS NULL THEN 1.0
       WHEN NOT r.victory AND c.chosen_item_id IS NULL THEN 0.0
       ELSE NULL END) as skip_win_rate
FROM evaluations e
JOIN choices c ON c.run_id = e.run_id AND c.floor = e.floor
JOIN runs r ON r.run_id = e.run_id AND r.ended_at IS NOT NULL AND r.victory IS NOT NULL
GROUP BY 1, 2, 3, 4, 5, 6;

CREATE INDEX IF NOT EXISTS idx_cwr_lookup ON card_win_rates (item_id, character, act, ascension_tier);

-- Evaluation accuracy: how often Claude's tier/recommendation matches player behavior and outcomes
CREATE MATERIALIZED VIEW IF NOT EXISTS eval_accuracy AS
SELECT
  e.source,
  e.eval_type,
  e.tier_value as predicted_tier,
  e.recommendation as predicted_rec,
  CASE WHEN c.chosen_item_id = e.item_name THEN 'picked' ELSE 'skipped' END as player_action,
  r.victory,
  COUNT(*) as n,
  AVG(e.confidence) as avg_confidence
FROM evaluations e
JOIN choices c ON c.run_id = e.run_id AND c.floor = e.floor
JOIN runs r ON r.run_id = e.run_id AND r.ended_at IS NOT NULL AND r.victory IS NOT NULL
WHERE e.eval_type IS NOT NULL
GROUP BY 1, 2, 3, 4, 5, 6;

-- Ascension-scoped evaluation stats (replaces the old unscoped view)
CREATE MATERIALIZED VIEW IF NOT EXISTS evaluation_stats_v2 AS
SELECT
  e.item_id,
  e.item_name,
  e.character,
  e.primary_archetype,
  e.act,
  COALESCE(
    CASE WHEN e.ascension <= 4 THEN 'low'
         WHEN e.ascension <= 9 THEN 'mid'
         ELSE 'high' END,
    'low'
  ) as ascension_tier,
  COUNT(*) as eval_count,
  AVG(e.confidence)::int as avg_confidence,
  ROUND(SUM(e.tier_value * e.confidence)::numeric / NULLIF(SUM(e.confidence), 0), 1) as weighted_tier,
  ROUND(SUM(e.synergy_score * e.confidence)::numeric / NULLIF(SUM(e.confidence), 0))::int as weighted_synergy,
  MODE() WITHIN GROUP (ORDER BY e.recommendation) as most_common_rec,
  STDDEV(e.tier_value)::numeric(3,1) as tier_stddev
FROM evaluations e
JOIN runs r ON r.run_id = e.run_id
WHERE e.source = 'claude'
GROUP BY 1, 2, 3, 4, 5, 6;

CREATE INDEX IF NOT EXISTS idx_esv2_lookup ON evaluation_stats_v2 (item_id, character, act, ascension_tier);

-- Recommendation follow rate: how often players follow the companion's advice
CREATE MATERIALIZED VIEW IF NOT EXISTS recommendation_follow_rates AS
SELECT
  c.choice_type,
  r.character,
  CASE WHEN r.ascension_level <= 4 THEN 'low'
       WHEN r.ascension_level <= 9 THEN 'mid'
       ELSE 'high' END as ascension_tier,
  COUNT(*) as total_choices,
  COUNT(*) FILTER (WHERE c.was_followed = true) as followed,
  COUNT(*) FILTER (WHERE c.was_followed = false) as diverged,
  AVG(CASE WHEN c.was_followed THEN 1.0 ELSE 0.0 END) as follow_rate,
  AVG(CASE WHEN c.was_followed AND r.victory THEN 1.0
       WHEN c.was_followed AND NOT r.victory THEN 0.0
       ELSE NULL END) as followed_win_rate,
  AVG(CASE WHEN NOT c.was_followed AND r.victory THEN 1.0
       WHEN NOT c.was_followed AND NOT r.victory THEN 0.0
       ELSE NULL END) as diverged_win_rate
FROM choices c
JOIN runs r ON r.run_id = c.run_id AND r.ended_at IS NOT NULL AND r.victory IS NOT NULL
WHERE c.was_followed IS NOT NULL
GROUP BY 1, 2, 3;
