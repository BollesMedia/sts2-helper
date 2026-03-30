"use client";

import { createClient } from "./client";

/**
 * Configurable auth redirect origin.
 * Web app uses window.location.origin (default).
 * Tauri app sets this to "https://sts2replay.com" so OAuth
 * redirects through the web app.
 */
let authRedirectOrigin = "";

export function setAuthRedirectOrigin(origin: string) {
  authRedirectOrigin = origin;
}

function getRedirectUrl(path: string): string {
  const origin = authRedirectOrigin || window.location.origin;
  return `${origin}${path}`;
}

export async function getCurrentUserId(): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

export async function signInWithMagicLink(
  email: string
): Promise<{ error: string | null }> {
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: getRedirectUrl("/auth/callback"),
    },
  });
  return { error: error?.message ?? null };
}

export async function signInWithPassword(
  email: string,
  password: string
): Promise<{ error: string | null }> {
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  return { error: error?.message ?? null };
}

export async function signUpWithPassword(
  email: string,
  password: string
): Promise<{ error: string | null }> {
  const supabase = createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: getRedirectUrl("/auth/callback"),
    },
  });
  return { error: error?.message ?? null };
}

export async function signInWithDiscord(): Promise<{ error: string | null }> {
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: {
      redirectTo: getRedirectUrl("/auth/callback"),
    },
  });
  return { error: error?.message ?? null };
}

export async function signOut(): Promise<void> {
  const supabase = createClient();
  await supabase.auth.signOut();
}
