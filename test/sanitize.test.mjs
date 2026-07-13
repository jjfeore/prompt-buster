import { test } from "node:test";
import assert from "node:assert/strict";
import { stripControl, redactSecrets, wrapUntrusted, sha256Hex } from "../lib/sanitize.js";

test("stripControl removes ANSI escapes and escapes control chars", () => {
  const hostile = "hello \x1b[31mRED\x1b[0m bell \x07 null \x00";
  const out = stripControl(hostile);
  assert.ok(!out.includes("\x1b"), "ANSI escape removed");
  assert.ok(!out.includes("\x07"), "raw bell removed");
  assert.ok(out.includes("\\x07") && out.includes("\\x00"), "control chars made visible");
  assert.ok(out.includes("RED"));
});

test("stripControl keeps tab/newline/carriage-return", () => {
  assert.equal(stripControl("a\tb\nc\r"), "a\tb\nc\r");
});

test("redactSecrets masks high-confidence credentials", () => {
  const text = "key sk-ant-abcdefghijklmnopqrstuvwxyz and token ghp_abcdefghijklmnopqrstuvwxyz01";
  const { text: redacted, secretTypes } = redactSecrets(text);
  assert.ok(redacted.includes("[REDACTED_SECRET]"));
  assert.ok(!redacted.includes("sk-ant-abcdefghijklmnop"));
  assert.ok(secretTypes.includes("anthropic_key"));
  assert.ok(secretTypes.includes("github_token"));
});

test("redactSecrets leaves ordinary text untouched", () => {
  const { text, secretTypes } = redactSecrets("just a normal sentence with no secrets");
  assert.equal(text, "just a normal sentence with no secrets");
  assert.deepEqual(secretTypes, []);
});

test("wrapUntrusted uses a random per-call boundary", () => {
  const a = wrapUntrusted("x");
  const b = wrapUntrusted("x");
  assert.notEqual(a.token, b.token, "tokens are random per call");
  assert.ok(a.wrapped.includes(a.open) && a.wrapped.includes(a.close));
});

test("sha256Hex is stable and utf-8 based", () => {
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
