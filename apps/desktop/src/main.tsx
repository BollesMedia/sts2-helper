import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { store } from "./store/store";
import * as Sentry from "@sentry/react";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import "./index.css";
import { App } from "./App";
import { AuthProvider } from "./auth-provider";
import { ErrorBoundary } from "./components/error-boundary";
import { initSharedConfig } from "@sts2/shared/lib/init";
import { setApiBaseUrl } from "@sts2/shared/lib/api-client";
import { reportError, initErrorReporter } from "@sts2/shared/lib/error-reporter";
import { createClient } from "@sts2/shared/supabase/client";

// Initialize Sentry for crash reporting
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN ?? "https://12f87c41bf7be1e26757c68d4089ac8b@o4511051123064832.ingest.us.sentry.io/4511142195953664",
  sendDefaultPii: false,
  environment: import.meta.env.DEV ? "development" : "production",
  release: `sts2-replay@0.8.0`,
});

// Wire Sentry into the shared error reporter so all reportError() calls go to both Sentry + Supabase
initErrorReporter({
  captureException: (err, ctx) => Sentry.captureException(err, ctx as Parameters<typeof Sentry.captureException>[1]),
  captureMessage: (msg, ctx) => { Sentry.captureMessage(msg, ctx as Parameters<typeof Sentry.captureMessage>[1]); },
  setContext: (name, ctx) => Sentry.setContext(name, ctx),
  setTag: (key, value) => Sentry.setTag(key, value),
  setUser: (user) => Sentry.setUser(user),
});

// Configure shared package for desktop environment
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "https://sts2-helper.vercel.app";
const AUTH_REDIRECT_ORIGIN = "sts2replay://";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  initSharedConfig({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    apiBaseUrl: API_BASE,
    authRedirectOrigin: AUTH_REDIRECT_ORIGIN,
    storageMode: "localStorage",
    fetchImplementation: tauriFetch as typeof globalThis.fetch,
    accessTokenGetter: async () => {
      const client = createClient();
      const { data } = await client.auth.getSession();
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
    <Provider store={store}>
      <ErrorBoundary>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ErrorBoundary>
    </Provider>
  </React.StrictMode>
);
