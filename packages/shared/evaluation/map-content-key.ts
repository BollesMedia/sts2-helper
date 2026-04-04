/**
 * Compute a content-based key for map state.
 *
 * Includes state_type, position, and sorted options so the key is stable
 * across polls with identical content but different object references.
 */
export function computeMapContentKey(
  stateType: string,
  position: { col: number; row: number } | null,
  options: readonly { col: number; row: number }[]
): string {
  const pos = position ? `${position.col},${position.row}` : "null";
  const opts = options.map((o) => `${o.col},${o.row}`).sort().join("|");
  return `${stateType}:${pos}:${opts}`;
}
