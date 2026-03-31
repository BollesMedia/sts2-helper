-- Analytics infrastructure: add missing columns for data-driven evaluation improvements

-- Evaluations: add ascension, eval_type, weight tracking
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS ascension int;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS eval_type text;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS original_tier_value int;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS weight_adjustments jsonb;

-- Runs: persist run narrative
ALTER TABLE runs ADD COLUMN IF NOT EXISTS narrative jsonb;

-- Choices: track recommendation vs actual pick
ALTER TABLE choices ADD COLUMN IF NOT EXISTS recommended_item_id text;
ALTER TABLE choices ADD COLUMN IF NOT EXISTS recommended_tier text;
ALTER TABLE choices ADD COLUMN IF NOT EXISTS was_followed boolean;
ALTER TABLE choices ADD COLUMN IF NOT EXISTS rankings_snapshot jsonb;

-- Indices for analytics queries
CREATE INDEX IF NOT EXISTS idx_eval_ascension ON evaluations (item_id, character, ascension, act);
CREATE INDEX IF NOT EXISTS idx_eval_type ON evaluations (eval_type);
CREATE INDEX IF NOT EXISTS idx_choices_type ON choices (choice_type);
CREATE INDEX IF NOT EXISTS idx_choices_followed ON choices (was_followed) WHERE was_followed IS NOT NULL;

-- Weight rules table (data-driven weight management)
CREATE TABLE IF NOT EXISTS weight_rules (
  id text PRIMARY KEY,
  eval_type text NOT NULL,
  condition jsonb NOT NULL,
  action jsonb NOT NULL,
  priority int DEFAULT 0,
  enabled boolean DEFAULT true,
  source text DEFAULT 'manual',
  sample_size int,
  win_rate_delta float,
  created_at timestamptz DEFAULT now()
);

-- RLS for weight_rules (public read)
ALTER TABLE weight_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read weight rules" ON weight_rules FOR SELECT USING (true);

-- Seed initial weight rules from current hardcoded logic
INSERT INTO weight_rules (id, eval_type, condition, action, priority, source) VALUES
('rest_auto_heal', 'rest_site', '{"hp_percent_lt": 0.30}', '{"force_option": "heal", "reason": "HP critically low"}', 100, 'manual'),
('rest_auto_upgrade', 'rest_site', '{"hp_percent_gt": 0.95, "missing_hp_lte": 5}', '{"force_option": "upgrade", "reason": "HP nearly full"}', 100, 'manual'),
('rest_heal_before_elite', 'rest_site', '{"has_elite_ahead": true, "hp_percent_lt": 0.75}', '{"boost_option": "heal", "tier": "S", "reason": "Heal before elite — survival > optimization"}', 50, 'manual'),
('rest_heal_before_boss', 'rest_site', '{"has_boss_near": true, "hp_percent_lt": 0.80}', '{"boost_option": "heal", "tier": "S", "reason": "Heal before boss — enter at max HP"}', 50, 'manual'),
('shop_remove_curse', 'shop', '{"deck_has_unplayable": true}', '{"boost_item": "card_removal", "tier": "S", "reason": "Remove unplayable/curse card — top priority"}', 80, 'manual'),
('card_act1_immediate', 'card_reward', '{"act": 1, "floor_lte": 5}', '{"boost_immediate_cards": true, "tier_delta": 1}', 30, 'manual'),
('shop_act3_spend_all', 'shop', '{"act": 3}', '{"spend_all_gold": true, "reason": "Act 3 — gold worthless after boss"}', 40, 'manual')
ON CONFLICT (id) DO NOTHING;
