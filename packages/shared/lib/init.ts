import { setApiBaseUrl, setAccessTokenGetter } from "./api-client";
import { initSupabase } from "../supabase/client";
import { setAuthRedirectOrigin } from "../supabase/auth";

interface SharedConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiBaseUrl: string;
  authRedirectOrigin?: string;
  accessTokenGetter?: () => Promise<string | null>;
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
}
