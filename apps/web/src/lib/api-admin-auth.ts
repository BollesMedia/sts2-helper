import { createServiceClient } from "./supabase/server";
import { requireAuth, type RouteHandler } from "./api-auth";
import { NextResponse } from "next/server";

/**
 * Validates auth AND checks the user has role='admin' in profiles table.
 * Returns { userId } on success, or { error } with appropriate status response.
 */
export async function requireAdmin(): Promise<
  { userId: string } | { error: NextResponse }
> {
  const auth = await requireAuth();
  if ("error" in auth) return auth;

  const supabase = createServiceClient();
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

/**
 * Wrap a route handler so it only runs when the request is authenticated AND
 * the user has role='admin'. On failure the wrapped handler returns the 401
 * or 403 NextResponse directly.
 */
export function withAdmin<TArgs extends unknown[], TRes>(
  handler: RouteHandler<TArgs, TRes>,
): (req: Request, ...args: TArgs) => Promise<TRes | NextResponse> {
  return async (req, ...args) => {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;
    return handler(req, { userId: auth.userId }, ...args);
  };
}
