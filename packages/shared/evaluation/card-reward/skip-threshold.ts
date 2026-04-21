import type { ModifierBreakdown } from "./modifier-stack";

export const SKIP_THRESHOLDS = {
  1: 4, // B or better
  2: 5, // A or better
  3: 5, // A or better OR keystone for committed
} as const;

export interface SkipDecision {
  skip: boolean;
  reason: string | null;
}

function hasKeystoneForCommitted(breakdowns: ModifierBreakdown[]): boolean {
  return breakdowns.some((b) =>
    b.modifiers.some(
      (m) => m.kind === "keystoneOverride" && m.reason.startsWith("keystone for "),
    ),
  );
}

export function shouldSkipAll(
  breakdowns: ModifierBreakdown[],
  act: 1 | 2 | 3,
): SkipDecision {
  if (breakdowns.length === 0) return { skip: false, reason: null };

  const threshold = SKIP_THRESHOLDS[act];
  const anyClears = breakdowns.some((b) => b.tierValue >= threshold);
  if (anyClears) return { skip: false, reason: null };

  if (act === 3 && hasKeystoneForCommitted(breakdowns)) {
    return { skip: false, reason: null };
  }

  const tierLabel = threshold === 4 ? "B" : "A";
  return {
    skip: true,
    reason: `Act ${act}: no offer cleared the ${tierLabel}-tier threshold`,
  };
}
