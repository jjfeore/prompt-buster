import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync, renameSync } from "node:fs";
import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { auditLogPath, decisionsPath, ensureDir, quarantineDir } from "../paths.js";
import { redactSecrets, sha256Hex } from "../sanitize.js";

/**
 * Quarantine store for escalated content plus the allow/deny decision cache.
 * Entries are single JSON files under ~/.prompt-buster/quarantine; decisions
 * are keyed by content sha256 with TTLs so releasing a page doesn't re-prompt
 * on every fetch, and denying one keeps blocking it.
 */

export function storeQuarantine({ content, scanRecord, source, config }) {
  const dir = ensureDir(quarantineDir(config));
  const id = `q_${randomBytes(4).toString("hex")}`;
  const entry = {
    id,
    createdAt: new Date().toISOString(),
    contentSha256: sha256Hex(content),
    source: source || {},
    scan: scanRecord,
    status: "pending",
    content,
  };
  writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(entry, null, 2) + "\n", { mode: 0o600 });
  pruneQuarantine(config);
  audit("escalated", { id, sha256: entry.contentSha256, source: entry.source, findings: summarizeFindings(scanRecord) });
  return entry;
}

export function listQuarantine(config, { includeResolved = false } = {}) {
  const dir = quarantineDir(config);
  if (!existsSync(dir)) return [];
  const entries = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const entry = JSON.parse(readFileSync(path.join(dir, file), "utf-8"));
      if (!includeResolved && entry.status !== "pending") continue;
      entries.push(entry);
    } catch {
      // Unreadable entries are surfaced by `doctor`, not silently deleted.
    }
  }
  return entries.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export function getQuarantine(id, config) {
  const file = entryPath(id, config);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf-8"));
}

export function releaseQuarantine(id, { note = "", config, actor = "user" } = {}) {
  const entry = getQuarantine(id, config);
  if (!entry) throw new QuarantineError(`no quarantine entry ${id}`);
  if (entry.status === "denied") throw new QuarantineError(`${id} was already denied`);
  entry.status = "released";
  entry.resolvedAt = new Date().toISOString();
  entry.note = String(note || "");
  entry.actor = actor;
  writeFileSync(entryPath(id, config), JSON.stringify(entry, null, 2) + "\n", { mode: 0o600 });
  recordDecision("allow", entry.contentSha256, {
    id,
    note: entry.note,
    ttlHours: config?.quarantine?.allowTtlHours ?? 24,
    source: entry.source || {},
  });
  audit("released", { id, sha256: entry.contentSha256, note: redactSecrets(entry.note).text, actor });
  return entry;
}

export function denyQuarantine(id, { config, actor = "user" } = {}) {
  const entry = getQuarantine(id, config);
  if (!entry) throw new QuarantineError(`no quarantine entry ${id}`);
  entry.status = "denied";
  entry.resolvedAt = new Date().toISOString();
  entry.actor = actor;
  writeFileSync(entryPath(id, config), JSON.stringify(entry, null, 2) + "\n", { mode: 0o600 });
  recordDecision("deny", entry.contentSha256, {
    id,
    ttlHours: config?.quarantine?.denyTtlHours ?? 720,
  });
  audit("denied", { id, sha256: entry.contentSha256, actor });
  return entry;
}

export function clearQuarantine(config) {
  const dir = quarantineDir(config);
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const file of readdirSync(dir)) {
    if (file.endsWith(".json")) {
      rmSync(path.join(dir, file), { force: true });
      removed += 1;
    }
  }
  audit("cleared", { removed });
  return removed;
}

export class QuarantineError extends Error {}

/**
 * Decision cache. Returns {decision: "allow"|"deny", note, id} or null.
 * Deny is broad (keyed by content hash — a denied page stays denied anywhere).
 * Allow is scoped to (content hash + source origin) so releasing one page does
 * not auto-trust byte-identical content served from a different origin.
 * A corrupt/unreadable decisions file NEVER silently drops denials — it is
 * surfaced and treated as "unknown", which for allow means re-scan (safe).
 */
