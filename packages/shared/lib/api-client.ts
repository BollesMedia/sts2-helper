/**
 * Configurable API base URL for fetch calls.
 * Web app sets "" (relative), desktop app sets "https://sts2replay.com".
 */
let baseUrl = "";
let getAccessToken: (() => Promise<string | null>) | null = null;
let fetchImpl: typeof globalThis.fetch = globalThis.fetch;

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

/**
 * Override the fetch implementation used for API calls.
 * Desktop app uses Tauri's HTTP plugin to bypass WebView CORS restrictions.
 */
export function setFetchImplementation(impl: typeof globalThis.fetch) {
  fetchImpl = impl;
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

  console.log("[apiFetch] state:", {
    hasTokenGetter: !!getAccessToken,
    usingTauriFetch: fetchImpl !== globalThis.fetch,
  });

  if (getAccessToken) {
    try {
      const token = await getAccessToken();
      console.log("[apiFetch] token:", token ? `present (${token.length} chars)` : "null");
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    } catch (err) {
      console.error("[apiFetch] token getter threw:", err);
    }
  } else {
    console.warn("[apiFetch] no token getter configured");
  }

  const url = apiUrl(path);

  const res = await fetchImpl(url, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string>) },
  });

  if (!res.ok) {
    console.error("[apiFetch]", res.status, res.statusText, path);
  }

  return res;
}
