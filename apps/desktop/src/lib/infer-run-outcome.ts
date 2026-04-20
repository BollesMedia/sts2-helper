export interface RunOutcomeInput {
  /** Current game state type */
  currentStateType: string;
  /** Whether the last combat was a boss fight */
  lastWasBoss: boolean;
  /** Whether all enemies were dead in the last combat */
  lastEnemiesAllDead: boolean;
  /** Current act number (1-3) */
  lastAct: number;
  /** Event ID if current state is an event, null otherwise */
  eventId: string | null;
  /** Event name if current state is an event, null otherwise */
  eventName: string | null;
  /** Overlay screen type if current state is an overlay, null otherwise */
  overlayScreenType: string | null;
}

export type RunOutcome = "victory" | "defeat" | null;

/**
 * Infer run outcome from game state.
 *
 * Returns "victory" when we're confident the player won.
 * Returns null for all other cases (defeat, quit, unknown).
 *
 * Defeat is NOT auto-detected because revival relics
 * (Fairy in a Bottle, Lizard Tail) can save the player
 * after HP hits 0 — making HP-based detection unreliable.
 *
 * Victory is detected from:
 * 1. Boss combat where all enemies died → combat_rewards transition
 * 2. Architect event (post-final-boss reward screen)
 * 3. Menu transition directly from a cleared Act 3 boss (#74). STS2
 *    sometimes jumps straight from the boss fight to menu, skipping
 *    combat_rewards. Without this branch, confirmed Ascension wins get
 *    stuck on the "Run paused" screen and never post to /api/run.
 *
 * Defeat is detected from:
 * 4. Overlay with NGameOverScreen (the mod's death screen)
 */
export function inferRunOutcome(input: RunOutcomeInput): RunOutcome {
  const {
    currentStateType,
    lastWasBoss,
    lastEnemiesAllDead,
    lastAct,
    eventId,
    eventName,
    overlayScreenType,
  } = input;

  // Game over overlay = defeat
  if (
    currentStateType === "overlay" &&
    overlayScreenType?.includes("GameOver")
  ) {
    return "defeat";
  }

  // Architect event = victory (post-final-boss)
  if (currentStateType === "event") {
    const isArchitect =
      eventId?.toLowerCase().includes("architect") ||
      eventName?.toLowerCase().includes("architect");
    if (isArchitect) return "victory";
  }

  // Final boss combat → combat_rewards with all enemies dead = victory
  if (
    currentStateType === "combat_rewards" &&
    lastWasBoss &&
    lastEnemiesAllDead &&
    lastAct >= 3
  ) {
    return "victory";
  }

  // Menu transition from a cleared Act 3 boss (#74). The last-combat
  // fields still reflect the boss kill at the moment of the menu
  // transition — safe to trust them.
  if (
    currentStateType === "menu" &&
    lastWasBoss &&
    lastEnemiesAllDead &&
    lastAct >= 3
  ) {
    return "victory";
  }

  return null;
}
