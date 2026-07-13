# AGENTS.md — building on PromptBuster

Guidance for any coding agent working in this repo. Human-facing docs are in
`README.md` and `docs/`; the design record is in `.planning/`.

## Commands

- `npm test` — full suite (`node:test`, zero-dep). Runs a manifest drift check
  first (`pretest`). Use `node --test` directly (NOT `node --test test/` — that
  form breaks on Node 22).
- `node bin/prompt-buster.mjs <command>` — run the CLI locally.
- Regenerate LightGBM golden vectors (only when the model or feature code
  changes; needs Python):
  `.venv/Scripts/python scripts/golden/generate.py`. The fixture is committed;
  the JS suite does not need Python.
- `npm run generate-manifests` — regenerate `.claude-plugin/*` from
  `package.json` (never hand-edit those files).

## Conventions (non-negotiable)

- **Node ≥ 18, plain ESM.** `.mjs` for `bin/` and files copied out of the
  package (hook, generators); `"type": "module"` + `.js` inside `lib/`.
- **Zero runtime dependencies** in `package.json` (`dependencies: {}`). The Wolf
  runtime installs on demand into `~/.prompt-buster/runtime/`, never as a
  package dep.
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

## Where things live

See `docs/ARCHITECTURE.md`. One engine (`lib/engine/pipeline.js`), many thin
adapters (`lib/commands/`, `hooks/`, `integrations/`, `lib/mcp/`).
