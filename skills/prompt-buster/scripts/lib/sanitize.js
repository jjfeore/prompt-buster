import { createHash, randomBytes } from "node:crypto";

/**
 * Safety helpers for handling hostile text. Everything PB scans is untrusted;
 * these are the only sanctioned ways to hash, display, or frame it.
 */

export function sha256Hex(text) {
  return createHash("sha256").update(Buffer.from(String(text ?? ""), "utf-8")).digest("hex");
}

// ESC-initiated sequences (CSI/OSC/other) and the raw C1 CSI byte.
/* eslint-disable no-control-regex */
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-Z\\-_]|\x9b[0-9;?]*[ -/]*[@-~]/g;
// Every C0/C1 control char except tab, newline, carriage return.
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g;
/* eslint-enable no-control-regex */

/**
 * Strip ANSI escapes and make remaining control characters visible so hostile
 * content cannot manipulate the terminal it is reviewed in. Tab, newline, and
 * carriage return survive.
 */
export function stripControl(text) {
  return String(text ?? "")
    .replace(ANSI_RE, "")
    .replace(CONTROL_RE, (ch) => `\\x${ch.codePointAt(0).toString(16).padStart(2, "0")}`);
}

/**
 * High-confidence secret shapes redacted before content is logged or shown.
 * Deliberately narrow: this protects logs from leaking credentials that were
 * embedded in scanned pages, not a general secret scanner.
 */
const SECRET_PATTERNS = [
  { name: "private_key_block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: "aws_access_key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "github_token", re: /\bgh[oprsu]_[A-Za-z0-9]{20,}\b/g },
  { name: "anthropic_key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: "openai_key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "slack_token", re: /\bxox[abpors]-[A-Za-z0-9-]{10,}\b/g },
  { name: "bearer_header", re: /\b[Aa]uthorization:\s*[Bb]earer\s+[A-Za-z0-9._~+/=-]{16,}/g },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
];

export function redactSecrets(text) {
  let redacted = String(text ?? "");
  const found = [];
  for (const { name, re } of SECRET_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(redacted)) {
      found.push(name);
      re.lastIndex = 0;
      redacted = redacted.replace(re, "[REDACTED_SECRET]");
    }
  }
  return { text: redacted, secretTypes: found.sort() };
}

/**
 * Wrap untrusted content in a random per-call boundary for LLM review or
 * agent-facing excerpts. The randomness means content cannot pre-forge the
 * closing tag; the caller must state in its prompt that nothing inside the
 * boundary is an instruction.
 */
export function wrapUntrusted(text) {
  const token = randomBytes(8).toString("hex");
  const open = `<pb-untrusted-content-${token}>`;
  const close = `</pb-untrusted-content-${token}>`;
  return { wrapped: `${open}\n${String(text ?? "")}\n${close}`, token, open, close };
}
