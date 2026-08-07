# MIGRATION.md — publishing & distributing PromptBuster

Distribution is via the **skills CLI** (`npx skills add`), not npm. That means
there is no package to publish, no npm account, no 2FA, no trusted-publishing
config, and no name to squat — **making the repo public IS the release.**

The repo doubles as a Claude Code plugin, which is the one-command path for
Claude users who want enforced hooks. Steps tagged **James-only** need you.

## 0. What only James can do

- [ ] **Make the GitHub repo public** (that's the release) → §1
- [ ] **Confirm the LightGBM model license** — the vendored booster at
      `skills/prompt-buster/assets/models/lightgbm/model.txt` was trained inside
      Abeeo. Decide it's OK to publish under MIT, or swap it for a download
      step (§5).
- [ ] **Optional:** Claude marketplace community submission → §3
- [ ] **Optional:** ClawHub publish + its MIT-0 relicense decision → §4

## 1. Release = make the repo public

`github.com/jjfeore/prompt-buster` is already the remote. Once it's public:

```bash
npx skills@latest add jjfeore/prompt-buster -g
```

...installs PromptBuster into every supported agent. Nothing else required.

Before flipping it public:

1. **Regenerate the generated files** (never hand-edit them):
   ```bash
   npm run generate-manifests   # writes .claude-plugin/* and scripts/lib/version-info.js
   npm test                     # `pretest` fails if either has drifted
   ```
2. **Review `description` in `package.json`** — it flows into
   `.claude-plugin/plugin.json` and the marketplace card.
3. **`.planning/` is internal.** It stays in git for history but is *not* part
   of the skill (the skills CLI copies only `skills/prompt-buster/`). Delete it
   before going public if you'd rather it not be visible.

### Repo name note

`npx skills add jjfeore/prompt-buster` follows the repo name. If you'd rather
type `jjfeore/promptbuster`, rename the GitHub repo — the skill's own name
(`prompt-buster`, which must match its directory) is unaffected either way.

## 2. What ships, and what doesn't

The skills CLI copies **`skills/prompt-buster/` only**:

```
skills/prompt-buster/
├── SKILL.md              # entry point; agentskills.io frontmatter
├── references/           # CONFIG.md, HARNESSES.md
├── scripts/              # the whole engine: pb.mjs, pb-hook.mjs, lib/, integrations/
└── assets/               # models/lightgbm (1.6 MB), models/wolf/manifest.json, corpus/
```

~2 MB total — comfortably inside the skills CLI limits (10 MiB download /
25 MiB extracted / 1000 files).

Left behind at the repo root, by design: `test/`, `scripts/` (dev tooling),
`package.json`, `docs/`, and the Claude-plugin wrapper (`.claude-plugin/`,
`hooks/`, `.mcp.json`) — which only matters for the plugin channel (§3).

**Versioning:** the skill can't read `package.json`, so the version is mirrored
into `skills/prompt-buster/scripts/lib/version-info.js` by
`npm run generate-manifests`, and `npm test` fails on drift. Bump with
`npm version <patch|minor|major>` — the `version` lifecycle script regenerates
and stages both. Users update with `npx skills update prompt-buster`.

## 3. Claude Code plugin (optional, recommended)

The repo root is also a valid plugin, so Claude users get enforced hooks + MCP
in one step without running `pb install`:

```
/plugin marketplace add jjfeore/prompt-buster
/plugin install prompt-buster@prompt-buster
```

`hooks/hooks.json` and `.mcp.json` point into
`${CLAUDE_PLUGIN_ROOT}/skills/prompt-buster/scripts/`, so the plugin and the
skill share one engine.

Community distribution: submit at platform.claude.com/plugins/submit after
`claude plugin validate --strict` passes (the test suite runs it automatically
when the `claude` CLI is on PATH; loud-skips otherwise).

> **James-only:** the submission form.

## 4. ClawHub (optional)

```bash
npm i -g clawhub && clawhub login
clawhub skill publish ./skills/prompt-buster --slug prompt-buster \
  --name "PromptBuster" --version 0.1.0 --changelog "Initial release" --tags latest
```

Constraints: ≤ 50 MB, **text files only** — the 1.6 MB `model.txt` is text, so
this passes, but verify at publish time.

> **James-only — business decision:** ClawHub forcibly relicenses published
> skills **MIT-0**. Skipping it is fine: OpenClaw reads `~/.openclaw/skills/`
> natively and `pb install --openclaw` covers it.

## 5. If the vendored LightGBM model can't ship publicly

If you decide not to publish `assets/models/lightgbm/model.txt` under MIT:

1. Remove it from the repo.
2. Host it as a GitHub release asset (or anywhere you control).
3. Change `pb setup lightgbm` from a vendored-check to a download +
   sha256-verify step — mirror `downloadModel` in
   `skills/prompt-buster/scripts/lib/engine/filters/wolf.js`, which already does
   exactly this (pinned revision, per-file sha256, verify-before-rename).
4. The `lightgbm` filter then reports "not set up" until `pb setup lightgbm` runs.

The regex filter and Wolf are unaffected.

## 6. CI

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
The golden-vector fixture is committed, so CI needs no Python. **No publish
workflow is needed** — there's nothing to publish.

## 7. Re-verify at release time

- `npx skills add jjfeore/prompt-buster --list` resolves and shows the skill.
- A clean-machine smoke test: install the skill, then
  `node <skill>/scripts/pb.mjs doctor` → regex + lightgbm report ready.
- `pb install --claude` on a machine where the skill is already in
  `~/.claude/skills/` must report *installed* without destroying itself (there's
  a regression test for this, but verify once for real).
- Harness contracts drift — `docs/HARNESSES.md` records the versions each
  adapter was verified against (2026-07-12). Re-check on major upgrades.
- The `gpt-5.5-nano` / model-id defaults in `review.js` — confirm against the
  current model list.
