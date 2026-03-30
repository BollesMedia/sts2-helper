/**
 * Configurable API base URL for fetch calls.
 * Web app sets "" (relative), desktop app sets "https://sts2replay.com".
 */
let baseUrl = "";

export function setApiBaseUrl(url: string) {
  baseUrl = url;
}

export function apiUrl(path: string): string {
  return `${baseUrl}${path}`;
}
