-- Seed characters table with starter decks.
-- Card names are display names as the mod API returns them.
-- Use ON CONFLICT to allow safe re-runs.

INSERT INTO characters (id, name, starting_hp, starting_gold, starting_energy, starting_deck, starting_relics)
VALUES
  ('ironclad', 'The Ironclad', 80, 99, 3,
    ARRAY['Strike', 'Strike', 'Strike', 'Strike', 'Strike', 'Defend', 'Defend', 'Defend', 'Defend', 'Bash'],
    ARRAY['Burning Blood']),

  ('silent', 'The Silent', 70, 99, 3,
    ARRAY['Strike', 'Strike', 'Strike', 'Strike', 'Strike', 'Defend', 'Defend', 'Defend', 'Defend', 'Defend', 'Neutralize', 'Survivor'],
    ARRAY['Ring of the Snake']),

  ('defect', 'The Defect', 75, 99, 3,
    ARRAY['Strike', 'Strike', 'Strike', 'Strike', 'Defend', 'Defend', 'Defend', 'Defend', 'Zap', 'Dualcast'],
    ARRAY['Cracked Core']),

  ('regent', 'The Regent', 75, 99, 3,
    ARRAY['Strike', 'Strike', 'Strike', 'Strike', 'Defend', 'Defend', 'Defend', 'Defend', 'Falling Star', 'Venerate'],
    ARRAY['Divine Right']),

  ('necrobinder', 'The Necrobinder', 66, 99, 3,
    ARRAY['Strike', 'Strike', 'Strike', 'Strike', 'Defend', 'Defend', 'Defend', 'Defend', 'Bodyguard', 'Unleash'],
    ARRAY['Bound Phylactery'])

ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  starting_hp = EXCLUDED.starting_hp,
  starting_gold = EXCLUDED.starting_gold,
  starting_energy = EXCLUDED.starting_energy,
  starting_deck = EXCLUDED.starting_deck,
  starting_relics = EXCLUDED.starting_relics;
