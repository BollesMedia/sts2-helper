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
    const token = await getAccessToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    } else {
      console.warn("[apiFetch] No access token available — request will be unauthenticated");
    }
  } else {
    console.warn("[apiFetch] No token getter configured");
  }

  return fetch(apiUrl(path), {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string>) },
  });
}
