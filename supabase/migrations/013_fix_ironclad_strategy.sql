-- Fix Ironclad strategy: Twin Strike is NOT a skip (scales with Vulnerable/Strength)
-- Add key synergy pairs, note True Grit unreliability

UPDATE character_strategies SET strategy = 'Ironclad archetypes (pick one, don''t mix):
1. EXHAUST ENGINE (strongest): Corruption + Dark Embrace + Feel No Pain. Skills become free, exhaust generates block and draw. Add Burning Pact, Stoke, Second Wind, Fiend Fire. Offering fuels it.
2. VULNERABLE: STS2-new archetype. Cruelty, Molten Fist, Taunt, Tremble, Dismantle, Stomp apply Vulnerable. Pairs well with multi-hit attacks (Twin Strike, Sword Boomerang).
3. BODY SLAM / BLOCK: Stack block with Barricade + Unmovable + Shrug It Off + Colossus + Stone Armor, deal damage with Body Slam. Body Slam scales with ALL block cards. Impervious for burst block. Blood Wall for passive block.
4. STRENGTH SCALING: Demon Form or Rupture + self-damage (Offering, Bloodletting, Hemokinesis). Crimson Mantle for passive Strength. Payoff with Whirlwind, Sword Boomerang, Heavy Blade.

S-tier cards (always strong picks): Offering, Feed, Expect a Fight, Battle Trance, Corruption, Dark Embrace, Feel No Pain, Barricade, Demon Form, Bloodletting, Shrug It Off.
Always skip: Perfected Strike (scales with starters), Clash (restrictive), Wild Strike (adds Wound), Flex (temporary Strength).
Key synergies: Offering + Burning Sticks (replay Offering), Body Slam + any block card, Corruption + Dark Embrace (free skills + draw), Twin Strike/Sword Boomerang + Vulnerable.
Note: True Grit exhausts a RANDOM card — unreliable. Prefer targeted exhaust (Burning Pact, Fiend Fire).
Key principle: Draft damage/block for Act 1 survival, then engine pieces. Offering is the single best Ironclad card.', updated_at = now()
WHERE id = 'the ironclad';
