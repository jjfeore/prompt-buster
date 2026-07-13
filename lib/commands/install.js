import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseCommandArgs } from "../args.js";
import { emit, outputMode, EXIT } from "../output.js";
import { packageRoot, installManifestPath, ensureDir } from "../paths.js";
import { pkgVersion } from "./version.js";

/**
 * Per-harness installer. Copies the agentskills.io skill into each harness's
 * expected location and deploys integration files (OpenCode plugin, Hermes
 * shim). Idempotent and manifest-tracked: a destination holding foreign
 * content is refused (not overwritten) unless --force; uninstall removes
 * exactly what the manifest recorded. Multi-target runs continue past refusals
 * and exit 6 if any target refused.
 */

const TARGETS = ["claude", "codex", "openclaw", "hermes", "opencode"];

export async function run(argv, { command } = {}) {
  const { flags } = parseCommandArgs(argv, {
    claude: { type: "boolean" },
    codex: { type: "boolean" },
    openclaw: { type: "boolean" },
    hermes: { type: "boolean" },
    opencode: { type: "boolean" },
    all: { type: "boolean" },
    global: { type: "boolean" },
    project: { type: "boolean" },
    force: { type: "boolean" },
  });
  const mode = outputMode(flags);
  const selected = flags.all ? TARGETS : TARGETS.filter((t) => flags[t]);
  if (!selected.length) {
    emit({ error: "no target selected", targets: TARGETS }, { mode, text: `select at least one: ${TARGETS.map((t) => `--${t}`).join(" ")} (or --all)` });
    return EXIT.USAGE;
  }
  const scope = flags.project ? "project" : "global";

  const results = [];
  for (const target of selected) {
    results.push(command === "uninstall" ? uninstallTarget(target, scope) : installTarget(target, scope, flags.force));
  }

  const problems = results.filter((r) => r.status === "refused" || r.status === "error");
  emit({ command, scope, results }, { mode, text: renderResults(command, results) });
  return problems.length ? EXIT.PARTIAL_REFUSAL : EXIT.OK;
}

function skillSource() {
  return path.join(packageRoot(), "skills", "prompt-buster");
}

function harnessSkillDirs(target, scope) {
  const home = homedir();
  const cwd = process.cwd();
  const dirs = [];
  switch (target) {
    case "claude":
      dirs.push(scope === "project" ? path.join(cwd, ".claude", "skills", "prompt-buster") : path.join(home, ".claude", "skills", "prompt-buster"));
      break;
    case "codex":
      // Dual-path: official .agents chain AND community ~/.codex.
      if (scope === "project") {
        dirs.push(path.join(cwd, ".agents", "skills", "prompt-buster"));
      } else {
        dirs.push(path.join(home, ".agents", "skills", "prompt-buster"), path.join(home, ".codex", "skills", "prompt-buster"));
      }
      break;
    case "openclaw":
      dirs.push(scope === "project" ? path.join(cwd, "skills", "prompt-buster") : path.join(home, ".openclaw", "skills", "prompt-buster"));
      break;
    case "hermes":
      dirs.push(path.join(home, ".hermes", "skills", "prompt-buster"));
      break;
    case "opencode":
      dirs.push(scope === "project" ? path.join(cwd, ".opencode", "skills", "prompt-buster") : path.join(configHome(), "opencode", "skills", "prompt-buster"));
      break;
    default:
      break;
  }
  return dirs;
}

function configHome() {
  return process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config");
}

