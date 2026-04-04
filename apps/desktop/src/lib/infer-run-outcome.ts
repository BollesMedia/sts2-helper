export interface RunOutcomeInput {
  /** Current game state type */
  currentStateType: string;
  /** Whether the last combat was a boss fight */
  lastWasBoss: boolean;
  /** Whether all enemies were dead in the last combat */
  lastEnemiesAllDead: boolean;
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
 *
 * Defeat is detected from:
 * 3. Overlay with NGameOverScreen (the mod's death screen)
 */
export function inferRunOutcome(input: RunOutcomeInput): RunOutcome {
  const {
    currentStateType,
    lastWasBoss,
    lastEnemiesAllDead,
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

  // Boss combat → combat_rewards with all enemies dead = victory
  if (
    currentStateType === "combat_rewards" &&
    lastWasBoss &&
    lastEnemiesAllDead
  ) {
    return "victory";
  }

  // Boss combat with all enemies dead (direct check)
  if (lastWasBoss && lastEnemiesAllDead) return "victory";

  return null;
}
