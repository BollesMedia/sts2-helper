import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api-auth";

const startSchema = z.object({
  action: z.literal("start"),
  runId: z.string().min(1),
  character: z.string().min(1),
  ascension: z.number().int().min(0).optional(),
  gameVersion: z.string().nullable().optional(),
  gameMode: z.enum(["singleplayer", "multiplayer"]).optional(),
  runIdSource: z.enum(["save_file", "client_fallback"]).nullable().optional(),
});

const endSchema = z.object({
  action: z.literal("end"),
  runId: z.string().min(1),
  victory: z.boolean().nullable().optional(),
  finalFloor: z.number().int().nullable().optional(),
  notes: z.string().nullable().optional(),
  bossesFought: z.array(z.string()).nullable().optional(),
  finalDeck: z.array(z.string()).nullable().optional(),
  finalRelics: z.array(z.string()).nullable().optional(),
  finalDeckSize: z.number().int().nullable().optional(),
  actReached: z.number().int().nullable().optional(),
  causeOfDeath: z.string().nullable().optional(),
  narrative: z.unknown().nullable().optional(),
  runIdSource: z.enum(["save_file", "client_fallback"]).nullable().optional(),
});

export async function POST(request: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = await request.json();
  const supabase = createServiceClient();

  if (body.action === "start") {
    const result = startSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid request", detail: result.error.flatten() },
        { status: 400 }
      );
    }

    const d = result.data;
    // Conflict target must be `run_id` — Supabase's default upsert conflict
    // is the primary key, which is always a fresh auto-gen id here. Save-file
    // canonical runIds (#90) are stable across app restarts, so a second
    // "start" for the same run must update in place, not collide.
    const { error } = await supabase
      .from("runs")
      .upsert(
        {
          run_id: d.runId,
          character: d.character,
          ascension_level: d.ascension ?? 0,
          game_version: d.gameVersion ?? null,
          game_mode: d.gameMode ?? "singleplayer",
          user_id: auth.userId,
          run_id_source: d.runIdSource ?? null,
        },
        { onConflict: "run_id" },
      );

    if (error) {
      console.error("Failed to create run:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, runId: d.runId });
  }

  if (body.action === "end") {
    const result = endSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid request", detail: result.error.flatten() },
        { status: 400 }
      );
    }

    const d = result.data;
    const update: Record<string, unknown> = {
      ended_at: new Date().toISOString(),
    };
    if (d.victory !== undefined) update.victory = d.victory;
    if (d.finalFloor !== undefined) update.final_floor = d.finalFloor;
    if (d.notes !== undefined) update.notes = d.notes;
    if (d.bossesFought !== undefined) update.bosses_fought = d.bossesFought;
    if (d.finalDeck !== undefined) update.final_deck = d.finalDeck;
    if (d.finalRelics !== undefined) update.final_relics = d.finalRelics;
    if (d.finalDeckSize !== undefined) update.final_deck_size = d.finalDeckSize;
    if (d.actReached !== undefined) update.act_reached = d.actReached;
    if (d.causeOfDeath !== undefined) update.cause_of_death = d.causeOfDeath;
    if (d.narrative !== undefined) update.narrative = d.narrative;
    if (d.runIdSource !== undefined) update.run_id_source = d.runIdSource;

    const { error } = await supabase
      .from("runs")
      .update(update)
      .eq("run_id", d.runId);

    if (error) {
      console.error("Failed to end run:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
