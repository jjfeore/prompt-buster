import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";

// Redirect HOME so installs land in a temp dir. PB home too.
const sandbox = mkdtempSync(path.join(tmpdir(), "pb-install-"));
const fakeHome = path.join(sandbox, "home");
mkdirSync(fakeHome, { recursive: true });
process.env.PROMPT_BUSTER_HOME = path.join(sandbox, "pbhome");
const realHome = homedir();

// The installer reads homedir() live; override via HOME/USERPROFILE.
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome;
process.env.XDG_CONFIG_HOME = path.join(fakeHome, ".config");

const { run } = await import("../skills/prompt-buster/scripts/lib/commands/install.js");

test("install --hermes writes skill + shim with baked CLI path", async () => {
  const code = await run(["--hermes", "--global", "--output", "json"], { command: "install" });
  assert.equal(code, 0);
  const skill = path.join(fakeHome, ".hermes", "skills", "prompt-buster", "SKILL.md");
  const shim = path.join(fakeHome, ".hermes", "plugins", "prompt-buster", "__init__.py");
  assert.ok(existsSync(skill), "skill installed");
  assert.ok(existsSync(shim), "hermes shim installed");
  assert.ok(readFileSync(shim, "utf-8").includes("prompt-buster.mjs"), "CLI path baked into shim");
});

test("install --codex writes both skill dirs", async () => {
  await run(["--codex", "--global"], { command: "install" });
  assert.ok(existsSync(path.join(fakeHome, ".agents", "skills", "prompt-buster", "SKILL.md")));
  assert.ok(existsSync(path.join(fakeHome, ".codex", "skills", "prompt-buster", "SKILL.md")));
});

test("install is idempotent (re-install ours succeeds)", async () => {
  const first = await run(["--openclaw", "--global"], { command: "install" });
  const second = await run(["--openclaw", "--global"], { command: "install" });
  assert.equal(first, 0);
  assert.equal(second, 0);
});

test("install refuses to overwrite foreign content and exits 6", async () => {
  const dir = path.join(fakeHome, ".openclaw", "skills", "prompt-buster");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), "someone else's skill");
  const code = await run(["--openclaw", "--global"], { command: "install" });
  assert.equal(code, 6, "refusal exits 6");
  assert.equal(readFileSync(path.join(dir, "SKILL.md"), "utf-8"), "someone else's skill", "foreign content untouched");
});

test("uninstall removes exactly what was installed", async () => {
  await run(["--hermes", "--global"], { command: "install" });
  const skillDir = path.join(fakeHome, ".hermes", "skills", "prompt-buster");
  assert.ok(existsSync(skillDir));
  const code = await run(["--hermes", "--global"], { command: "uninstall" });
  assert.equal(code, 0);
  assert.ok(!existsSync(skillDir), "skill removed on uninstall");
});

test("--force overwrites foreign content", async () => {
  const dir = path.join(fakeHome, ".openclaw", "skills", "prompt-buster");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), "foreign");
  const code = await run(["--openclaw", "--global", "--force"], { command: "install" });
  assert.equal(code, 0);
  assert.ok(readFileSync(path.join(dir, "SKILL.md"), "utf-8").includes("name: prompt-buster"));
});

test("SECURITY: installing into the skill's own location does not delete it", async () => {
  // After `npx skills add`, the skill already lives in the agent's skills dir.
  // Re-running install must detect self and skip, never rmSync its own source.
  const { fileURLToPath } = await import("node:url");
  const skillRoot = path.resolve(fileURLToPath(new URL("../skills/prompt-buster/", import.meta.url)));

  // Point Claude's global skills dir at the real skill root by faking HOME so
  // that ~/.claude/skills/prompt-buster resolves onto the source itself.
  const claudeSkills = path.join(fakeHome, ".claude", "skills");
  mkdirSync(claudeSkills, { recursive: true });
  const link = path.join(claudeSkills, "prompt-buster");
  rmSync(link, { recursive: true, force: true });
  try {
    symlinkSync(skillRoot, link, "junction");
  } catch {
    return; // symlink/junction unavailable (needs privileges) — skip
  }

  const code = await run(["--claude", "--global"], { command: "install" });
  assert.ok(existsSync(path.join(skillRoot, "SKILL.md")), "the skill's own SKILL.md still exists");
  assert.ok(existsSync(path.join(skillRoot, "scripts", "pb.mjs")), "the engine still exists");
  assert.ok(code === 0 || code === 6, "install completes without destroying itself");
  rmSync(link, { recursive: true, force: true });
});

test.after(() => {
  process.env.HOME = realHome;
  rmSync(sandbox, { recursive: true, force: true });
});
