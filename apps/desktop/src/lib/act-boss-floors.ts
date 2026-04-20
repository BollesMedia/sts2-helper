/**
 * Cumulative STS2 act boss floors. `run.floor` is a global counter across
 * the whole run (floor 18 is Act 2 floor 1; floor 35 is Act 3 floor 1).
 * Shared so the two eval pipelines that reason about "how many floors
 * until the next boss" (map context + rest-site fallback) agree.
 */
export const ACT_BOSS_FLOORS = [17, 34, 51] as const;

/**
 * Floors from `currentFloor` to the next upcoming act boss.
 * Returns 0 when on the boss floor itself, and `null` when past floor 51
 * (post-run — no upcoming boss).
 */
export function floorsToNextBossFloor(currentFloor: number): number | null {
  const next = ACT_BOSS_FLOORS.find((bf) => bf >= currentFloor);
  return next != null ? next - currentFloor : null;
}
