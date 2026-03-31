import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api-auth";

const choiceSchema = z.object({
  runId: z.string().nullable().optional(),
  choiceType: z.string().min(1),
  floor: z.number().int().min(0).optional(),
  act: z.number().int().min(1).optional(),
  offeredItemIds: z.array(z.string()),
  chosenItemId: z.string().nullable().optional(),
  recommendedItemId: z.string().nullable().optional(),
  recommendedTier: z.string().nullable().optional(),
  wasFollowed: z.boolean().nullable().optional(),
  rankingsSnapshot: z.unknown().nullable().optional(),
});

export async function POST(request: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = await request.json();
  const result = choiceSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Invalid request", detail: result.error.flatten() },
      { status: 400 }
    );
  }

  const d = result.data;
  const supabase = createServiceClient();

  const { error } = await supabase.from("choices").insert({
    run_id: d.runId ?? null,
    choice_type: d.choiceType,
    floor: d.floor ?? 0,
    act: d.act ?? 1,
    offered_item_ids: d.offeredItemIds,
    chosen_item_id: d.chosenItemId ?? null,
    user_id: auth.userId,
    recommended_item_id: d.recommendedItemId ?? null,
    recommended_tier: d.recommendedTier ?? null,
    was_followed: d.wasFollowed ?? null,
    rankings_snapshot: d.rankingsSnapshot ?? null,
  });

  if (error) {
    console.error("Failed to log choice:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
