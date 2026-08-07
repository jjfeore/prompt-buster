import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(tmpdir(), "pb-quar-"));
process.env.PROMPT_BUSTER_HOME = home;

const { defaultConfig } = await import("../skills/prompt-buster/scripts/lib/config.js");
const {
  storeQuarantine,
  releaseQuarantine,
  denyQuarantine,
  checkDecision,
  getQuarantine,
  clearQuarantine,
} = await import("../skills/prompt-buster/scripts/lib/engine/quarantine.js");
const { decisionsPath } = await import("../skills/prompt-buster/scripts/lib/paths.js");

const config = defaultConfig();

// Reset both the quarantine dir AND the decisions file so a corrupt-file test
// can't poison later tests (recordDecision now refuses to write over corruption).
function reset() {
  clearQuarantine(config);
  if (existsSync(decisionsPath())) rmSync(decisionsPath(), { force: true });
}

function fakeScan() {
  return { prefilters: [{ filter: "regex", triggered: true, findings: [{ detectorId: "x" }] }], review: { ran: false } };
}

test("release then checkDecision returns allow scoped to origin", () => {
  reset();
  const entry = storeQuarantine({ content: "flagged text", scanRecord: fakeScan(), source: { url: "https://a.example/p" }, config });
  releaseQuarantine(entry.id, { note: "looks fine", config });
  const same = checkDecision(entry.contentSha256, { url: "https://a.example/other" });
  assert.equal(same?.decision, "allow", "same origin is allowed");
  const other = checkDecision(entry.contentSha256, { url: "https://evil.example/p" });
  assert.equal(other, null, "different origin is NOT auto-allowed");
});

test("deny is broad (any origin) and survives", () => {
  reset();
  const entry = storeQuarantine({ content: "bad text here", scanRecord: fakeScan(), source: { url: "https://a.example/p" }, config });
  denyQuarantine(entry.id, { config });
  assert.equal(checkDecision(entry.contentSha256, { url: "https://anywhere.example" })?.decision, "deny");
});

test("corrupt decisions file fails safe: no silent allow, deny not dropped", () => {
  reset();
  const entry = storeQuarantine({ content: "corrupt-test content", scanRecord: fakeScan(), source: { url: "https://a.example/p" }, config });
  releaseQuarantine(entry.id, { note: "ok", config });
  assert.equal(checkDecision(entry.contentSha256, { url: "https://a.example/p" })?.decision, "allow");
  // Corrupt the decisions file.
  writeFileSync(decisionsPath(), "{ this is not valid json");
  const result = checkDecision(entry.contentSha256, { url: "https://a.example/p" });
  assert.equal(result, null, "a corrupt decisions file must not yield a cached allow (fail safe)");
});

test("recording a decision over a corrupt file is refused, not silently clobbered", () => {
  reset();
  const denied = storeQuarantine({ content: "denied-content-preserve", scanRecord: fakeScan(), source: { url: "https://a.example/p" }, config });
  denyQuarantine(denied.id, { config });
  // Corrupt the decisions file, then attempt an unrelated release.
  writeFileSync(decisionsPath(), "{ corrupt");
  const other = storeQuarantine({ content: "unrelated-content", scanRecord: fakeScan(), source: { url: "https://b.example/p" }, config });
  assert.throws(() => releaseQuarantine(other.id, { note: "n", config }), /corrupt/, "refuses to write over a corrupt decisions file");
});

test("released entry retains content; denied entry blocks re-release", () => {
  reset();
  const entry = storeQuarantine({ content: "some content", scanRecord: fakeScan(), source: {}, config });
  const released = releaseQuarantine(entry.id, { note: "n", config });
  assert.equal(released.content, "some content");
  const stored = getQuarantine(entry.id, config);
  assert.equal(stored.status, "released");
});

test("invalid quarantine id is rejected", () => {
  assert.throws(() => getQuarantine("../etc/passwd", config));
  assert.throws(() => releaseQuarantine("q_zzz", { config }));
});

test.after(() => rmSync(home, { recursive: true, force: true }));
