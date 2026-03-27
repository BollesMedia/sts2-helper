import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const body = await request.json();
  const { action } = body;
  const supabase = createServiceClient();

  if (action === "start") {
    const { runId, character, ascension, gameVersion } = body;

    const { error } = await supabase.from("runs").upsert({
      run_id: runId,
      character,
      ascension_level: ascension ?? 0,
      game_version: gameVersion ?? null,
    });

    if (error) {
      console.error("Failed to create run:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, runId });
  }

  if (action === "end") {
    const { runId, victory, finalFloor } = body;

    const { error } = await supabase
      .from("runs")
      .update({
        ended_at: new Date().toISOString(),
        victory: victory ?? null,
        final_floor: finalFloor ?? null,
      })
      .eq("run_id", runId);

    if (error) {
      console.error("Failed to end run:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
