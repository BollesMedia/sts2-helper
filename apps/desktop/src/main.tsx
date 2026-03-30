import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
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
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
