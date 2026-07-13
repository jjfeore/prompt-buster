import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { configPath, patternsDir, ensureDir, pbHome } from "./paths.js";

/** Built-in defaults. docs/CONFIG.md is generated from this shape. */
export function defaultConfig() {
  return {
    prefilters: {
      order: ["regex", "wolf"],
      mode: "any", // "any" | "all"
      failMode: "open", // "open" | "closed"
      minChars: 12,
    },
    filters: {
      regex: { disabled: [], custom: [] },
      lightgbm: { threshold: 0.86 },
      wolf: {
        mode: "local", // "local" | "http"
        threshold: 0.5,
        dtype: "fp16", // "fp16" | "mixed"
        http: { url: "", token: "" },
        timeoutMs: 3000,
      },
      custom: [],
    },
    review: {
      enabled: true,
      provider: "auto", // auto | claude-cli | codex-cli | anthropic-api | openai-api | openai-compatible | none
      model: "",
      baseUrl: "",
      apiKeyEnv: "",
      timeoutMs: 30000,
      maxChars: 24000,
      onError: "escalate", // "escalate" | "allow"
    },
    escalation: {
      mode: "interactive", // "interactive" | "agent" | "block"
      excerptChars: 600,
    },
    quarantine: {
      dir: "",
      allowTtlHours: 24,
      denyTtlHours: 720,
      maxEntries: 500,
    },
    scan: {
      includeRawHtml: false,
      maxContentBytes: 2_000_000,
    },
    fetch: {
      timeoutMs: 20000,
      maxRedirects: 5,
      userAgent: "",
    },
    // startTimeoutMs must exceed Wolf's cold model load (~2-5s) or the first
    // scan of a session bypasses Wolf; 8s gives headroom on slow disks.
    daemon: { enabled: true, idleMinutes: 30, startTimeoutMs: 8000 },
    log: { level: "info", file: "" },
  };
}

const VALIDATORS = [
  ["prefilters.order", (v) => Array.isArray(v) && v.every((f) => typeof f === "string"), "an array of filter names"],
  ["prefilters.mode", (v) => v === "any" || v === "all", '"any" or "all"'],
  ["prefilters.failMode", (v) => v === "open" || v === "closed", '"open" or "closed"'],
  ["prefilters.minChars", (v) => Number.isInteger(v) && v >= 0, "a non-negative integer"],
  ["filters.regex.disabled", (v) => Array.isArray(v) && v.every((s) => typeof s === "string"), "an array of detector ids"],
  ["filters.regex.custom", (v) => Array.isArray(v), "an array of pattern objects"],
  ["filters.lightgbm.threshold", isProbability, "a number in [0,1]"],
  ["filters.wolf.mode", (v) => v === "local" || v === "http", '"local" or "http"'],
  ["filters.wolf.threshold", isProbability, "a number in [0,1]"],
  ["filters.wolf.dtype", (v) => v === "fp16" || v === "mixed", '"fp16" or "mixed"'],
  ["filters.wolf.http.url", (v) => typeof v === "string", "a string URL"],
  ["filters.wolf.timeoutMs", isPositiveInt, "a positive integer (ms)"],
  ["filters.custom", (v) => Array.isArray(v), "an array of classifier objects"],
  ["review.enabled", (v) => typeof v === "boolean", "true or false"],
  ["review.provider", (v) => ["auto", "claude-cli", "codex-cli", "anthropic-api", "openai-api", "openai-compatible", "none"].includes(v), "a known provider"],
  ["review.timeoutMs", isPositiveInt, "a positive integer (ms)"],
  ["review.maxChars", isPositiveInt, "a positive integer"],
  ["review.onError", (v) => v === "escalate" || v === "allow", '"escalate" or "allow"'],
  ["escalation.mode", (v) => ["interactive", "agent", "block"].includes(v), '"interactive", "agent", or "block"'],
  ["escalation.excerptChars", isPositiveInt, "a positive integer"],
  ["quarantine.allowTtlHours", isNonNegativeNumber, "a non-negative number"],
  ["quarantine.denyTtlHours", isNonNegativeNumber, "a non-negative number"],
  ["quarantine.maxEntries", isPositiveInt, "a positive integer"],
  ["scan.includeRawHtml", (v) => typeof v === "boolean", "true or false"],
  ["scan.maxContentBytes", isPositiveInt, "a positive integer"],
  ["fetch.timeoutMs", isPositiveInt, "a positive integer (ms)"],
  ["fetch.maxRedirects", (v) => Number.isInteger(v) && v >= 0, "a non-negative integer"],
];

