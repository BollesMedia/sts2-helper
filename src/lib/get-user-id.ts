/**
 * Get the current user ID from localStorage.
 * Set by the auth provider on sign-in.
 */
export function getUserId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("sts2-user-id");
}
