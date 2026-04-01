import { setApiBaseUrl, setAccessTokenGetter, setFetchImplementation } from "./api-client";
import { initSupabase, type StorageMode } from "../supabase/client";
import { setAuthRedirectOrigin } from "../supabase/auth";

interface SharedConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiBaseUrl: string;
  authRedirectOrigin?: string;
  accessTokenGetter?: () => Promise<string | null>;
  fetchImplementation?: typeof globalThis.fetch;
  /** Desktop uses "localStorage" (cookies broken on tauri://), web defaults to "cookies" */
  storageMode?: StorageMode;
}

export function initSharedConfig(config: SharedConfig) {
  initSupabase(config.supabaseUrl, config.supabaseAnonKey, config.storageMode);
  setApiBaseUrl(config.apiBaseUrl);
  if (config.authRedirectOrigin) {
    setAuthRedirectOrigin(config.authRedirectOrigin);
  }
  if (config.accessTokenGetter) {
    setAccessTokenGetter(config.accessTokenGetter);
  }
  if (config.fetchImplementation) {
    setFetchImplementation(config.fetchImplementation);
  }
}
