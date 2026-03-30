import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "../types/database.types";

/**
 * Configurable Supabase credentials.
 * Each app calls initSupabase() on startup with its own env vars.
 */
let supabaseUrl = "";
let supabaseAnonKey = "";

export function initSupabase(url: string, anonKey: string) {
  supabaseUrl = url;
  supabaseAnonKey = anonKey;
}

export function createClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    // TODO: Remove this fallback when desktop app is added — both apps
    // should call initSupabase() explicitly on startup
    const url = supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const key = supabaseAnonKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
    if (!url || !key) {
      throw new Error(
        "Supabase not initialized. Call initSupabase(url, anonKey) or set NEXT_PUBLIC_SUPABASE_URL."
      );
    }
    return createBrowserClient<Database>(url, key);
  }
  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
}
