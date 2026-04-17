import { createServiceClient } from "./supabase/server";
import { requireAuth } from "./api-auth";
import { NextResponse } from "next/server";

/**
 * Validates auth AND checks the user has role='admin' in profiles table.
 * Returns { userId } on success, or { error } with appropriate status response.
 *
 * NOTE: The `profiles` table is not yet reflected in the generated database
 * types (migration 018 post-dates the last type gen run). Using `any` cast
 * on the client to bypass the type-level table restriction until types are
 * regenerated.
 */
export async function requireAdmin(): Promise<
  { userId: string } | { error: NextResponse }
> {
  const auth = await requireAuth();
  if ("error" in auth) return auth;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceClient() as any;
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.userId)
    .single();

  if (error || !data || data.role !== "admin") {
    return {
      error: NextResponse.json(
        { error: "Admin access required" },
        { status: 403 },
      ),
    };
  }

  return { userId: auth.userId };
}
