"use client";

import { createClient } from "./client";

/**
 * Get the current user ID from the active session.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

/**
 * Sign in with magic link (passwordless email).
 */
export async function signInWithEmail(
  email: string
): Promise<{ error: string | null }> {
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${window.location.origin}/auth/callback`,
    },
  });
  return { error: error?.message ?? null };
}

/**
 * Sign out the current user.
 */
export async function signOut(): Promise<void> {
  const supabase = createClient();
  await supabase.auth.signOut();
}
