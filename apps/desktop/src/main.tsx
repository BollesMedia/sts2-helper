import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { AuthProvider } from "./auth-provider";
import { setApiBaseUrl, setAccessTokenGetter } from "@sts2/shared/lib/api-client";
import { initSupabase, createClient } from "@sts2/shared/supabase/client";
import { setAuthRedirectOrigin } from "@sts2/shared/supabase/auth";

// Configure shared package for desktop environment
// TODO: Read from environment or Tauri config
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "https://sts2-helper.vercel.app";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

setApiBaseUrl(API_BASE);
setAuthRedirectOrigin(API_BASE);

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  initSupabase(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Desktop app sends Bearer token for API auth (no cookies cross-origin)
  setAccessTokenGetter(async () => {
    const { data } = await createClient().auth.getSession();
    return data.session?.access_token ?? null;
  });
} else {
  console.warn("[STS2] Supabase credentials not configured. Auth features will not work.");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
