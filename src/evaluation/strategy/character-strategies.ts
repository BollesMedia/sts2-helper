/**
 * Curated character strategy guides for STS2.
 * Sourced from community tier lists and high-ascension play patterns.
 * Keep each entry under ~150 tokens for prompt efficiency.
 */

const STRATEGIES: Record<string, string> = {
  "the ironclad": `Ironclad archetypes (pick one, don't mix):
1. EXHAUST ENGINE (strongest): Corruption + Dark Embrace + Feel No Pain. Skills become free, exhaust generates block and draw. Add Burning Pact, Offering, Sentinel.
2. STRENGTH SCALING: Demon Form or Rupture + self-damage cards (Offering, Bloodletting). Payoff with multi-hit attacks (Twin Strike, Sword Boomerang) and Heavy Blade.
3. BODY SLAM: Stack block with Barricade + Entrench + Shrug It Off, then deal damage equal to block with Body Slam.

S-tier cards: Offering (always take), Feed (always take early), Corruption, Demon Form, Feel No Pain, Dark Embrace, Barricade.
Key principle: Draft damage/block for Act 1 survival first, then layer engine pieces in Acts 2-3. Offering is the single best card — take it every time.`,

  "the silent": `Silent archetypes:
1. SLY DISCARD (highest damage ceiling): Build around Sly keyword — discarded Sly cards play for free. Combine with Calculated Gamble, Acrobatics, Tactician for explosive turns.
2. POISON: Noxious Fumes + Catalyst for scaling. Bouncing Flask, Deadly Poison for application. Corpse Explosion for AoE. Patient strategy — stall and let poison tick.
3. SHIV: Blade Dance, Cloak and Dagger, Infinite Blades + Accuracy/Shuriken/Kunai. Fast damage but needs defensive support.

S-tier cards: Wraith Form, After Image, Adrenaline, Catalyst, Noxious Fumes, Bouncing Flask.
Key principle: Silent is fragile — Wraith Form and After Image are critical defensive cards. Prioritize draw and energy over raw damage.`,

  "the defect": `Defect archetypes:
1. CLAW/ZERO-COST: Claw + All for One + Scrape + Beam Cell. Zero-cost spam that scales Claw damage per play. Fast and consistent.
2. FROST/FOCUS: Stack Focus (Defragment, Consume, Biased Cognition) + Frost orbs for massive passive block. Glacier, Coolheaded, Blizzard.
3. LIGHTNING: Electrodynamics + Storm + Tempest for AoE lightning damage. Thunder Strike for boss finisher.
4. DARK ORB: Doom and Gloom + Darkness for scaling dark orb damage. Niche but powerful.

S-tier cards: Defragment, Glacier, Biased Cognition, Electrodynamics, All for One, Echo Form.
Key principle: Focus is the most important stat. Defragment is always a strong pick. Orb slots matter — Inserter and Capacitor are valuable.`,

  "the regent": `Regent archetypes:
1. STAR ENGINE (dominant): Accumulate Stars (persist between turns, no cap). Sovereign Blade gains permanent damage through Forging. Star generation + Forge cards.
2. STANCE: Shift between Calm and Wrath for energy bursts. Wrath doubles damage but also incoming damage — requires careful timing.
3. RETAIN: Keep key cards across turns. Combine with Star buildup for explosive turns after setup.

S-tier cards: Deva Form, Vault, Blasphemy (risky but powerful), Ragnarok, Brilliance.
Key principle: Regent rewards patience but gets punished by slow setups in Act 2. Build star generation early, don't rely on Forging alone.`,

  "the necrobinder": `Necrobinder archetypes:
1. OSTY TANK: Osty absorbs all unblocked damage — essentially an extra HP bar. Summon cards keep Osty alive. Build around keeping Osty up while dealing damage.
2. DOOM EXECUTE: Doom executes enemies below a threshold. Combine with chip damage to trigger executes on high-HP enemies.
3. SOUL CYCLING: Soul generation + draw creates near-infinite engines. Highest damage ceiling in the game.

S-tier cards: Doom, Soul Siphon, Dark Pact, Bone Barrier, Animate.
Key principle: Osty is your biggest advantage — invest in Summon cards to keep it alive. Necrobinder has the highest damage ceiling but is vulnerable when Osty dies.`,
};

/**
 * Get the strategy guide for the current character.
 * Returns null if character not recognized.
 */
export function getCharacterStrategy(character: string): string | null {
  const key = character.toLowerCase().trim();
  return STRATEGIES[key] ?? null;
}
