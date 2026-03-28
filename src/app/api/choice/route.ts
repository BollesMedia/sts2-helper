import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const body = await request.json();
  const { runId, choiceType, floor, act, offeredItemIds, chosenItemId, userId } = body;

  const supabase = createServiceClient();

  const { error } = await supabase.from("choices").insert({
    run_id: runId ?? null,
    choice_type: choiceType,
    floor: floor ?? 0,
    act: act ?? 1,
    offered_item_ids: offeredItemIds,
    chosen_item_id: chosenItemId,
    user_id: userId ?? null,
  });

  if (error) {
    console.error("Failed to log choice:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
