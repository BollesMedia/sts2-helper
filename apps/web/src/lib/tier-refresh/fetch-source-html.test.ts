import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchSourceHtml } from "./fetch-source-html";

afterEach(() => vi.restoreAllMocks());

describe("fetchSourceHtml", () => {
  it("returns html on 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("<html>ok</html>", { status: 200 }),
    ));
    const r = await fetchSourceHtml("https://example.com");
    expect(r).toEqual({ ok: true, html: "<html>ok</html>" });
  });

  it("returns http_<code> reason on non-200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 403 })));
    const r = await fetchSourceHtml("https://example.com");
    expect(r).toEqual({ ok: false, reason: "http_403" });
  });

  it("rejects empty html", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
    const r = await fetchSourceHtml("https://example.com");
    expect(r).toEqual({ ok: false, reason: "html_invalid" });
  });

  it("rejects oversized html", async () => {
    const big = "x".repeat(8 * 1024 * 1024 + 1);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(big, { status: 200 })));
    const r = await fetchSourceHtml("https://example.com");
    expect(r).toEqual({ ok: false, reason: "html_too_large" });
  });

  it("returns fetch_error when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    const r = await fetchSourceHtml("https://example.com");
    expect(r).toEqual({ ok: false, reason: "fetch_error" });
  });
});
