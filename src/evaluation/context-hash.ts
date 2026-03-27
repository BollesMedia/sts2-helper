import type { EvaluationContext } from "./types";

function deckSizeBucket(size: number): string {
  if (size <= 15) return "small";
  if (size <= 25) return "medium";
  if (size <= 35) return "large";
  return "xlarge";
}

/**
 * Creates a deterministic hash string for similar-context lookups.
 * Used for tiered matching: exact → broad → broadest.
 */
export function createContextHash(ctx: EvaluationContext): string {
  return [
    ctx.character,
    ctx.primaryArchetype ?? "none",
    `act${ctx.act}`,
    deckSizeBucket(ctx.deckSize),
  ].join(":");
}

/**
 * Creates a broader context hash (ignoring archetype)
 * for fallback lookups.
 */
export function createBroadContextHash(ctx: EvaluationContext): string {
  return [ctx.character, `act${ctx.act}`].join(":");
}
