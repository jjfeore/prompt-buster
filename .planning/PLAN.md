# PromptBuster — Implementation Plan

> Execution order for the overnight build. Each task lists its files, its
> dependencies, and DONE criteria. If you are a model resuming this work:
> `git log` shows which tasks are committed; run `node --test test/` before
> continuing; never mark a task done with failing tests.

Reference sources (read-only, in the Abeeo monorepo):
- Regex/evasion + pipeline semantics: `C:\Users\jjfeo\Abeeo\monorepo\backend\apps\common\prompt_injection.py`
- LightGBM features/runtime: `C:\Users\jjfeo\Abeeo\monorepo\backend\apps\common\prompt_lightgbm.py`
- Chunking: `C:\Users\jjfeo\Abeeo\monorepo\backend\apps\common\text_chunks.py`
- Wolf service: `C:\Users\jjfeo\Abeeo\monorepo\services\prompt_guard\{app.py,constants.py,model_manifest.json,download_model.py}`
- Model artifacts to vendor: `C:\Users\jjfeo\Abeeo\monorepo\backend\apps\common\ml_models\{lightgbm_prompt_prefilter_direct.txt,direct_model_metadata.json}`
- Conventions/installer/tests to imitate: `C:\Users\jjfeo\Abeeo\monorepo\plugin\` (esp. `lib/commands/install.js`, `lib/config.js`, `lib/output.js`, `test/install.test.mjs`, `MIGRATION.md`)
- Harness formats: `C:\Users\jjfeo\Abeeo\monorepo\.planning\research\HARNESS-FORMATS.md`

## Phase A — Foundation (sequential, commit "scaffold + core engine")

- **A1 scaffold**: package.json (name prompt-buster, `"type":"module"`, bin
  `./bin/prompt-buster.mjs`, `files: ["bin/","lib/","hooks/","scripts/pb-hook.mjs",
  "integrations/","skills/",".claude-plugin/","models/","docs/"]`, engines
  >=18, dependencies {}), .gitignore, .editorconfig, .gitattributes (`* text=auto eol=lf`),
  AGENTS.md (build/test/conventions for agents), bin dispatcher (runtime Node
  version check, command table, `--output` plumbing, JSON error envelope,
  exit codes 0/1/2/3/4/6).
- **A2 shared libs**: `lib/paths.js` (config dir `~/.prompt-buster`, override
  `PROMPT_BUSTER_HOME`; quarantine/models/runtime subdirs; 0700 best-effort),
  `lib/output.js` (json/text emitters — imitate abeeo kit), `lib/args.js`
  (parseArgs wrapper), `lib/config.js` (defaults + deep-merge + validation per
  SPEC §4), `lib/chunks.js` (port `overlapping_text_chunks`), `lib/sanitize.js`
  (ANSI/control stripping, secret redaction patterns, boundary wrapper,
  sha256 helper), `lib/http.js` (fetch with AbortSignal.timeout, redirect cap,
  size cap, content-type sniff).
- **A3 regex filter**: `lib/engine/filters/regex-patterns.js` (the 31-pattern
  catalogue as data — port every pattern string EXACTLY from
  prompt_injection.py `_PATTERNS`, translating Python regex → JS: `(?i)` flag
  → `i` flag; `｜` etc. stay; the two `flags=0` patterns are
  case-SENSITIVE — preserve that; `system_prefix_spoofing` needs `m` flag),
  `lib/engine/filters/regex.js` (candidate variants: raw, char-space-collapse,
  base64/hex decode with printable-ratio gate; encoded-keyword, char-spaced,
  typoglycemia detectors; dedupe by (detectorId, source); user
  custom/disabled pattern merge). Tests: per-detector trigger/no-trigger
  tables; evasion cases (`aWdub3JlIGFsbCBwcmV2aW91cyBpbnN0cnVjdGlvbnM=`,
  hex `69 67 6e 6f 72 65 ...`, `i g n o r e previous...`, `ignroe`),
  benign corpus non-triggering.
- **A4 pipeline + quarantine**: `lib/engine/pipeline.js` (stage orchestration
  per SPEC §3 incl. failMode/mode semantics, ScanResult shape, allow/deny
  sha256 TTL cache consult), `lib/engine/quarantine.js` (store/list/show/
  release/deny, audit.jsonl, maxEntries pruning, 0600). Tests with fake
  filters.
- **A5 CLI v1**: commands scan, config, patterns, doctor (partial), version,
  help wired; `prompt-buster scan --text "ignore all previous instructions"`
  exits 3 with findings JSON. Tests.

## Phase B — Classifiers (parallelizable after A2)

- **B1 lightgbm features**: `lib/engine/filters/lightgbm-features.js` — port
  `_text_stats_values`, `_bounded_text`, `_stable_hash` (table CRC32),
  n-gram iterators, `_direct_feature_counts` per SPEC §3-2b. Python-parity
  hazards documented in SPEC. Golden feature vectors must match EXACTLY.
- **B2 golden vectors**: `scripts/golden/generate.py` — self-contained
  (copies the feature functions from prompt_lightgbm.py verbatim, no Django;
  loads the vendored model with `lightgbm` pip) → writes
  `test/_fixtures/golden-vectors.json` for ~40 texts (see SPEC §10.1 mix).
  Run it once via a venv (`py -m venv`), commit the fixture. Record the
  lightgbm pip version inside the fixture.
- **B3 booster inference**: `lib/engine/filters/lightgbm-model.js` (text
  format parser + tree walker per SPEC decision_type semantics; assert
  num_cat==0, feature count == 12308, objective binary sigmoid; respect
  best_iteration=160) + `lightgbm.js` filter (chunk 4096/10%, max score).
  Vendor model files under `models/lightgbm/`. Tests: score parity ≤1e-6 on
  golden vectors; threshold behavior.
- **B4 wolf**: `lib/engine/filters/wolf.js` — three concerns:
  (1) `setup`: write `~/.prompt-buster/runtime/package.json`, `npm install
  onnxruntime-node @huggingface/transformers` (execFile npm, no shell —
  Windows: npm.cmd spawn caveat → use `process.execPath` + npm-cli.js
  resolution or shell:false-safe pattern from abeeo kit), download the 5
  files from `models/wolf/manifest.json` via
  `https://huggingface.co/<repo>/resolve/<revision>/<path>` streaming to
  disk with sha256 verify + atomic rename (port download_model.py).
  (2) `local` inference: createRequire against the runtime dir; AutoTokenizer
  from local dir; ort InferenceSession; int64 tensors; softmax; index 1.
  (3) `http` mode: Abeeo /classify client (port `_call_prompt_guard`).
  Tests: mocked ORT/tokenizer; manifest verify logic; http mode against a
  local stub server. Opt-in real test `PB_TEST_WOLF=1`.
