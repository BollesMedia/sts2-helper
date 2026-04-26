import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Regression test for PR #95 / #77.
 *
 * `lastMapRunState.set(runId, mapRunState)` MUST run BEFORE the early-return
 * gates inside the `setupMapEvalListener` effect. Previously, those gates
 * (deck-content-key / position fingerprint / forced-row equality) returned
 * early WITHOUT updating the cache, so the next eval cycle compared against a
 * stale `mapRunState` and could fire spurious re-evals.
 *
 * If a future refactor moves the eager `set()` back below any of the gates,
 * existing assertions don't catch it — the cache value is the same on the
 * stable-state path, so behavioral assertions on the cached value succeed
 * either way. The only observable difference is when the cache is COLD on
 * first listener fire and the gate would short-circuit before populating it.
 *
 * This test pins the source-order invariant directly: it parses
 * `mapListeners.ts` and asserts that the eager-set call line precedes every
 * gate `return` line inside the listener effect. The failure message points
 * at the exact gate that regressed, parameterized over the three gate
 * conditions described in the issue.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SOURCE_PATH = resolve(__dirname, "../mapListeners.ts");

interface GateMarker {
  /** Human-readable gate name shown on test failure */
  name: string;
  /** Substring that uniquely identifies the gate's `return` line */
  needle: string;
  /** Description of WHY this gate exists, surfaced on failure */
  short_circuits_when: string;
}

/**
 * The three early-return gates inside the listener effect that the eager
 * `lastMapRunState.set(...)` must precede. Names mirror the issue body:
 * "deck-content-key, position fingerprint, forced-row equality."
 */
const GATES: readonly GateMarker[] = [
  {
    name: "shouldEvaluateMap (forced-row eq / position fingerprint)",
    needle: "if (!shouldEval) return;",
    short_circuits_when:
      "single-option row, stable subgraph fingerprint, or unhealed act-start",
  },
  {
    name: "narrator on-track (player still following plan)",
    needle: "if (onTrack) {",
    short_circuits_when:
      "winner path's first node is in previously-narrated path",
  },
  {
    name: "evalKey dedup (deck-content-key)",
    needle: "if (!isRetry && currentKey === evalKey) return;",
    short_circuits_when: "computed evalKey matches the last-dispatched evalKey",
  },
] as const;

const EAGER_SET_NEEDLE = "lastMapRunState.set(activeRunIdForEagerCache,";

function findLineNumber(source: string, needle: string): number {
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(needle)) return i + 1; // 1-indexed
  }
  return -1;
}

describe("mapListeners eager run-state cache (#77 / PR #95 invariant)", () => {
  const source = readFileSync(SOURCE_PATH, "utf-8");
  const eagerSetLine = findLineNumber(source, EAGER_SET_NEEDLE);

  it("eager lastMapRunState.set call exists in the listener source", () => {
    // Guard: if the call's identifier ever changes, this test must be updated
    // along with the production code rather than silently skipped.
    expect(
      eagerSetLine,
      `Could not find the eager cache write \`${EAGER_SET_NEEDLE}\` in ${SOURCE_PATH}. ` +
        `If the call was renamed, update EAGER_SET_NEEDLE in this test to match the new identifier.`,
    ).toBeGreaterThan(0);
  });

  it.each(GATES)(
    "eager_cache_update_persists_across_gate_short_circuits — eager set precedes gate: $name",
    ({ name, needle, short_circuits_when }) => {
      const gateLine = findLineNumber(source, needle);
      expect(
        gateLine,
        `Could not find gate \`${needle}\` for "${name}" in ${SOURCE_PATH}. ` +
          `If the gate was rewritten, update GATES in this test.`,
      ).toBeGreaterThan(0);

      expect(
        eagerSetLine,
        `REGRESSION: \`lastMapRunState.set(...)\` (line ${eagerSetLine}) must appear BEFORE ` +
          `the "${name}" gate (line ${gateLine}) which short-circuits when ${short_circuits_when}. ` +
          `Moving the cache write below this gate means a cold cache + gate-skipped eval cycle ` +
          `leaves \`runStateSnapshot\` null on the next \`/api/choice\` write — the bug PR #95 fixed.`,
      ).toBeLessThan(gateLine);
    },
  );
});
