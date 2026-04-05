import type { MapNodeOutcome, DetectMapNodeInput } from "./types";

/**
 * Detect whether the player moved to a new map node and whether
 * that move aligned with the recommendation.
 *
 * Returns null if no move occurred (position unchanged or no previous position).
 */
export function detectMapNodeOutcome(
  input: DetectMapNodeInput
): MapNodeOutcome | null {
  const { previousPosition, currentPosition, recommendedNextNode, nextOptions } = input;

  if (!previousPosition) return null;
  if (
    previousPosition.col === currentPosition.col &&
    previousPosition.row === currentPosition.row
  ) {
    return null;
  }

  const matchedOption = nextOptions.find(
    (o) => o.col === currentPosition.col && o.row === currentPosition.row
  );
  const chosenNode = matchedOption ?? {
    col: currentPosition.col,
    row: currentPosition.row,
    nodeType: "unknown",
  };

  const wasFollowed = recommendedNextNode
    ? recommendedNextNode.col === currentPosition.col &&
      recommendedNextNode.row === currentPosition.row
    : false;

  return {
    chosenNode,
    recommendedNode: recommendedNextNode,
    allOptions: nextOptions,
    wasFollowed,
  };
}
