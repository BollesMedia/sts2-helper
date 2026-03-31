import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { AuthProvider } from "./auth-provider";
import { initSharedConfig } from "@sts2/shared/lib/init";
import { setApiBaseUrl } from "@sts2/shared/lib/api-client";
import { createClient } from "@sts2/shared/supabase/client";

// Configure shared package for desktop environment
// TODO: Read from environment or Tauri config
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "https://sts2-helper.vercel.app";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  initSharedConfig({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    apiBaseUrl: API_BASE,
    authRedirectOrigin: API_BASE,
    // Desktop app sends Bearer token for API auth (no cookies cross-origin)
    accessTokenGetter: async () => {
      const { data } = await createClient().auth.getSession();
      return data.session?.access_token ?? null;
    },
  });
} else {
  // API base still needed for non-auth features
  setApiBaseUrl(API_BASE);
  console.warn("[STS2] Supabase credentials not configured. Auth features will not work.");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
