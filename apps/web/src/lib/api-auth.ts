import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { Database } from "@sts2/shared/types/database.types";

/**
 * Validates the Supabase auth session from the request cookies.
 * Returns the user ID if authenticated, or a 401 response if not.
 *
 * In development, returns a placeholder user ID to allow testing
 * without authentication.
 */
export async function requireAuth(): Promise<
  { userId: string } | { error: NextResponse }
> {
  if (process.env.NODE_ENV === "development") {
    return { userId: "dev-user" };
  }

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