- **B5 custom filters**: `lib/engine/filters/custom.js` (http + command per
  SPEC §3-2d). Tests with stub server + stub script.

## Phase C — Review + escalation UX (after A4)

- **C1 review stage**: `lib/engine/review.js` — provider registry, auto
  detection (cached probes), hardened prompt builder (random boundary),
  strict verdict parser (nonconforming ⇒ escalate), per-provider adapters:
  claude-cli, codex-cli, anthropic-api, openai-api, openai-compatible.
  Tests: execFile/fetch mocked; verdict-parsing adversarial cases (JSON in
  prose, fake verdict inside content boundary, refusals, timeouts).
- **C2 review/release CLI**: commands review (interactive: readline/promises,
  safe rendering, three-way choice), release/deny/quarantine. Tests
  (non-interactive paths; interactive via stdin scripting).

## Phase D — Integration surfaces (after A4; parallelizable)

- **D1 MCP server**: `lib/mcp/server.js` + `commands/mcp.js` per SPEC §6.
  Line-delimited JSON-RPC; tools with JSON Schema inputs; graceful unknown-
  method handling. Tests: spawn + scripted session.
- **D2 Claude hook**: `scripts/pb-hook.mjs` + `hooks/hooks.json` + `.mcp.json`
  per RESEARCH.md contracts. Handles WebFetch + WebSearch responses, applies
  released-content TTL, failMode on internal error, emits contract JSON.
  Fixture-driven tests.
- **D3 OpenCode plugin**: `integrations/opencode/index.js` per RESEARCH.md;
  package.json `exports` subpath. Unit test via direct import with fake
  hook input.
- **D4 fetch command**: `commands/fetch.js` + `lib/engine/extract.js`
  (HTML→text per SPEC D-13). Tests with fixture HTML (incl. hidden-text
  attack in comment/alt).
- **D5 skills**: `skills/prompt-buster/SKILL.md` (agentskills-compliant,
  name==dir, desc ≤1024) + `references/{USAGE.md,ESCALATION.md,CONFIG.md}`.
  Validated in tests (frontmatter regex, line caps).
- **D6 installer**: `commands/install.js` — targets claude (global plugin
  copy → `~/.claude/skills/prompt-buster/` scaffold incl. hooks + mcp,
  OR project `.claude/`), codex (both skill dirs + config.toml MCP snippet
  print/`--write-config`), openclaw, hermes, opencode (global skills +
  opencode.json snippet), `--all`; manifest tracking; refusal semantics from
  abeeo kit. Uninstall. Tests in tmp HOME (imitate abeeo install.test.mjs).
- **D7 manifests**: `scripts/generate-manifests.mjs` → `.claude-plugin/
  plugin.json` + `marketplace.json` from package.json; byte-equality test.

## Phase E — Hardening & ship (sequential)

- **E1 corpus self-test**: `test/_fixtures/corpus/` (~30 attack, ~30 benign,
  hand-written) + `commands/self-test.js` + quality-gate test (SPEC §10.7).
- **E2 docs**: README.md (quickstart per harness, pipeline diagram, config
  table), docs/{CONFIG.md, THREAT-MODEL.md, HARNESSES.md (verified-on dates),
  PROXY.md, ARCHITECTURE.md}.
- **E3 MIGRATION.md**: publish runbook — npm trusted publishing, marketplace
  submission, ClawHub (MIT-0 decision), Hermes tap, CI workflows (test.yml +
  publish.yml committed), James-only checklist (incl. D-7 model-license
  confirmation, npm name re-probe, repo settings).
- **E4 verification**: full `node --test test/`; `npm pack --dry-run` assert;
  `claude plugin validate` if available; adversarial code-review workflow;
  fix findings; final commit.

## Commit plan

1. `planning: spec, decisions, plan, research` (.planning/)
2. `scaffold: package, bin, shared libs` (A1-A2)
3. `engine: regex prefilter with evasion variants` (A3)
4. `engine: pipeline, quarantine, base CLI` (A4-A5)
5. `engine: pure-JS LightGBM classifier + golden vectors` (B1-B3)
6. `engine: wolf defender filter (local + http)` (B4-B5)
7. `engine: LLM review stage + escalation UX` (C1-C2)
8. `integrations: MCP server, Claude hooks, OpenCode plugin, fetch` (D1-D4)
9. `distribution: skills, installer, manifests` (D5-D7)
10. `ship: corpus, docs, migration runbook, CI` (E1-E3)
11. `review fixes` (E4)
