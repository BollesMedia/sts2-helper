import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF-safe image fetcher for URLs parsed out of third-party HTML.
 *
 * Blocks:
 *   - non-http(s) schemes (file://, gopher://, javascript:, etc.)
 *   - RFC1918 / loopback / link-local / ULA / CGNAT destinations
 *   - responses larger than `maxBytes`
 *   - non-image Content-Type
 *
 * These guards are essential because pasted-HTML adapters extract URLs the
 * admin doesn't vet — a coerced admin or a malicious tiermaker list could
 * otherwise direct the serverless function at metadata endpoints or internal
 * services.
 */

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  /** Host allowlist — if provided, only exact suffix matches pass. */
  allowedHosts?: readonly string[];
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB — tier-list card images are <1 MB

export class SafeFetchError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "scheme"
      | "host"
      | "private_ip"
      | "content_type"
      | "too_large"
      | "http_error"
      | "network",
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export async function safeFetchImage(
  rawUrl: string,
  opts: SafeFetchOptions = {},
): Promise<Uint8Array> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SafeFetchError(`invalid URL: ${rawUrl}`, "scheme");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new SafeFetchError(`scheme not allowed: ${parsed.protocol}`, "scheme");
  }

  if (opts.allowedHosts) {
    const host = parsed.hostname.toLowerCase();
    const ok = opts.allowedHosts.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
    if (!ok) {
      throw new SafeFetchError(`host not allowed: ${host}`, "host");
    }
  }

  // Resolve the hostname ahead of fetch and reject non-public destinations.
  // Note: this is a TOCTOU — DNS rebinding could flip between here and the
  // fetch. For a defence-in-depth future improvement, use a custom dispatcher
  // that re-validates each socket. For now this matches the feature's threat
  // model (admin-operated, occasional use).
  let hostIps: string[];
  try {
    hostIps = await resolveHostIps(parsed.hostname);
  } catch (err) {
    throw new SafeFetchError(
      `DNS lookup failed for ${parsed.hostname}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      "network",
    );
  }
  for (const ip of hostIps) {
    if (isPrivateIp(ip)) {
      throw new SafeFetchError(
        `host resolves to non-public IP: ${parsed.hostname} → ${ip}`,
        "private_ip",
      );
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(parsed, { signal: controller.signal, redirect: "error" });
  } catch (err) {
    throw new SafeFetchError(
      err instanceof Error ? err.message : String(err),
      "network",
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new SafeFetchError(`HTTP ${res.status}`, "http_error");
  }

  const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (!contentType.startsWith("image/")) {
    throw new SafeFetchError(`non-image content-type: ${contentType || "(missing)"}`, "content_type");
  }

  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new SafeFetchError(`content-length ${declared} exceeds cap ${maxBytes}`, "too_large");
  }

  // Stream-guard against a lying Content-Length / chunked responses.
  const reader = res.body?.getReader();
  if (!reader) {
    throw new SafeFetchError("missing response body", "network");
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new SafeFetchError(`response exceeded ${maxBytes} bytes`, "too_large");
      }
      chunks.push(value);
    }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

async function resolveHostIps(hostname: string): Promise<string[]> {
  // Literal IP — validate directly without DNS.
  if (isIP(hostname)) return [hostname];
  const addresses = await lookup(hostname, { all: true });
  return addresses.map((a) => a.address);
}

/**
 * Reject IPs in ranges that aren't legitimately the public internet.
 * Covers IPv4 private/loopback/link-local/CGNAT and IPv6 loopback/ULA/link-local.
 */
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateIPv4(ip);
  if (v === 6) return isPrivateIPv6(ip);
  return true; // unknown format — treat as unsafe
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local + AWS IMDS
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 0) return true; // 0.0.0.0/8
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA fc00::/7
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
    return true; // link-local fe80::/10
  }
  if (lower.startsWith("ff")) return true; // multicast
  // IPv4-mapped / compat — re-test the embedded v4
  const ipv4Match = lower.match(/(?:^|::ffff:)(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Match) return isPrivateIPv4(ipv4Match[1]);
  return false;
}
