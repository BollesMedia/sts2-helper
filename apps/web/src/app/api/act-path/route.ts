import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api-auth";

const actPathSchema = z.object({
  runId: z.string(),
  act: z.number().int().min(1),
  recommendedPath: z.array(z.object({
    col: z.number(),
    row: z.number(),
    nodeType: z.string(),
  })),
  actualPath: z.array(z.object({
    col: z.number(),
    row: z.number(),
    nodeType: z.string(),
  })),
  nodePreferences: z.unknown().nullable().optional(),
  deviationCount: z.number().int().min(0),
  deviationNodes: z.array(z.object({
    col: z.number(),
    row: z.number(),
    recommended: z.string(),
    actual: z.string(),
  })),
  contextAtStart: z.unknown().nullable().optional(),
});

export async function POST(request: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = await request.json();
  const result = actPathSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Invalid request", detail: result.error.flatten() },
      { status: 400 }
    );
  }

  const d = result.data;
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("act_paths")
    .upsert({
      run_id: d.runId,
      act: d.act,
      recommended_path: d.recommendedPath as import("@sts2/shared/types/database.types").Json,
      actual_path: d.actualPath as import("@sts2/shared/types/database.types").Json,
      node_preferences: (d.nodePreferences ?? null) as import("@sts2/shared/types/database.types").Json,
      deviation_count: d.deviationCount,
      deviation_nodes: d.deviationNodes as import("@sts2/shared/types/database.types").Json,
      context_at_start: (d.contextAtStart ?? null) as import("@sts2/shared/types/database.types").Json,
      user_id: auth.userId,
    }, {
      onConflict: "run_id,act",
    });

  if (error) {
    console.error("Failed to log act path:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
