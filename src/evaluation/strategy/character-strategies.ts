/**
 * Curated character strategy guides for STS2.
 * Verified against actual STS2 card database — no STS1-only cards.
 * Keep each entry under ~150 tokens for prompt efficiency.
 */

const STRATEGIES: Record<string, string> = {
  "the ironclad": `Ironclad archetypes (pick one, don't mix):
1. EXHAUST ENGINE (strongest high-ascension build): Corruption + Dark Embrace + Feel No Pain. Skills become free, exhaust generates block and draw. Add Burning Pact, Stoke, Thrash, Second Wind. Offering fuels it.
2. VULNERABLE: STS2-new archetype. Tremble, Molten Fist, Taunt, Dismantle apply Vulnerable. Cruelty makes Vulnerable enemies take 25% extra damage. Pairs well with multi-hit attacks.
3. BODY SLAM: Stack block with Barricade + Unmovable + Shrug It Off + Colossus, then deal damage with Body Slam. Impervious for burst block.
4. STRENGTH SCALING: Demon Form or Rupture + self-damage (Offering, Bloodletting). Crimson Mantle for passive Strength. Payoff with Whirlwind, Sword Boomerang, Twin Strike.

S-tier cards: Offering (ALWAYS take), Feed (always take early), Expect a Fight, Battle Trance, Corruption, Dark Embrace, Feel No Pain, Barricade, Demon Form, Bloodletting, Unmovable.
Key principle: Draft damage/block for Act 1 survival, then engine pieces in Acts 2-3. Offering is the single best Ironclad card.`,

  "the silent": `Silent archetypes:
1. SLY DISCARD (highest damage ceiling): Build around Sly keyword — discarded Sly cards play for free. Combine with Calculated Gamble, Acrobatics, Tactician for explosive turns.
2. POISON: Noxious Fumes + Catalyst for scaling. Bouncing Flask, Deadly Poison for application. Corpse Explosion for AoE. Patient strategy — stall and let poison tick.
3. SHIV: Blade Dance, Cloak and Dagger, Infinite Blades + Accuracy. Fast damage but needs defensive support from Wraith Form or After Image.

S-tier cards: Wraith Form, After Image, Adrenaline, Catalyst, Noxious Fumes, Bouncing Flask.
Key principle: Silent is fragile — Wraith Form and After Image are critical. Prioritize draw and energy over raw damage.`,

  "the defect": `Defect archetypes:
1. CLAW/ZERO-COST: Claw + All for One + Scrape. Zero-cost spam that scales Claw damage per play. Fast and consistent.
2. FROST/FOCUS: Stack Focus (Defragment, Consume, Biased Cognition) + Frost orbs for passive block. Glacier, Coolheaded, Blizzard.
3. LIGHTNING: Electrodynamics + Storm + Tempest for AoE. Thunder Strike for boss finisher.

S-tier cards: Defragment, Glacier, Biased Cognition, Electrodynamics, All for One, Echo Form.
Key principle: Focus is the most important stat. Defragment is always a strong pick. Orb slots matter.`,

  "the regent": `Regent archetypes:
1. STAR ENGINE (dominant high-ascension): Accumulate Stars (persist between turns, no cap). Sovereign Blade gains permanent damage through Forging. Star generation + Forge cards.
2. STANCE: Shift between Calm and Wrath for energy bursts. Wrath doubles damage but also incoming — requires careful timing.
3. RETAIN: Keep key cards across turns for setup into explosive turns.

S-tier cards: Deva Form, Vault, Blasphemy (risky), Ragnarok, Brilliance.
Key principle: Regent rewards patience but slow setups get punished in Act 2. Build star generation early.`,

  "the necrobinder": `Necrobinder archetypes:
1. OSTY TANK: Osty absorbs all unblocked damage — extra HP bar. Summon cards keep Osty alive. Build around sustained Osty uptime.
2. DOOM EXECUTE: Doom executes enemies below threshold. Chip damage to trigger on high-HP enemies.
3. SOUL CYCLING: Soul generation + draw creates near-infinite engines. Highest damage ceiling in the game.

S-tier cards: Doom, Soul Siphon, Dark Pact, Bone Barrier, Animate.
Key principle: Osty is your biggest advantage — invest in Summon. Necrobinder has highest damage ceiling but is vulnerable when Osty dies.`,
};

/**
 * Get the strategy guide for the current character.
 * Returns null if character not recognized.
 */
export function getCharacterStrategy(character: string): string | null {
  const key = character.toLowerCase().trim();
  return STRATEGIES[key] ?? null;
}
