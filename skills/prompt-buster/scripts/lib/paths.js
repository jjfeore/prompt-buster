import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function pbHome() {
  const override = process.env.PROMPT_BUSTER_HOME;
  if (override && override.trim()) return path.resolve(override.trim());
  return path.join(homedir(), ".prompt-buster");
}

export function configPath() {
  return path.join(pbHome(), "config.json");
}

export function quarantineDir(config) {
  const custom = config?.quarantine?.dir;
  if (custom && String(custom).trim()) return path.resolve(String(custom).trim());
  return path.join(pbHome(), "quarantine");
}

export function auditLogPath() {
  return path.join(pbHome(), "audit.jsonl");
}

export function decisionsPath() {
  return path.join(pbHome(), "decisions.json");
}

export function runtimeDir() {
  return path.join(pbHome(), "runtime");
}

export function modelsDir() {
  return path.join(pbHome(), "models");
}

export function wolfModelDir() {
  return path.join(modelsDir(), "wolf-defender");
}

export function installManifestPath() {
  return path.join(pbHome(), "install-manifest.json");
}

export function patternsDir() {
  return path.join(pbHome(), "patterns.d");
}

/** Create a directory (and parents), restricting permissions best-effort. */
export function ensureDir(dir, { mode = 0o700 } = {}) {
  // mode is ignored on Windows; that is acceptable best-effort hardening.
  mkdirSync(dir, { recursive: true, mode });
  return dir;
}

/**
 * Root of the installed SKILL directory — the unit that `npx skills add`
 * copies into each agent's skills dir. This file lives at
 * <skillRoot>/scripts/lib/paths.js, so the skill root is two levels up.
 * Everything the engine needs at runtime (scripts/, assets/) sits under it,
 * which is what lets the skill work standalone after a skills-CLI install.
 */
export function skillRoot() {
  return fileURLToPath(new URL("../..", import.meta.url));
}

/** Vendored, ships-with-the-skill assets (models, corpus). */
export function assetsDir() {
  return path.join(skillRoot(), "assets");
}

/** Absolute path to the CLI entry point (used for hooks/MCP registration). */
export function cliEntryPath() {
  return path.join(skillRoot(), "scripts", "pb.mjs");
}
