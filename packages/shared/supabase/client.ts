import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "../types/database.types";

/**
 * Configurable Supabase credentials.
 * Each app MUST call initSupabase() on startup with its own env vars.
 */
let supabaseUrl = "";
let supabaseAnonKey = "";

export function initSupabase(url: string, anonKey: string) {
  supabaseUrl = url;
  supabaseAnonKey = anonKey;
}

let cachedClient: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function createClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Supabase not initialized. Call initSupabase(url, anonKey) before using the Supabase client."
    );
  }
  if (!cachedClient) {
    cachedClient = createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
  }
  return cachedClient;
}