function isProbability(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
}
function isPositiveInt(v) {
  return Number.isInteger(v) && v > 0;
}
function isNonNegativeNumber(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

const KNOWN_FILTERS = new Set(["regex", "lightgbm", "wolf"]);
const ALLOWED_REGEX_FLAGS = /^[imsu]*$/;

export class ConfigError extends Error {}

/**
 * Load the effective config: defaults <- global file <- project file <-
 * PROMPT_BUSTER_CONFIG <- overrides. Every layer is validated after merge.
 */
export function loadConfig({ cwd = process.cwd(), overrides = null } = {}) {
  const layers = [defaultConfig()];
  const sources = ["defaults"];

  const globalPath = configPath();
  if (existsSync(globalPath)) {
    layers.push(readConfigFile(globalPath));
    sources.push(globalPath);
  }

  const projectWarnings = [];
  const projectPath = findProjectConfig(cwd);
  if (projectPath) {
    const rawProject = readConfigFile(projectPath);
    // SECURITY: a project .prompt-buster.json can be attacker-controlled (an
    // agent may scan inside a hostile cloned repo). If PB honored its
    // filters.custom command classifiers, review.baseUrl/apiKeyEnv, wolf http
    // url, or prefilters.order, a repo could achieve code execution or key
    // exfiltration just by being scanned. So the project layer is restricted to
    // a safe allowlist unless the user explicitly opts in.
    const trustProject = process.env.PROMPT_BUSTER_ALLOW_PROJECT_CONFIG === "1";
    const sanitized = trustProject ? rawProject : sanitizeUntrustedLayer(rawProject, projectWarnings);
    layers.push(sanitized);
    sources.push(projectPath + (trustProject ? " (trusted)" : " (restricted)"));
  }

  const envPath = process.env.PROMPT_BUSTER_CONFIG;
  if (envPath && envPath.trim()) {
    const resolved = path.resolve(envPath.trim());
    if (!existsSync(resolved)) throw new ConfigError(`PROMPT_BUSTER_CONFIG points to a missing file: ${resolved}`);
    layers.push(readConfigFile(resolved));
    sources.push(resolved);
  }

  if (overrides && typeof overrides === "object") {
    layers.push(overrides);
    sources.push("overrides");
  }

  const merged = layers.reduce((acc, layer) => deepMerge(acc, layer), {});
  const warnings = validateConfig(merged);
  merged._meta = { sources, warnings: [...projectWarnings, ...warnings] };
  return merged;
}

/**
 * Keys a project-level config MAY set. Everything else (filters, review,
 * escalation, prefilter chain, quarantine.dir, daemon, fetch) is dropped from
 * the project layer with a warning — a project can only tune cosmetics, never
 * weaken the firewall or introduce code-exec / egress. Opt out with
 * PROMPT_BUSTER_ALLOW_PROJECT_CONFIG=1.
 */
const PROJECT_ALLOWLIST = new Set(["scan.includeRawHtml", "scan.maxContentBytes", "log.level"]);

export function sanitizeUntrustedLayer(rawConfig, warnings) {
  const safe = {};
  for (const dotted of PROJECT_ALLOWLIST) {
    const value = getPath(rawConfig, dotted);
    if (value !== undefined) setPath(safe, dotted, value);
  }
  const dropped = collectLeafPaths(rawConfig).filter((p) => !isAllowed(p));
  if (dropped.length) {
    warnings.push(
      `project config: ignored ${dropped.length} security-relevant key(s) [${dropped.slice(0, 8).join(", ")}${dropped.length > 8 ? ", …" : ""}] — set PROMPT_BUSTER_ALLOW_PROJECT_CONFIG=1 to trust this project's full config`,
    );
  }
  return safe;
}

function isAllowed(dotted) {
  if (PROJECT_ALLOWLIST.has(dotted)) return true;
  // Allow a prefix whose full leaf is allowlisted (e.g. "scan" container).
  for (const allowed of PROJECT_ALLOWLIST) {
    if (allowed.startsWith(dotted + ".")) return true;
  }
  return false;
}

function collectLeafPaths(obj, prefix = "") {
  const paths = [];
  for (const [key, value] of Object.entries(obj || {})) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      paths.push(...collectLeafPaths(value, dotted));
    } else {
      paths.push(dotted);
    }
  }
  return paths;
}

export function readConfigFile(file) {
  let raw;
  try {
    raw = readFileSync(file, "utf-8");
  } catch (error) {
    throw new ConfigError(`cannot read config ${file}: ${error.message}`);
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("top level must be an object");
    }
    return parsed;
  } catch (error) {
    throw new ConfigError(`invalid JSON in ${file}: ${error.message}`);
  }
}

