import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/api-auth";

export async function POST(request: Request) {
  // Require auth — don't allow anonymous inserts
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = await request.json();
  const { source, level, message, context, app_version, platform } = body;

  if (!source || !message) {
    return NextResponse.json({ error: "source and message required" }, { status: 400 });
  }

  // Sanitize context: cap at 50KB to prevent abuse
  let safeContext = null;
  if (context) {
    const contextStr = JSON.stringify(context);
    safeContext = contextStr.length < 50000 ? context : { truncated: true, originalSize: contextStr.length };
  }

  const supabase = createServiceClient();

  // error_logs table not in generated types yet — bypass
  await (supabase as unknown as { from: (t: string) => { insert: (r: Record<string, unknown>) => Promise<unknown> } }).from("error_logs").insert({
    user_id: auth.userId,
    source: String(source).slice(0, 50),
    level: String(level ?? "error").slice(0, 10),
    message: String(message).slice(0, 5000),
    context: safeContext,
    app_version: app_version ? String(app_version).slice(0, 20) : null,
    platform: platform ? String(platform).slice(0, 20) : null,
  });

  return NextResponse.json({ ok: true });
}
