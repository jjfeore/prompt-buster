import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlockedHost, boundedFetch, FetchError } from "../skills/prompt-buster/scripts/lib/http.js";

test("isBlockedHost blocks loopback/private/link-local/metadata", () => {
  for (const host of ["localhost", "127.0.0.1", "0.0.0.0", "10.0.0.5", "172.16.9.9", "192.168.1.1", "169.254.169.254", "::1", "[::1]", "fe80::1", "fd00::1", "::ffff:127.0.0.1"]) {
    assert.equal(isBlockedHost(host), true, `should block ${host}`);
  }
});

test("isBlockedHost allows public hosts", () => {
  for (const host of ["example.com", "8.8.8.8", "1.1.1.1", "203.0.113.5", "huggingface.co", "2606:4700:4700::1111"]) {
    assert.equal(isBlockedHost(host), false, `should allow ${host}`);
  }
});

test("boundedFetch refuses a request to a blocked host", async () => {
  await assert.rejects(
    () => boundedFetch("http://169.254.169.254/latest/meta-data/", { timeoutMs: 500 }),
    (err) => err instanceof FetchError && err.code === "blocked_host",
  );
});

test("boundedFetch rejects non-http schemes", async () => {
  await assert.rejects(
    () => boundedFetch("file:///etc/passwd", { timeoutMs: 500 }),
    (err) => err instanceof FetchError && err.code === "blocked_scheme",
  );
});

test("boundedFetch rejects an invalid URL", async () => {
  await assert.rejects(() => boundedFetch("not a url", { timeoutMs: 500 }), (err) => err instanceof FetchError);
});
