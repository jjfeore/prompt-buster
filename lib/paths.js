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

/** Root of the installed package (for vendored models, skills, hooks). */
export function packageRoot() {
  return fileURLToPath(new URL("..", import.meta.url));
}
