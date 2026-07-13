# MIGRATION.md — publishing & distributing PromptBuster

This repo (`C:\Users\jjfeo\Repos\prompt-buster`, remote
`github.com/jjfeore/prompt-buster`) is already structured to be **one artifact
served through five channels**: it is simultaneously an npm package, a Claude
Code plugin, a Hermes tap, and an agentskills.io skill source. Everything below
is copy-pasteable. Steps tagged **James-only** need you.

Nothing in this file requires committing a secret.

## 0. What only James can do

- [ ] **npm account + 2FA**, and pick the final package name → §2
- [ ] **Confirm the LightGBM model license** — the vendored booster
      (`models/lightgbm/model.txt`) was trained inside Abeeo. Decide it's OK to
      publish under MIT in a public repo, OR swap it for a download step (§6).
- [ ] **ClawHub login + the MIT-0 relicense decision** → §5
- [ ] **Claude marketplace submission** (community form) → §3
- [ ] **Optionally link the repo from abeeo.ai / your site** → §8

## 1. The repo is already public-ready

The remote is already `github.com/jjfeore/prompt-buster`. Before the first
release:

1. **Regenerate the plugin manifests** (they're generated from `package.json`,
   never hand-edited):
   ```bash
   npm run generate-manifests
   git add .claude-plugin && git commit -m "chore: manifests"
   ```
   `npm test` runs a `pretest` drift check that fails if they're stale.
2. **Review the `description` in `package.json`** — it flows verbatim into the
   npm listing, the Claude marketplace card, and ClawHub. Regenerate manifests
   if you change it.
3. **`.planning/` is internal.** It's excluded from the npm tarball by the
   `files` allowlist (verify with `npm pack --dry-run`). Keep it in git for
   history, or move it out before publishing the repo — your call; it does not
   ship to npm either way.

## 2. npm

Both `prompt-buster` and `promptbuster` were unclaimed on 2026-07-12.
**Re-check at publish time**: `npm view prompt-buster` returning E404 means it's
still free.

| Option | Trade-off |
|---|---|
| `prompt-buster` (current name) | Matches the repo and bin; zero renames. |
| `@jjfeore/prompt-buster` (scoped) | Namespace safety; scoped packages default private, so the **first publish needs `npm publish --access public`**. |

> **James-only:** create/confirm the npm account, enable 2FA, pick the name
> (renaming after first publish means a new package).

**Publish with trusted publishing (OIDC) — no npm token anywhere.** GA since
July 2025; needs npm CLI ≥ 11.5.1; auto-generates provenance. Configure the
trusted publisher on npmjs.com (package settings → trusted publishing) pointing
at this repo and the exact workflow file below. Configs created after
2026-05-20 must explicitly select the allowed workflow.

Version/release flow:
```bash
npm version <patch|minor|major>   # bumps package.json, runs the `version` script
                                   # (regenerates manifests + git-adds them), tags
git push --follow-tags             # the v* tag triggers the publish workflow (§7)
```

## 3. Claude Code marketplace

The repo root is a valid plugin (`.claude-plugin/plugin.json` + `hooks/` +
`.mcp.json` + `skills/`), and `marketplace.json` lists it, so direct installs
work the moment the repo is public:
```
/plugin marketplace add jjfeore/prompt-buster
/plugin install prompt-buster@prompt-buster
```
This is the **enforced** Claude path: the `PostToolUse` hook on
`WebFetch|WebSearch` rewrites flagged tool output, and the bundled MCP server
exposes `pb_fetch`/`pb_scan`.

Community distribution: submit at platform.claude.com/plugins/submit. Run
`claude plugin validate --strict` first (the test suite runs it automatically
when the `claude` CLI is on PATH; loud-skips otherwise).

> **James-only:** the marketplace submission form.

## 4. OpenCode / Codex (no publish step)

Both are covered by npm + the installer:
- `npx prompt-buster install --opencode` drops the plugin file; users can also
  add `"plugin": ["prompt-buster@<version>"]` to `opencode.json` (pin the
  version for supply-chain safety).
- `npx prompt-buster install --codex` writes the skill and prints the
  `~/.codex/config.toml` snippet (disable native `web_search`, register the PB
  MCP server). Codex requires the user to trust any hook via `/hooks`.

## 5. ClawHub (OpenClaw registry)

```bash
npm i -g clawhub
clawhub login    # GitHub auth; the account must be old enough to pass the gate
clawhub skill publish ./skills/prompt-buster --slug prompt-buster \
  --name "PromptBuster" --version 0.1.0 --changelog "Initial release" --tags latest
```
Constraints: bundle ≤ 50 MB, text files only, slug lowercase/npm-safe.

> **James-only — business decision:** ClawHub forcibly relicenses every
> published skill **MIT-0**. The package stays MIT; the skill bundle would be
> MIT-0. Skipping ClawHub is fine — OpenClaw reads `~/.openclaw/skills/`
> natively and `install --openclaw` covers it.

## 6. Hermes (tap — no publish step)

The repo is already tap-shaped (`skills/<name>/SKILL.md` at root):
```
hermes skills tap add jjfeore/prompt-buster
```
For enforced interception, `npx prompt-buster install --hermes` also writes the
Python shim plugin to `~/.hermes/plugins/prompt-buster/`; the user enables it in
`~/.hermes/config.yaml` (`plugins: {enabled: [prompt-buster]}`).

### If the vendored LightGBM model can't ship publicly

If you decide (see §0) not to publish `models/lightgbm/model.txt` under MIT:
1. Remove it from `files` in `package.json` and from git.
2. Host it somewhere you control (a GitHub release asset, your own bucket).
3. Change `prompt-buster setup lightgbm` from a vendored-check to a download +
   sha256-verify step (mirror `lib/engine/filters/wolf.js` `downloadModel`).
4. The `lightgbm` filter then reports "not set up" until `setup lightgbm` runs.
The regex filter and Wolf are unaffected.

## 7. CI

```yaml
# .github/workflows/test.yml
name: test
on: [push, pull_request]
jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
        node: [18, 20, 22, 24]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "${{ matrix.node }}" }
      - run: npm test
```
Windows in the matrix is non-negotiable (spawn/path handling is win32-sensitive).
The golden-vector fixture is committed, so CI needs no Python.

```yaml
# .github/workflows/publish.yml — trusted publishing, NO npm token secret
name: publish
on:
  push:
    tags: ["v*"]
permissions:
  id-token: write
  contents: read
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, registry-url: "https://registry.npmjs.org" }
      - run: npm install -g npm@latest   # trusted publishing needs npm >= 11.5.1
      - run: npm test
      - run: npm publish                 # OIDC; provenance automatic
```

## 8. Re-verify at authoring time

- `npm view prompt-buster` (name still free?).
- `npm pack --dry-run` → tarball contains `bin/ lib/ hooks/ scripts/pb-hook.mjs
  scripts/generate-manifests.mjs integrations/ skills/ .claude-plugin/ models/
  docs/` + README/LICENSE/package.json, and **no** `.planning/`, `.venv/`,
  `test/`, or credentials.
- Harness contracts drift — `docs/HARNESSES.md` records the versions each
  adapter was verified against (2026-07-12). Re-check on major harness upgrades;
  the adapters are thin, so only they change.
- The `gpt-5.5-nano` / model-id defaults in `review.js` are sensible today;
  confirm against the current model list and adjust `review.model` defaults if
  needed.
