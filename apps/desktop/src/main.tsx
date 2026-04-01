import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import "./index.css";
import { App } from "./App";
import { AuthProvider } from "./auth-provider";
import { ErrorBoundary } from "@sts2/shared/components/error-boundary";
import { initSharedConfig } from "@sts2/shared/lib/init";
import { setApiBaseUrl } from "@sts2/shared/lib/api-client";
import { reportError, initErrorReporter } from "@sts2/shared/lib/error-reporter";
import { createClient } from "@sts2/shared/supabase/client";

// Initialize Sentry for crash reporting
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN ?? "https://12f87c41bf7be1e26757c68d4089ac8b@o4511051123064832.ingest.us.sentry.io/4511142195953664",
  sendDefaultPii: false,
  environment: import.meta.env.DEV ? "development" : "production",
  release: `sts2-replay@0.1.9`,
});

// Wire Sentry into the shared error reporter so all reportError() calls go to both Sentry + Supabase
initErrorReporter({
  captureException: (err, ctx) => Sentry.captureException(err, ctx as Parameters<typeof Sentry.captureException>[1]),
  captureMessage: (msg, ctx) => { Sentry.captureMessage(msg, ctx as Parameters<typeof Sentry.captureMessage>[1]); },
  setContext: (name, ctx) => Sentry.setContext(name, ctx),
  setTag: (key, value) => Sentry.setTag(key, value),
});

// Configure shared package for desktop environment
// TODO: Read from environment or Tauri config
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "https://sts2-helper.vercel.app";
const AUTH_REDIRECT_ORIGIN = "sts2replay://";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

// Debug: log what env vars are available
console.log("[Init] API_BASE:", API_BASE);
console.log("[Init] SUPABASE_URL:", SUPABASE_URL ? SUPABASE_URL.slice(0, 30) + "..." : "EMPTY");
console.log("[Init] SUPABASE_ANON_KEY:", SUPABASE_ANON_KEY ? SUPABASE_ANON_KEY.slice(0, 15) + "..." : "EMPTY");

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  console.log("[Init] initSharedConfig running");
  initSharedConfig({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    apiBaseUrl: API_BASE,
    authRedirectOrigin: AUTH_REDIRECT_ORIGIN,
    accessTokenGetter: async () => {
      const client = createClient();
      const { data, error } = await client.auth.getSession();
      console.log("[TokenGetter] getSession result:", {
        hasSession: !!data.session,
        hasToken: !!data.session?.access_token,
        expiresAt: data.session?.expires_at,
        error: error?.message,
      });
      if (data.session?.access_token) {
        const expiresAt = data.session.expires_at ?? 0;
        const now = Math.floor(Date.now() / 1000);
        if (expiresAt > now + 60) {
          return data.session.access_token;
        }
        // Token expiring soon — refresh
        const { data: refreshed } = await client.auth.refreshSession();
        return refreshed.session?.access_token ?? data.session.access_token;
      }
      return null;
    },
  });
} else {
  // API base still needed for non-auth features
  setApiBaseUrl(API_BASE);
  console.warn("[STS2] Supabase credentials not configured. Auth features will not work.");
}

// Global error handlers — catch unhandled errors and report remotely
window.onerror = (message, source, lineno, colno, error) => {
  reportError("unhandled_error", String(message), {
    source, lineno, colno,
    stack: error?.stack,
  });
};

window.addEventListener("unhandledrejection", (e) => {
  reportError("unhandled_rejection", e.reason?.message ?? String(e.reason), {
    stack: e.reason?.stack,
  });
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