function installTarget(target, scope, force) {
  const written = [];
  const notes = [];
  // Roll back anything already written so a partial install never leaves files
  // the manifest doesn't record (which uninstall could never remove).
  const rollback = () => {
    for (const p of written) {
      try {
        rmSync(p, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  };
  try {
    for (const dir of harnessSkillDirs(target, scope)) {
      const refusal = copySkill(dir, force);
      if (refusal) {
        rollback();
        return { target, scope, status: "refused", reason: refusal };
      }
      written.push(dir);
    }

    // Harness-specific integration files.
    if (target === "opencode") {
      const pluginPath = scope === "project" ? path.join(process.cwd(), ".opencode", "plugins", "prompt-buster.js") : path.join(configHome(), "opencode", "plugins", "prompt-buster.js");
      const refusal = writeManaged(pluginPath, openCodePluginStub(), force);
      if (refusal) {
        rollback();
        return { target, scope, status: "refused", reason: refusal };
      }
      written.push(pluginPath);
      notes.push(opencodeSnippet());
    }
    if (target === "hermes") {
      const pluginDir = path.join(homedir(), ".hermes", "plugins", "prompt-buster");
      const refusal = copyHermesShim(pluginDir, force);
      if (refusal) {
        rollback();
        return { target, scope, status: "refused", reason: refusal };
      }
      written.push(pluginDir);
      notes.push(hermesSnippet());
    }
    if (target === "codex") notes.push(codexSnippet());
    if (target === "openclaw") notes.push(openclawSnippet());
    if (target === "claude") notes.push(claudeSnippet());

    recordManifest(target, scope, written);
    return { target, scope, status: "installed", written, notes };
  } catch (error) {
    rollback();
    return { target, scope, status: "error", reason: String(error?.message || error) };
  }
}

function uninstallTarget(target, scope) {
  const manifest = readManifest();
  const key = `${target}:${scope}`;
  const record = manifest[key];
  if (!record) return { target, scope, status: "not-installed" };
  const removed = [];
  for (const entry of record.paths) {
    if (existsSync(entry)) {
      rmSync(entry, { recursive: true, force: true });
      removed.push(entry);
    }
  }
  delete manifest[key];
  writeManifest(manifest);
  return { target, scope, status: "uninstalled", removed };
}

const MANAGED_MARKER = "prompt-buster";

function copySkill(destDir, force) {
  if (existsSync(destDir)) {
    // Ours if it contains our SKILL.md; otherwise foreign.
    const skillFile = path.join(destDir, "SKILL.md");
    if (!existsSync(skillFile) || !readFileSync(skillFile, "utf-8").includes("name: prompt-buster")) {
      if (!force) return `destination holds foreign content: ${destDir}`;
    }
    rmSync(destDir, { recursive: true, force: true });
  }
  mkdirSync(path.dirname(destDir), { recursive: true });
  cpSync(skillSource(), destDir, { recursive: true });
  return null;
}

function copyHermesShim(destDir, force) {
  const src = path.join(packageRoot(), "integrations", "hermes");
  if (existsSync(destDir)) {
    const initFile = path.join(destDir, "__init__.py");
    if (!existsSync(initFile) || !readFileSync(initFile, "utf-8").includes("PromptBuster shim")) {
      if (!force) return `destination holds foreign content: ${destDir}`;
    }
    rmSync(destDir, { recursive: true, force: true });
  }
  mkdirSync(path.dirname(destDir), { recursive: true });
  cpSync(src, destDir, { recursive: true });
  // Bake the absolute CLI path into the shim so it works regardless of PATH.
  const initFile = path.join(destDir, "__init__.py");
  const cliPath = path.join(packageRoot(), "bin", "prompt-buster.mjs");
  const patched = readFileSync(initFile, "utf-8").replace(
    'PROMPT_BUSTER_CLI = os.environ.get("PROMPTBUSTER_CLI", "prompt-buster")',
    `PROMPT_BUSTER_CLI = os.environ.get("PROMPTBUSTER_CLI", ${JSON.stringify(cliPath)})`,
  );
  writeFileSync(initFile, patched);
  return null;
}

function writeManaged(filePath, content, force) {
  if (existsSync(filePath)) {
    if (!readFileSync(filePath, "utf-8").includes(MANAGED_MARKER) && !force) {
      return `destination holds foreign content: ${filePath}`;
    }
  }
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  return null;
}

function openCodePluginStub() {
  // Self-contained loader so the plugin works even if the npm package layout
  // isn't resolvable from the OpenCode plugins dir.
  const enginePath = path.join(packageRoot(), "integrations", "opencode", "index.js");
  return `// prompt-buster OpenCode plugin (managed by: prompt-buster install --opencode)\n` + `export { PromptBusterPlugin as default } from ${JSON.stringify(enginePath.replace(/\\/g, "/"))};\n`;
}

// --- manifest ---

function readManifest() {
  const file = installManifestPath();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return {};
  }
}
function writeManifest(manifest) {
  ensureDir(path.dirname(installManifestPath()));
  writeFileSync(installManifestPath(), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
}
function recordManifest(target, scope, paths) {
  const manifest = readManifest();
  manifest[`${target}:${scope}`] = { version: pkgVersion(), installedAt: new Date().toISOString(), paths };
  writeManifest(manifest);
}

// --- config snippets shown to the user (they choose to apply) ---

function claudeSnippet() {
  return "Claude Code: for enforced interception, install the plugin instead —\n  /plugin marketplace add jjfeore/prompt-buster\n  /plugin install prompt-buster@prompt-buster";
}
function codexSnippet() {
  return "Codex: add to ~/.codex/config.toml (native web_search is not hookable):\n  web_search = \"disabled\"\n  [mcp_servers.prompt-buster]\n  command = \"npx\"\n  args = [\"-y\", \"prompt-buster\", \"mcp\"]";
}
function openclawSnippet() {
  return "OpenClaw: add to openclaw.json:\n  {\"tools\":{\"web\":{\"search\":{\"enabled\":false},\"fetch\":{\"enabled\":false}}},\n   \"mcp\":{\"servers\":{\"prompt-buster\":{\"command\":\"npx\",\"args\":[\"-y\",\"prompt-buster\",\"mcp\"]}}}}";
}
function hermesSnippet() {
  return "Hermes: enable in ~/.hermes/config.yaml:\n  plugins:\n    enabled: [prompt-buster]\n  mcp_servers:\n    prompt-buster: { command: \"npx\", args: [\"-y\", \"prompt-buster\", \"mcp\"] }";
}
function opencodeSnippet() {
  return "OpenCode: the plugin file is installed. To also register the MCP server, add to opencode.json:\n  \"mcp\":{\"prompt-buster\":{\"type\":\"local\",\"command\":[\"npx\",\"-y\",\"prompt-buster\",\"mcp\"],\"enabled\":true}}";
}

function renderResults(command, results) {
  const lines = [];
  for (const r of results) {
    lines.push(`${r.target} [${r.scope}]: ${r.status}${r.reason ? ` — ${r.reason}` : ""}`);
    for (const w of r.written || r.removed || []) lines.push(`  ${command === "uninstall" ? "removed" : "wrote"}: ${w}`);
    for (const note of r.notes || []) lines.push(...note.split("\n").map((l) => `  ${l}`), "");
  }
  return lines.join("\n");
}
