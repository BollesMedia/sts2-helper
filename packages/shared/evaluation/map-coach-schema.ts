import { z } from "zod";

/**
 * Server output schema for map pathing coach evals. snake_case on the wire to
 * match Claude's output; camelCase conversion lives in the desktop adapter.
 *
 * The `.max(N)` caps on key_branches and teaching_callouts are enforced
 * schema-level because low-value padding is a specific failure mode we need
 * to reject hard. If Anthropic's structured-output endpoint rejects these
 * (it has in the past for the `rankings` array — see eval-schemas.ts
 * header), relax to `.describe()` prompt-level enforcement and filter in
 * the route handler.
 */

const nodeTypeEnum = z.enum([
  "monster",
  "elite",
  "rest",
  "shop",
  "treasure",
  "event",
  "unknown",
]);

export const mapCoachOutputSchema = z.object({
  reasoning: z.object({
    risk_capacity: z.string().min(1),
    act_goal: z.string().min(1),
  }),
  headline: z.string().min(1),
  confidence: z.number().min(0).max(1),
  macro_path: z.object({
    floors: z.array(
      z.object({
        floor: z.number(),
        node_type: nodeTypeEnum,
        node_id: z.string(),
      }),
    ),
    summary: z.string().min(1),
  }),
  key_branches: z
    .array(
      z.object({
        floor: z.number(),
        decision: z.string(),
        recommended: z.string(),
        alternatives: z.array(
          z.object({
            option: z.string(),
            tradeoff: z.string(),
          }),
        ),
        close_call: z.boolean(),
      }),
    )
    .max(3),
  teaching_callouts: z
    .array(
      z.object({
        pattern: z.string(),
        floors: z.array(z.number()),
        explanation: z.string(),
      }),
    )
    .max(4),
});

export type MapCoachOutputRaw = z.infer<typeof mapCoachOutputSchema>;
