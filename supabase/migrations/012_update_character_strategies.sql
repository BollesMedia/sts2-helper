-- Update character strategies with verified STS2 card names and "always skip" lists
-- Verified against cards table + known game data 2026-03-30

UPDATE character_strategies SET strategy = 'Ironclad archetypes (pick one, don''t mix):
1. EXHAUST ENGINE (strongest): Corruption + Dark Embrace + Feel No Pain. Skills become free, exhaust generates block and draw. Add Burning Pact, Stoke, Second Wind, Fiend Fire. Offering fuels it.
2. VULNERABLE: STS2-new archetype. Cruelty, Molten Fist, Taunt, Tremble, Dismantle, Stomp apply Vulnerable. Pairs well with multi-hit attacks.
3. BODY SLAM / BLOCK: Stack block with Barricade + Unmovable + Shrug It Off + Colossus + Stone Armor, deal damage with Body Slam. Impervious for burst block. Blood Wall for passive block.
4. STRENGTH SCALING: Demon Form or Rupture + self-damage (Offering, Bloodletting, Hemokinesis). Crimson Mantle for passive Strength. Payoff with Whirlwind, Sword Boomerang, Heavy Blade.

S-tier cards (always strong picks): Offering, Feed, Expect a Fight, Battle Trance, Corruption, Dark Embrace, Feel No Pain, Barricade, Demon Form, Bloodletting, Shrug It Off.
Always skip: Perfected Strike, Twin Strike, Anger, Clash, Wild Strike, Iron Wave, Flex.
Key principle: Draft damage/block for Act 1 survival, then engine pieces. Offering is the single best Ironclad card.', updated_at = now()
WHERE id = 'the ironclad';

UPDATE character_strategies SET strategy = 'Silent archetypes:
1. POISON (strongest scaling): Noxious Fumes + Envenom + Corrosive Wave for scaling. Bouncing Flask, Deadly Poison for application. Outbreak for burst. Patient strategy — stall and let poison tick.
2. SHIV: Blade Dance, Cloak and Dagger, Infinite Blades + Accuracy. Fast damage. Afterimage for defense. Storm of Steel for burst. Finisher as payoff.
3. DISCARD: Acrobatics, Calculated Gamble, Expertise, Reflex, Tools of the Trade. Draw engine that cycles fast. Sly keyword cards play free when discarded.

S-tier cards (always strong picks): Serpent Form, Afterimage, Adrenaline, Noxious Fumes, Bouncing Flask, Leg Sweep, Backflip, Burst.
Always skip: Slice, Poisoned Stab, Sucker Punch, Dagger Throw (low impact at all stages).
Key principle: Silent is fragile — Serpent Form and Afterimage are critical defensive pieces. Prioritize draw and energy over raw damage.', updated_at = now()
WHERE id = 'the silent';

UPDATE character_strategies SET strategy = 'Defect archetypes:
1. FOCUS/FROST (strongest): Stack Focus (Defragment, Biased Cognition) + Frost orbs for passive block. Glacier, Coolheaded, Chill, Hailstorm, Cold Snap. Capacitor for orb slots.
2. ZERO-COST/CLAW: Claw + All for One + Scrape + FTL. Zero-cost spam that scales Claw damage per play. Fast and consistent.
3. LIGHTNING: Ball Lightning, Storm, Thunder, Voltaic, Sweeping Beam. AoE lightning damage. Lightning Rod for channeling.

S-tier cards (always strong picks): Defragment, Glacier, Biased Cognition, Echo Form, All for One, Creative AI, Compile Driver, Skim.
Always skip: Beam Cell, Hello World (event card), Go for the Eyes (low impact).
Key principle: Focus is the most important stat. Defragment is almost always a pick. Capacitor enables more orbs. Orb slots matter.', updated_at = now()
WHERE id = 'the defect';

UPDATE character_strategies SET strategy = 'Regent archetypes:
1. STAR ENGINE: Accumulate Stars with Seven Stars, Child of the Stars, Gather Light, Stardust. Cloak of Stars and Guiding Star for star usage. Celestial Might for scaling.
2. COSMIC: Big Bang, Quasar, Meteor Shower, Supermassive, Gamma Blast for massive damage. Black Hole and Cosmic Indifference for control.
3. ROYAL AUTHORITY: Manifest Authority, Hegemony, Conqueror. Command-style cards that scale with control. GUARDS!!! for minion defense.

S-tier cards (always strong picks): Void Form, Genesis, I Am Invincible, Foregone Conclusion, Big Bang, Seven Stars.
Always skip: Basic attacks that don''t scale, off-theme cards without star/cosmic synergy.
Key principle: Regent rewards building around stars or cosmic damage. Star generation + scaling is the core loop. Don''t mix star and cosmic builds.', updated_at = now()
WHERE id = 'the regent';

UPDATE character_strategies SET strategy = 'Necrobinder archetypes:
1. REAPER: Reaper Form + Deathbringer + Death''s Door + Death March. Execute enemies at low HP. Drain Power for scaling. Reap for sustain.
2. SPIRIT: Soul Storm + Capture Spirit + Spirit of Ash + Call of the Void + Seance. Soul generation creates near-infinite engines. Highest damage ceiling.
3. BONE/SUMMON: Bone Shards, Legion of Bone, Reanimate, Sentry Mode, Protector, Bodyguard. Summons absorb damage. Build around sustained summon uptime.

S-tier cards (always strong picks): Reaper Form, Soul Storm, Deathbringer, Reanimate, Legion of Bone, Necro Mastery.
Always skip: Poke (too weak), basic attacks without synergy.
Key principle: Summons are your biggest advantage — invest in summon cards. Necrobinder has highest damage ceiling but is vulnerable when summons die. Reaper Form is the strongest power in the game for this class.', updated_at = now()
WHERE id = 'the necrobinder';