export function checkDecision(contentSha256, source = {}) {
  const { decisions, corrupt } = readDecisions();
  if (corrupt) {
    // Fail safe: do not honor a cached allow we cannot trust; force re-scan.
    return null;
  }
  const now = Date.now();

  const denyRec = decisions.deny[contentSha256];
  if (denyRec && !isExpired(denyRec, now)) {
    return { decision: "deny", note: denyRec.note || "", id: denyRec.id || "" };
  }

  const allowKey = allowKeyFor(contentSha256, source);
  const allowRec = decisions.allow[allowKey] || decisions.allow[contentSha256];
  if (allowRec && !isExpired(allowRec, now)) {
    return { decision: "allow", note: allowRec.note || "", id: allowRec.id || "" };
  }
  return null;
}

function isExpired(record, now) {
  return record.expiresAt && Date.parse(record.expiresAt) < now;
}

function allowKeyFor(contentSha256, source) {
  const origin = originOf(source);
  return origin ? `${contentSha256}@${origin}` : contentSha256;
}

function originOf(source) {
  const url = source?.url || "";
  try {
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
}

function recordDecision(kind, contentSha256, { id, note = "", ttlHours, source = {} }) {
  const { decisions } = readDecisions();
  const ttlMs = Math.max(0, Number(ttlHours) || 0) * 3600 * 1000;
  const key = kind === "allow" ? allowKeyFor(contentSha256, source) : contentSha256;
  decisions[kind][key] = {
    id,
    note,
    decidedAt: new Date().toISOString(),
    expiresAt: ttlMs > 0 ? new Date(Date.now() + ttlMs).toISOString() : "",
  };
  writeDecisions(decisions);
}

function readDecisions() {
  const file = decisionsPath();
  if (!existsSync(file)) return { decisions: { allow: {}, deny: {} }, corrupt: false };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    return { decisions: { allow: parsed.allow || {}, deny: parsed.deny || {} }, corrupt: false };
  } catch {
    // Do NOT return empty deny set — that would fail open. Signal corruption.
    audit("decisions_corrupt", { file });
    return { decisions: { allow: {}, deny: {} }, corrupt: true };
  }
}

function writeDecisions(decisions) {
  ensureDir(path.dirname(decisionsPath()));
  // Atomic write: temp file + rename so a concurrent reader never sees a torn
  // file and a crash mid-write cannot corrupt the deny set.
  const file = decisionsPath();
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(decisions, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, file);
}

/** Append a redacted, timestamped line to the audit log. Never throws. */
export function audit(action, details = {}) {
  try {
    ensureDir(path.dirname(auditLogPath()));
    const line = JSON.stringify({ at: new Date().toISOString(), action, ...details });
    appendFileSync(auditLogPath(), line + "\n", { mode: 0o600 });
  } catch {
    // Auditing must never break scanning.
  }
}

function entryPath(id, config) {
  if (!/^q_[0-9a-f]{8}$/.test(String(id))) throw new QuarantineError(`invalid quarantine id: ${String(id).slice(0, 40)}`);
  return path.join(quarantineDir(config), `${id}.json`);
}

function pruneQuarantine(config) {
  const max = config?.quarantine?.maxEntries ?? 500;
  const dir = quarantineDir(config);
  if (!existsSync(dir)) return;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const full = path.join(dir, f);
      return { full, mtime: statSync(full).mtimeMs };
    })
    .sort((a, b) => a.mtime - b.mtime);
  while (files.length > max) {
    const oldest = files.shift();
    rmSync(oldest.full, { force: true });
  }
}

function summarizeFindings(scanRecord) {
  const out = [];
  for (const stage of scanRecord?.prefilters ?? []) {
    if (stage.triggered) {
      out.push({ filter: stage.filter, detectors: (stage.findings || []).map((f) => f.detectorId), score: stage.score });
    }
  }
  return out;
}
