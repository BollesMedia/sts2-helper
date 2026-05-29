const REFRESH_UA =
  "Mozilla/5.0 (compatible; sts2-helper-tier-refresh/1.0; +https://sts2-helper.app/bots)";

const MAX_HTML_BYTES = 8 * 1024 * 1024;

export async function fetchSourceHtml(
  url: string,
): Promise<{ ok: true; html: string } | { ok: false; reason: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": REFRESH_UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    return {
      ok: false,
      reason:
        err instanceof Error && err.name === "TimeoutError"
          ? "timeout"
          : "fetch_error",
    };
  }
  if (!res.ok) return { ok: false, reason: `http_${res.status}` };
  const html = await res.text();
  if (html.length === 0) return { ok: false, reason: "html_invalid" };
  if (html.length > MAX_HTML_BYTES) return { ok: false, reason: "html_too_large" };
  return { ok: true, html };
}
