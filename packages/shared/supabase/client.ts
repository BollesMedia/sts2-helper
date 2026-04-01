import { createBrowserClient } from "@supabase/ssr";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types";

export type StorageMode = "cookies" | "localStorage";

/**
 * Configurable Supabase credentials.
 * Each app MUST call initSupabase() on startup with its own env vars.
 */
let supabaseUrl = "";
let supabaseAnonKey = "";
let storageMode: StorageMode = "cookies";

export function initSupabase(url: string, anonKey: string, mode: StorageMode = "cookies") {
  supabaseUrl = url;
  supabaseAnonKey = anonKey;
  storageMode = mode;
  cachedClient = null;
}

let cachedClient: SupabaseClient<Database> | null = null;

export function createClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Supabase not initialized. Call initSupabase(url, anonKey) before using the Supabase client."
    );
  }
  if (!cachedClient) {
    cachedClient = storageMode === "localStorage"
      ? createSupabaseClient<Database>(supabaseUrl, supabaseAnonKey)
      : createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
  }
  return cachedClient;
}
