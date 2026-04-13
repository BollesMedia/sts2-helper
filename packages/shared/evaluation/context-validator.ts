import type { EvaluationContext } from "./types";

export interface ContextIssue {
  field: string;
  severity: "error" | "warning";
  message: string;
  actual: unknown;
}

export interface ContextValidationResult {
  errors: ContextIssue[];
  warnings: ContextIssue[];
  /** True if no errors (warnings are OK to proceed) */
  isValid: boolean;
}

/**
 * Validate an EvaluationContext for missing or inconsistent data.
 * Returns structured issues so callers can log and gate evaluations.
 *
 * Errors = critical missing data, evaluation should NOT proceed.
 * Warnings = suspicious data, evaluation proceeds but logged for debugging.
 */
export function validateEvaluationContext(
  ctx: EvaluationContext
): ContextValidationResult {
  const errors: ContextIssue[] = [];
  const warnings: ContextIssue[] = [];

  // --- Errors (block evaluation) ---

  // Deck empty past early game — downgrade to warning so evals can still
  // run on resume (deck only populates from combat states). Less accurate
  // but better than no evaluation at all.
  if (ctx.deckSize === 0 && ctx.floor > 2) {
    warnings.push({
      field: "deckSize",
      severity: "warning",
      message: "Deck is empty past early game — deck data not yet populated (awaiting combat). Eval will run without deck context.",
      actual: ctx.deckSize,
    });
  }

  if (ctx.deckCards.length !== ctx.deckSize) {
    warnings.push({
      field: "deckCards",
      severity: "warning",
      message: `deckCards length (${ctx.deckCards.length}) does not match deckSize (${ctx.deckSize})`,
      actual: ctx.deckCards.length,
    });
  }

  if (ctx.character === "unknown" || ctx.character === "") {
    errors.push({
      field: "character",
      severity: "error",
      message: "Character is unknown — player data was not populated",
      actual: ctx.character,
    });
  }

  if (ctx.hpPercent === 0) {
    warnings.push({
      field: "hpPercent",
      severity: "warning",
      message: "HP is 0% — player data may not be populated yet. Eval will proceed with limited context.",
      actual: ctx.hpPercent,
    });
  }

  // --- Warnings (log but proceed) ---

  if (ctx.deckSize > 0 && ctx.deckSize < 8 && ctx.floor > 5) {
    warnings.push({
      field: "deckSize",
      severity: "warning",
      message: "Deck is suspiciously small for this floor",
      actual: ctx.deckSize,
    });
  }

  if (ctx.relics.length === 0 && ctx.act >= 2) {
    warnings.push({
      field: "relics",
      severity: "warning",
      message: "No relics in Act 2+ — player data may be incomplete",
      actual: ctx.relics.length,
    });
  }

  if (ctx.hpPercent > 1) {
    warnings.push({
      field: "hpPercent",
      severity: "warning",
      message: "HP exceeds 100% — data integrity issue",
      actual: ctx.hpPercent,
    });
  }

  const emptyNameCards = ctx.deckCards.filter((c) => c.name === "");
  if (emptyNameCards.length > 0) {
    warnings.push({
      field: "deckCards",
      severity: "warning",
      message: `${emptyNameCards.length} card(s) with empty name`,
      actual: emptyNameCards.length,
    });
  }

  return {
    errors,
    warnings,
    isValid: errors.length === 0,
  };
}