function findProjectConfig(cwd) {
  let dir = path.resolve(cwd);
  for (;;) {
    const candidate = path.join(dir, ".prompt-buster.json");
    if (existsSync(candidate)) return candidate;
    // Stop at a repo boundary or filesystem root.
    if (existsSync(path.join(dir, ".git"))) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function deepMerge(base, layer) {
  if (layer === null || layer === undefined) return base;
  if (Array.isArray(base) || Array.isArray(layer) || typeof base !== "object" || typeof layer !== "object") {
    return layer;
  }
  const out = { ...base };
  for (const [key, value] of Object.entries(layer)) {
    out[key] = key in base ? deepMerge(base[key], value) : value;
  }
  return out;
}

/** Throws ConfigError on hard violations; returns warnings for soft ones. */
export function validateConfig(config) {
  const warnings = [];

  for (const [dotted, check, expectation] of VALIDATORS) {
    const value = getPath(config, dotted);
    if (value !== undefined && !check(value)) {
      throw new ConfigError(`config ${dotted} must be ${expectation} (got ${JSON.stringify(value)})`);
    }
  }

  for (const name of config.prefilters.order) {
    const isCustom = (config.filters.custom || []).some((c) => c?.name === name);
    if (!KNOWN_FILTERS.has(name) && !isCustom) {
      throw new ConfigError(`prefilters.order names unknown filter "${name}" (known: regex, lightgbm, wolf, or a filters.custom name)`);
    }
  }

  for (const spec of config.filters.regex.custom) {
    validateCustomPattern(spec);
  }

  for (const clf of config.filters.custom) {
    if (!clf || typeof clf !== "object") throw new ConfigError("filters.custom entries must be objects");
    if (typeof clf.name !== "string" || !clf.name) throw new ConfigError("filters.custom entries need a name");
    if (clf.type === "http") {
      if (typeof clf.url !== "string" || !/^https?:\/\//.test(clf.url)) {
        throw new ConfigError(`custom classifier "${clf.name}": http type needs a valid url`);
      }
    } else if (clf.type === "command") {
      if (typeof clf.command !== "string" || !clf.command) {
        throw new ConfigError(`custom classifier "${clf.name}": command type needs a command`);
      }
      if (clf.args !== undefined && (!Array.isArray(clf.args) || !clf.args.every((a) => typeof a === "string"))) {
        throw new ConfigError(`custom classifier "${clf.name}": args must be an array of strings`);
      }
    } else {
      throw new ConfigError(`custom classifier "${clf.name}": type must be "http" or "command"`);
    }
    if (clf.threshold !== undefined && !isProbability(clf.threshold)) {
      throw new ConfigError(`custom classifier "${clf.name}": threshold must be in [0,1]`);
    }
  }

  if (config.filters.wolf.mode === "http" && !config.filters.wolf.http.url) {
    warnings.push('filters.wolf.mode is "http" but filters.wolf.http.url is empty — the wolf filter will error');
  }

  return warnings;
}

export function validateCustomPattern(spec) {
  if (!spec || typeof spec !== "object") throw new ConfigError("custom regex pattern entries must be objects");
  for (const field of ["id", "pattern"]) {
    if (typeof spec[field] !== "string" || !spec[field]) {
      throw new ConfigError(`custom regex pattern missing "${field}"`);
    }
  }
  const flags = spec.flags ?? "i";
  if (typeof flags !== "string" || !ALLOWED_REGEX_FLAGS.test(flags)) {
    throw new ConfigError(`custom pattern "${spec.id}": flags must only contain i, m, s, u`);
  }
  try {
    new RegExp(spec.pattern, flags);
  } catch (error) {
    throw new ConfigError(`custom pattern "${spec.id}" does not compile: ${error.message}`);
  }
}

/** Load extra user pattern files from ~/.prompt-buster/patterns.d/*.json */
export function loadUserPatternFiles() {
  const dir = patternsDir();
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith(".json")) continue;
    const file = path.join(dir, entry);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(file, "utf-8"));
    } catch (error) {
      throw new ConfigError(`invalid pattern file ${file}: ${error.message}`);
    }
    if (!Array.isArray(parsed)) throw new ConfigError(`pattern file ${file} must contain a JSON array`);
    for (const spec of parsed) {
      validateCustomPattern(spec);
      out.push(spec);
    }
  }
  return out;
}

export function getPath(obj, dotted) {
  return dotted.split(".").reduce((acc, key) => (acc === undefined || acc === null ? undefined : acc[key]), obj);
}

export function setPath(obj, dotted, value) {
  const keys = dotted.split(".");
  let node = obj;
  for (const key of keys.slice(0, -1)) {
    if (typeof node[key] !== "object" || node[key] === null) node[key] = {};
    node = node[key];
  }
  node[keys.at(-1)] = value;
}

/** Persist a value into the global config file (used by `config set`). */
export function saveGlobalConfigValue(dotted, value) {
  ensureDir(pbHome());
  const file = configPath();
  const current = existsSync(file) ? readConfigFile(file) : {};
  setPath(current, dotted, value);
  // Validate the merged result before persisting a broken config.
  const merged = deepMerge(defaultConfig(), current);
  validateConfig(merged);
  writeFileSync(file, JSON.stringify(current, null, 2) + "\n");
  return file;
}

export function deleteGlobalConfigValue(dotted) {
  const file = configPath();
  if (!existsSync(file)) return file;
  const current = readConfigFile(file);
  const keys = dotted.split(".");
  let node = current;
  for (const key of keys.slice(0, -1)) {
    if (typeof node[key] !== "object" || node[key] === null) return file;
    node = node[key];
  }
  delete node[keys.at(-1)];
  writeFileSync(file, JSON.stringify(current, null, 2) + "\n");
  return file;
}
