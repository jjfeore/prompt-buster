# AGENTS.md — building on PromptBuster

Guidance for any coding agent working in this repo. Human-facing docs are in
`README.md` and `docs/`; the design record is in `.planning/`.

## Distribution model (read this first)

PromptBuster ships as an **agent skill** via `npx skills add jjfeore/prompt-buster`,
NOT via npm. The skills CLI copies `skills/prompt-buster/` and nothing else, so:

- **The engine lives inside the skill**: `skills/prompt-buster/scripts/` (code)
  and `skills/prompt-buster/assets/` (model, corpus).
- **Never resolve a runtime path relative to the repo root.** Use
  `paths.js` → `skillRoot()`, `assetsDir()`, `cliEntryPath()`. Anything else
  breaks once the skill is installed elsewhere.
- The repo root (`test/`, `scripts/`, `package.json`, `docs/`) is dev-only and
  is NOT available at runtime. `package.json` is `private: true`.
- Version lives in `scripts/lib/version-info.js` (generated), because the skill
  cannot read `package.json`.

## Commands

- `npm test` — full suite (`node:test`, zero-dep). Runs a generated-file drift
  check first (`pretest`). Use `node --test` directly (NOT `node --test test/` —
  that form breaks on Node 22).
- `node skills/prompt-buster/scripts/pb.mjs <command>` — run the CLI locally.
- Regenerate LightGBM golden vectors (only when the model or feature code
  changes; needs Python):
  `.venv/Scripts/python scripts/golden/generate.py`. The fixture is committed;
  the JS suite does not need Python.
- `npm run generate-manifests` — regenerate `.claude-plugin/*` **and**
  `version-info.js` from `package.json` (never hand-edit those files).

## Conventions (non-negotiable)

- **Node ≥ 18, plain ESM.** `.mjs` for entry points that get invoked directly
  (`pb.mjs`, `pb-hook.mjs`, generators); `.js` inside `lib/`.
- **Zero runtime dependencies.** The skill vendors everything it needs. The Wolf
  runtime installs on demand into `~/.prompt-buster/runtime/`, never as a dep.
- **Never `shell: true` with content-derived args; never `eval`.** Scanned
  content is hostile. Use `execFile`. Build the SSHSIG-style canonical strings
  and paths with explicit `\n` / `path.join`.
- **Machine-JSON output contract.** Commands emit JSON by default (text on a
  TTY). No color/formatting deps.
- **Windows is a first-class target.** Use `path.join`, `os.homedir()`, 0600 on
  sensitive files (best-effort — ignored on Windows).

## Security invariants (do not weaken)

- The stage-3 reviewer can only ever return `allow` or `escalate`; anything
  malformed escalates. Never let it take other actions.
- Filter-availability errors fail per `failMode`; flagged content never
  silently passes because the reviewer errored (`review.onError` default
  `escalate`).
- The allow/deny decision cache is written atomically; a corrupt file fails
  safe (no silent allow, deny never dropped).
- Project `.prompt-buster.json` is untrusted: only cosmetic keys are honored
  (see `sanitizeUntrustedLayer` in `lib/config.js`).
- The LightGBM port must match the Python reference to ≤1e-6 — if you touch
  `lightgbm-features.js` or `lightgbm-model.js`, regenerate golden vectors and
  keep `test/lightgbm.test.mjs` green.

- The installer must never copy the skill onto itself. After a skills-CLI
  install the destination IS the running skill; `isSelf()` in
  `commands/install.js` guards this (regression-tested).

## Where things live

See `docs/ARCHITECTURE.md`. One engine
(`skills/prompt-buster/scripts/lib/engine/pipeline.js`), many thin adapters
(`lib/commands/`, `hooks/`, `scripts/integrations/`, `lib/mcp/`).
