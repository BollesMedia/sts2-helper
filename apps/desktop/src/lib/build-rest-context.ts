export interface RestContextInput {
  hp: number;
  maxHp: number;
  floorsToNextBoss: number;
  hasEliteAhead: boolean;
  hasBossAhead: boolean;
  hasRestAhead: boolean;
  relicDescriptions: string[];
  upgradeCandidates: string[];
}

export interface RestContext {
  hpPercent: number;
  missing: number;
  missingPercent: number;
  passiveHealPerCombat: number;
  effectivePassiveHeal: number;
  effectiveMissing: number;
  effectiveHpPercent: number;
  isBossNext: boolean;
  isBossSoon: boolean;
  hasEliteAhead: boolean;
  hasRestAhead: boolean;
  upgradeNote: string;
}

/**
 * Pure function that computes all derived rest site evaluation context.
 * Determines passive healing, effective HP, boss proximity, and upgrade notes.
 */
export function buildRestContext(input: RestContextInput): RestContext {
  const {
    hp,
    maxHp,
    floorsToNextBoss,
    hasEliteAhead,
    hasBossAhead,
    hasRestAhead,
    relicDescriptions,
    upgradeCandidates,
  } = input;

  const hpPercent = maxHp > 0 ? hp / maxHp : 1;
  const missing = maxHp - hp;
  const missingPercent = Math.round((missing / Math.max(1, maxHp)) * 100);

  // Compute passive healing from relic descriptions
  let passiveHealPerCombat = 0;
  for (const desc of relicDescriptions) {
    const lower = desc.toLowerCase();
    const healMatch = lower.match(
      /(?:end of combat|after combat|heal)\D*(\d+)\s*hp/
    );
    if (healMatch) passiveHealPerCombat += parseInt(healMatch[1], 10);
    if (lower.includes("meat on the bone")) passiveHealPerCombat += 6;
  }

  const isBossNext = floorsToNextBoss <= 1 || hasBossAhead;
  const isBossSoon = floorsToNextBoss <= 3 || hasBossAhead;

  // Boss is next floor → no combats before boss → passive healing irrelevant
  const effectivePassiveHeal = isBossNext ? 0 : passiveHealPerCombat;
  const effectiveMissing = Math.max(0, missing - effectivePassiveHeal);
  const effectiveHpPercent = Math.round(
    ((maxHp - effectiveMissing) / Math.max(1, maxHp)) * 100
  );

  // Upgrade note
  const uniqueCandidates = [...new Set(upgradeCandidates)];
  const upgradeNote =
    uniqueCandidates.length > 0
      ? `UPGRADEABLE (only these can be upgraded): ${uniqueCandidates.join(", ")}\nCards with + are ALREADY upgraded and CANNOT be upgraded again. Do NOT recommend upgrading any card with + in its name.`
      : "No upgradeable cards remaining — all cards have been upgraded.";

  return {
    hpPercent,
    missing,
    missingPercent,
    passiveHealPerCombat,
    effectivePassiveHeal,
    effectiveMissing,
    effectiveHpPercent,
    isBossNext,
    isBossSoon,
    hasEliteAhead: hasEliteAhead && !isBossNext,
    hasRestAhead,
    upgradeNote,
  };
}

/**
 * Build the rest site prompt section from computed context.
 */
export function buildRestPromptSection(ctx: RestContext, hp: number, maxHp: number): string {
  const lines: string[] = [];

  lines.push(
    `HP: ${hp}/${maxHp} (${Math.round((hp / Math.max(1, maxHp)) * 100)}%) | Missing: ${ctx.missing} HP | Rest heals: ${Math.min(ctx.missing, Math.floor(maxHp * 0.3))} HP (capped at missing)`
  );

  if (ctx.isBossNext) {
    lines.push(
      `⚠ BOSS IS NEXT FLOOR. Passive healing will NOT apply. Current HP is your boss HP.`
    );
  } else {
    lines.push(
      `Passive healing per combat: ${ctx.passiveHealPerCombat} HP | Effective missing: ${ctx.effectiveMissing} | Effective HP: ${ctx.effectiveHpPercent}%`
    );
  }

  if (ctx.hasEliteAhead) {
    lines.push(
      `⚠ ELITE FIGHT AHEAD on the current path. Factor elite damage (~20-30 HP) into heal decision.`
    );
  }

  if (!ctx.isBossNext && ctx.isBossSoon) {
    lines.push(`Boss in ${Math.max(1, Math.round(ctx.effectiveMissing > 0 ? ctx.effectiveMissing / ctx.passiveHealPerCombat || 99 : 99))} floors... Boss is soon.`);
  }

  if (!ctx.hasRestAhead && !ctx.isBossNext) {
    lines.push(
      `No rest site ahead before boss — this is the last chance to heal.`
    );
  }

  lines.push(ctx.upgradeNote);

  lines.push(
    `\nCONTEXT: Missing ${ctx.missingPercent}% HP. Effective HP after passive healing: ${ctx.effectiveHpPercent}%. Consider whether upgrading a key card provides more long-term value than healing chip damage.`
  );

  return lines.join("\n");
}
