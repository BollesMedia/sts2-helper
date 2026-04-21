import { describe, it, expect } from "vitest";
import { isPrivateIp, SafeFetchError, safeFetchImage } from "./safe-fetch";

describe("isPrivateIp", () => {
  it.each([
    ["127.0.0.1", true],
    ["10.0.0.1", true],
    ["10.255.255.255", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["172.32.0.1", false], // just outside the /12
    ["192.168.1.1", true],
    ["169.254.169.254", true], // AWS IMDS
    ["100.64.0.1", true], // CGNAT
    ["0.0.0.0", true],
    ["224.0.0.1", true], // multicast
    ["8.8.8.8", false],
    ["1.1.1.1", false],
    ["::1", true],
    ["fe80::1", true],
    ["fc00::1", true],
    ["2001:4860:4860::8888", false], // google dns v6
    ["not-an-ip", true], // unknown format → unsafe
  ])("%s → %s", (ip, expected) => {
    expect(isPrivateIp(ip)).toBe(expected);
  });
});

describe("safeFetchImage", () => {
  it("rejects non-http(s) schemes", async () => {
    await expect(safeFetchImage("file:///etc/passwd")).rejects.toMatchObject({
      name: "SafeFetchError",
      code: "scheme",
    });
  });

  it("rejects URLs whose host resolves to a private IP", async () => {
    await expect(safeFetchImage("http://169.254.169.254/latest/meta-data/")).rejects.toMatchObject(
      { code: "private_ip" },
    );
  });

  it("rejects localhost literal", async () => {
    await expect(safeFetchImage("http://127.0.0.1:22/")).rejects.toMatchObject({
      code: "private_ip",
    });
  });

  it("rejects hosts outside the allowlist when one is provided", async () => {
    await expect(
      safeFetchImage("https://example.com/x.png", { allowedHosts: ["tiermaker.com"] }),
    ).rejects.toMatchObject({ code: "host" });
  });

  it("accepts hosts that match the allowlist (suffix)", async () => {
    // Don't actually perform the fetch — a bad URL will throw after host passes.
    // We just assert the host check no longer rejects.
    await expect(
      safeFetchImage("https://sub.example.com/x.png", {
        allowedHosts: ["example.com"],
        timeoutMs: 1,
      }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^(network|http_error|content_type|private_ip)$/) });
  });

  it("exposes SafeFetchError type for callers to distinguish causes", () => {
    const err = new SafeFetchError("boom", "scheme");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("scheme");
  });
});
