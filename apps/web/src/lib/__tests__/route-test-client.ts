/**
 * Reusable harness for end-to-end route handler tests.
 *
 * Builds a `Request`, invokes the exported App Router handler, and parses the
 * `NextResponse` back into `{ status, json }`. Pairs with `vi.mock("@/lib/api-auth", ...)`
 * to bypass auth so the handler can be exercised without standing up Supabase.
 *
 * See `apps/web/src/app/api/evaluate/route.test.ts` for the map-coach usage.
 */

/**
 * Route handlers in this app come in two shapes:
 *  - `(req)` for static routes (`/api/run`, `/api/evaluate`, ...)
 *  - `(req, ctx)` for dynamic routes where `ctx.params` is a `Promise` of
 *    the path params (Next 16 App Router shape — see
 *    `apps/web/src/app/api/admin/tier-lists/[id]/route.ts` for an example).
 *
 * The `unknown[]` rest captures both. Callers don't need to type-narrow.
 */
export type RouteHandler = (req: Request, ...rest: unknown[]) => Promise<Response>;

export interface CallRouteOptions {
  method?: string;
  body?: unknown;
  bearerToken?: string;
  url?: string;
  headers?: Record<string, string>;
  /**
   * Path params for dynamic routes. Passed to the handler as the second
   * positional arg wrapped in a `{ params: Promise }` ctx object — matching
   * Next 16's App Router shape. Omit for static routes.
   */
  params?: Record<string, string | string[]>;
}

export interface CallRouteResult<T> {
  status: number;
  json: T;
}

const DEFAULT_URL = "http://localhost/api/test";

/**
 * Build a `Request`, call the handler, and return the parsed JSON + status.
 *
 * Defaults to POST with a JSON body if `body` is provided. Bearer token (if
 * supplied) is set on the `Authorization` header — useful for routes that
 * exercise the desktop-style auth path even when `requireAuth` itself is
 * mocked.
 */
export async function callRoute<T = unknown>(
  handler: RouteHandler,
  opts: CallRouteOptions = {},
): Promise<CallRouteResult<T>> {
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined && headers["content-type"] === undefined) {
    headers["content-type"] = "application/json";
  }
  if (opts.bearerToken) {
    headers["authorization"] = `Bearer ${opts.bearerToken}`;
  }

  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  }

  const req = new Request(opts.url ?? DEFAULT_URL, init);
  const ctx = opts.params
    ? { params: Promise.resolve(opts.params) }
    : undefined;
  const res = ctx ? await handler(req, ctx) : await handler(req);
  const json = (await res.json()) as T;
  return { status: res.status, json };
}
