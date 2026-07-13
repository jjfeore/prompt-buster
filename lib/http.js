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
