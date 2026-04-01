import { setApiBaseUrl, setAccessTokenGetter, setFetchImplementation } from "./api-client";
import { initSupabase } from "../supabase/client";
import { setAuthRedirectOrigin } from "../supabase/auth";

interface SharedConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiBaseUrl: string;
  authRedirectOrigin?: string;
  accessTokenGetter?: () => Promise<string | null>;
  fetchImplementation?: typeof globalThis.fetch;
}

export function initSharedConfig(config: SharedConfig) {
  initSupabase(config.supabaseUrl, config.supabaseAnonKey);
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
