import { apiFetch } from "./api-client";

const APP_VERSION = "0.1.0";
let reportCount = 0;
const MAX_REPORTS_PER_SESSION = 50;

function getPlatform(): string {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) return "macos";
  if (ua.includes("win")) return "windows";
  return "unknown";
}

/**
 * Report an error or feedback to the remote error_logs table.
 * Fire-and-forget — never blocks, never throws, never causes secondary errors.
 */
export function reportError(
  source: string,
  message: string,
  context?: Record<string, unknown>
) {
  // Throttle: max 50 reports per session to prevent flood
  if (reportCount >= MAX_REPORTS_PER_SESSION) return;
  reportCount++;

  apiFetch("/api/error", {
    method: "POST",
    body: JSON.stringify({
      source,
      level: "error",
      message: message.slice(0, 2000), // cap message length
      context,
      app_version: APP_VERSION,
      platform: getPlatform(),
    }),
  }).catch(() => {}); // Swallow — never let error reporting cause errors
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

  apiFetch("/api/error", {
    method: "POST",
    body: JSON.stringify({
      source: "user_feedback",
      level: "info",
      message: message.slice(0, 5000), // allow longer for feedback
      context,
      app_version: APP_VERSION,
      platform: getPlatform(),
    }),
  }).catch(() => {});
}
