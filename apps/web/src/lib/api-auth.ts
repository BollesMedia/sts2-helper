import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import type { Database } from "@sts2/shared/types/database.types";

/**
 * Validates auth from either:
 * 1. Bearer token in Authorization header (desktop app)
 * 2. Supabase session cookies (web app)
 *
 * Returns the user ID if authenticated, or a 401 response if not.
 */
export async function requireAuth(): Promise<
  { userId: string } | { error: NextResponse }
> {
  // Check for Bearer token first (desktop app sends this)
  const headerStore = await headers();
  const authHeader = headerStore.get("authorization");

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);

    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data, error: authError } = await supabase.auth.getUser(token);

    if (data?.user) {
      return { userId: data.user.id };
    }

    console.error("[Auth] Bearer token rejected:", authError?.message ?? "no user returned");

    return {
      error: NextResponse.json(
        { error: "Invalid token" },
        { status: 401 }
      ),
    };
  }

  // Fall back to cookie-based auth (web app)
  const cookieStore = await cookies();
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      ),
    };
  }

  return { userId: user.id };
}
