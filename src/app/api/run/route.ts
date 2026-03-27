import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const body = await request.json();
  const { action } = body;
  const supabase = createServiceClient();

  if (action === "start") {
    const { runId, character, ascension, gameVersion, gameMode } = body;

    const { error } = await supabase.from("runs").upsert({
      run_id: runId,
      character,
      ascension_level: ascension ?? 0,
      game_version: gameVersion ?? null,
      game_mode: gameMode ?? "singleplayer",
    });

    if (error) {
      console.error("Failed to create run:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, runId });
  }

  if (action === "end") {
    const {
      runId, victory, finalFloor, notes, bossesFought,
      finalDeck, finalRelics, finalDeckSize, actReached, causeOfDeath,
    } = body;

    const update: Record<string, unknown> = {
      ended_at: new Date().toISOString(),
    };
    if (victory !== undefined) update.victory = victory;
    if (finalFloor !== undefined) update.final_floor = finalFloor;
    if (notes !== undefined) update.notes = notes;
    if (bossesFought !== undefined) update.bosses_fought = bossesFought;
    if (finalDeck !== undefined) update.final_deck = finalDeck;
    if (finalRelics !== undefined) update.final_relics = finalRelics;
    if (finalDeckSize !== undefined) update.final_deck_size = finalDeckSize;
    if (actReached !== undefined) update.act_reached = actReached;
    if (causeOfDeath !== undefined) update.cause_of_death = causeOfDeath;

    const { error } = await supabase
      .from("runs")
      .update(update)
      .eq("run_id", runId);

    if (error) {
      console.error("Failed to end run:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
