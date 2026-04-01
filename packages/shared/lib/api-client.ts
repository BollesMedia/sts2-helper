/**
 * Configurable API base URL for fetch calls.
 * Web app sets "" (relative), desktop app sets "https://sts2replay.com".
 */
let baseUrl = "";
let getAccessToken: (() => Promise<string | null>) | null = null;

export function setApiBaseUrl(url: string) {
  baseUrl = url;
}

/**
 * Set a function that returns the current Supabase access token.
 * Desktop app uses this to send Bearer auth; web app relies on cookies.
 */
export function setAccessTokenGetter(getter: () => Promise<string | null>) {
  getAccessToken = getter;
}

export function apiUrl(path: string): string {
  return `${baseUrl}${path}`;
}

/**
 * Wrapper around fetch that adds auth headers when configured.
 * Use this instead of raw fetch() for all API calls.
 */
export async function apiFetch(
  path: string,
  init: RequestInit & { body?: string }
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (getAccessToken) {
    try {
      const token = await getAccessToken();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
        console.log("[apiFetch]", path, "token present, length:", token.length, "prefix:", token.slice(0, 20) + "...");
      } else {
        console.warn("[apiFetch]", path, "token getter returned null");
      }
    } catch (err) {
      console.error("[apiFetch]", path, "token getter threw:", err);
    }
  } else {
    console.warn("[apiFetch]", path, "no token getter configured — was initSharedConfig called?");
  }

  const url = apiUrl(path);
  console.log("[apiFetch]", "→", init.method ?? "GET", url);

  const res = await fetch(url, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string>) },
  });

  if (!res.ok) {
    console.error("[apiFetch]", "←", res.status, res.statusText, path);
  }

  return res;
}
