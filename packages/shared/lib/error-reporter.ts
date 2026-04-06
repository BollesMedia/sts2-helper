import { apiFetch } from "./api-client";

const APP_VERSION = "0.12.3";
let reportCount = 0;
let isReporting = false;
const MAX_REPORTS_PER_SESSION = 50;

// Sentry integration — lazy loaded to avoid hard dependency in shared package
let _sentry: {
  captureException: (err: unknown, ctx?: unknown) => void;
  captureMessage: (msg: string, ctx?: unknown) => void;
  setContext: (name: string, ctx: Record<string, unknown> | null) => void;
  setTag: (key: string, value: string) => void;
  setUser: (user: { id: string; email?: string } | null) => void;
} | null = null;

/**
 * Initialize Sentry integration. Call from the app entry point
 * after Sentry.init() — passes the Sentry module so the shared
 * package doesn't need @sentry/react as a dependency.
 */
export function initErrorReporter(sentry: typeof _sentry) {
  _sentry = sentry;
}

/**
 * Set the authenticated user for error reporting.
 * Call when auth state changes — ties Sentry events to the user.
 */
export function setReportingUser(user: { id: string; email?: string } | null) {
  _sentry?.setUser(user);
}

function getPlatform(): string {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) return "macos";
  if (ua.includes("win")) return "windows";
  return "unknown";
}

/**
 * Report an error to both Sentry and Supabase error_logs.
 * Fire-and-forget — never blocks, never throws, never causes secondary errors.
 */
export function reportError(
  source: string,
  message: string,
  context?: Record<string, unknown>
) {
  if (isReporting || reportCount >= MAX_REPORTS_PER_SESSION) return;
  isReporting = true;
  reportCount++;

  // Send to Sentry with metadata
  try {
    if (_sentry) {
      const err = new Error(message);
      err.name = source;
      _sentry.captureException(err, {
        tags: { source, platform: getPlatform(), app_version: APP_VERSION },
        extra: context,
      });
    }
  } catch { /* never let Sentry break the app */ }

  // Send to Supabase
  apiFetch("/api/error", {
    method: "POST",
    body: JSON.stringify({
      source,
      level: "error",
      message: message.slice(0, 2000),
      context,
      app_version: APP_VERSION,
      platform: getPlatform(),
    }),
  }).catch(() => {}).finally(() => { isReporting = false; });
}

/**
 * Report info-level event (startup diagnostics, etc.)
 */
export function reportInfo(
  source: string,
  message: string,
  context?: Record<string, unknown>
) {
  if (reportCount >= MAX_REPORTS_PER_SESSION) return;
  reportCount++;

  try {
    if (_sentry) {
      _sentry.captureMessage(`[${source}] ${message}`, {
        level: "info",
        tags: { source, platform: getPlatform() },
        extra: context,
      } as unknown);
    }
  } catch { /* swallow */ }

  apiFetch("/api/error", {
    method: "POST",
    body: JSON.stringify({
      source,
      level: "info",
      message: message.slice(0, 2000),
      context,
      app_version: APP_VERSION,
      platform: getPlatform(),
    }),
  }).catch(() => {});
}

/**
 * Report user feedback (manual feedback button).
 */
export function reportFeedback(
  message: string,
  context?: Record<string, unknown>
) {
  if (reportCount >= MAX_REPORTS_PER_SESSION) return;
  reportCount++;

  try {
    if (_sentry) {
      _sentry.captureMessage(`[feedback] ${message}`, {
        level: "info",
        tags: { source: "user_feedback", platform: getPlatform() },
        extra: context,
      } as unknown);
    }
  } catch { /* swallow */ }

  apiFetch("/api/error", {
    method: "POST",
    body: JSON.stringify({
      source: "user_feedback",
      level: "info",
      message: message.slice(0, 5000),
      context,
      app_version: APP_VERSION,
      platform: getPlatform(),
    }),
  }).catch(() => {});
}
