import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { AuthProvider } from "./auth-provider";
import { setApiBaseUrl } from "@sts2/shared/lib/api-client";
import { initSupabase } from "@sts2/shared/supabase/client";
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
