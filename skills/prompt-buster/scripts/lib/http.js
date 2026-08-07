/**
 * Bounded fetch for untrusted URLs. Uses the built-in undici-backed fetch;
 * enforces timeout, redirect cap, size cap, and scheme allowlist. Never
 * follows redirects to non-http(s) schemes.
 */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export class FetchError extends Error {
  constructor(message, { code = "fetch_error", status = 0 } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function boundedFetch(url, { timeoutMs = 20000, maxRedirects = 5, maxBytes = 2_000_000, userAgent = "prompt-buster" } = {}) {
  let current;
  try {
    current = new URL(String(url));
  } catch {
    throw new FetchError(`invalid URL: ${String(url).slice(0, 200)}`, { code: "invalid_url" });
  }

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!ALLOWED_PROTOCOLS.has(current.protocol)) {
      throw new FetchError(`blocked scheme: ${current.protocol}`, { code: "blocked_scheme" });
    }
    // SSRF guard: refuse loopback/private/link-local/metadata literal hosts on
    // the initial URL and every redirect target. (Hostname-based DNS rebinding
    // is a documented residual — fetch resolves DNS itself, so we cannot pin
    // the connected IP; this blocks the direct "redirect to 169.254.169.254"
    // and localhost vectors.)
    if (isBlockedHost(current.hostname)) {
      throw new FetchError(`blocked host (loopback/private/link-local): ${current.hostname}`, { code: "blocked_host" });
    }
    let response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "User-Agent": userAgent, Accept: "text/html, text/plain, application/json, */*" },
      });
    } catch (error) {
      const reason = error?.name === "TimeoutError" ? "timeout" : (error?.cause?.code || error?.message || "network_error");
      throw new FetchError(`fetch failed: ${reason}`, { code: "network_error" });
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel?.();
      if (!location) throw new FetchError(`redirect without location (${response.status})`, { code: "bad_redirect", status: response.status });
      current = new URL(location, current);
      continue;
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const body = await readBounded(response, maxBytes);
    return {
      url: current.toString(),
      status: response.status,
      ok: response.ok,
      contentType,
      body,
      truncated: body.truncated,
    };
  }
  throw new FetchError(`too many redirects (> ${maxRedirects})`, { code: "too_many_redirects" });
}

/** Block literal loopback/private/link-local/metadata hosts (SSRF defense). */
export function isBlockedHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;

  // IPv4 literal.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10 || a === 0) return true; // loopback, private, this-network
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  // IPv6 literal: loopback ::1, unspecified ::, unique-local fc00::/7, link-local fe80::/10,
  // and IPv4-mapped forms.
  if (host.includes(":")) {
    if (host === "::1" || host === "::") return true;
    if (/^f[cd][0-9a-f]{2}:/.test(host)) return true; // fc00::/7
    if (/^fe[89ab][0-9a-f]:/.test(host)) return true; // fe80::/10
    const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host);
    if (mapped) return isBlockedHost(mapped[1]);
    return false;
  }
  return false;
}

async function readBounded(response, maxBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    const sliced = text.length > maxBytes;
    const out = sliced ? text.slice(0, maxBytes) : text;
    return { text: out, bytes: Buffer.byteLength(out, "utf-8"), truncated: sliced };
  }
  const parts = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      parts.push(value.subarray(0, value.byteLength - (total - maxBytes)));
      truncated = true;
      await reader.cancel();
      break;
    }
    parts.push(value);
  }
  const text = Buffer.concat(parts).toString("utf-8");
  return { text, bytes: Math.min(total, maxBytes), truncated };
}
