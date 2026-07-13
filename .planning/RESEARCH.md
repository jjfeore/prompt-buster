# PromptBuster — Verified Integration & Inference Research (2026-07-12)

Four parallel researchers verified everything below against official docs/source
on 2026-07-12. Version stamps: Claude Code current docs; OpenCode v1.17.18;
Codex CLI 0.144.1; OpenClaw v2026.7.1-beta.6; Hermes ≥0.5.x;
@huggingface/transformers 4.2.0; onnxruntime-node 1.27.0 (transformers.js pins
1.24.3); LightGBM master `tree.h`/`tree.cpp`/`binary_objective.hpp`.

## R-1 Claude Code (hooks are the enforcement seam — CONFIRMED STRONG)

- **PostToolUse stdin**: `{session_id, transcript_path, cwd, permission_mode,
  hook_event_name, tool_name, tool_input, tool_response, ...}`.
  - WebFetch: `tool_input = {url, prompt}`; `tool_response` = the
    LLM-extracted **markdown string** (not raw HTML).
  - WebSearch: `tool_input = {query, allowed_domains?, blocked_domains?}`;
    `tool_response` = JSON array of `{title, url}` results.
  - MCP tools: `tool_name = "mcp__<server>__<tool>"`; PostToolUse fires for them.
- **PostToolUse output (exit 0 + stdout JSON)**:
  `hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput:
  "<string REPLACES what the model sees>", additionalContext: "<extra context>" }`
  plus top-level `decision/reason`, `systemMessage`, `suppressOutput`.
  **`updatedToolOutput` is the money field** — PB rewrites flagged content with
  the block/escalation message, or annotates released content. Original stays
  in transcript. There is NO `updatedMCPToolOutput` — same field for MCP tools.
  Exit 2 = informational only for PostToolUse (cannot block; tool already ran).
- **PreToolUse**: can deny (`hookSpecificOutput.permissionDecision:
  "deny"|"allow"|"ask"|"defer"` + `permissionDecisionReason`) and rewrite args
  (`updatedInput`). PB uses it optionally to deny WebFetch to known-denied URLs.
- **Matchers**: bare `WebFetch`, `WebSearch`; pipe/regex allowed
  (`WebFetch|WebSearch`); MCP: `mcp__<server>__<tool>` regex patterns; plugin
  MCP servers appear as `mcp__plugin_<plugin>_<server>__<tool>`.
- **Plugin hooks**: `hooks/hooks.json`, same schema as settings hooks; prefer
  exec form `{"type":"command","command":"node","args":["${CLAUDE_PLUGIN_ROOT}/scripts/pb-hook.mjs"]}`.
  Hooks auto-enable when the plugin is installed/enabled (no per-hook consent);
  `defaultEnabled: false` available if we want opt-in.
- **Plugin MCP**: `.mcp.json` → `{"mcpServers": {"pb": {"command": "npx",
  "args": ["-y", "prompt-buster", "mcp"]}}}`; `${CLAUDE_PLUGIN_ROOT}` /
  `${user_config.KEY}` substitution available.
- **userConfig** in plugin.json: typed fields, `sensitive: true` → keychain.

## R-2 OpenCode (in-process hook mutation — CONFIRMED STRONG)

- Plugin hook signatures (from source, v1.17.18):
  - `"tool.execute.before"(input: {tool, sessionID, callID}, output: {args})`
  - `"tool.execute.after"(input: {tool, sessionID, callID, args},
    output: {title, output, metadata, attachments?})`
  - `output` is passed BY REFERENCE and the mutated object is what the model
    sees → **overwrite `output.output` to rewrite**; `throw new Error(...)`
    to hard-fail the call.
  - **MCP-tool results have a different shape**: raw `CallToolResult`
    `{content: [{type: "text", text}, ...]}` — handle both shapes.
- Built-in web tool: `webfetch`. Plugin registration: `opencode.json`
  `"plugin": ["prompt-buster@<pinned version>"]` (bare names pinned to
  @latest — recommend pinning) or a file in `.opencode/plugins/`
  (project) / `~/.config/opencode/plugins/` (global). npm plugins installed
  with `ignoreScripts: true` (no lifecycle scripts — cannot rely on them).
  `$` (Bun shell) may be undefined under Node — use node:child_process.
- MCP config: `"mcp": {"promptbuster": {"type": "local", "command": ["npx",
  "-y", "prompt-buster", "mcp"], "enabled": true}}` — NOTE: `command` is ONE
  array (binary + args), env under `"environment"`.

## R-3 Codex CLI (native web_search NOT hookable — MCP is the path)

- Codex 0.144.x HAS Claude-style hooks: `~/.codex/hooks.json` or config.toml
  (`[[hooks.PostToolUse]]`), stdin payload like Claude's; PostToolUse can
  `{"decision": "block", "reason": "<text>"}` which REPLACES the tool result
  with the reason text (the only supported post-hoc mutation;
  `updatedMCPToolOutput`/`suppressOutput` parsed but NOT implemented).
  `commandWindows` overrides command on Windows. Non-managed hooks require
  the user to trust them via `/hooks` before first run — installer must say so.
- **Native `web_search` is a server-side Responses-API tool — hooks do NOT
  fire for it.** Firewall path: set `web_search = "disabled"` in config.toml
  + PB MCP server + PostToolUse hook matching `mcp__.*` (MCP hook coverage
  is version-dependent — verify on install).
- MCP registration (`~/.codex/config.toml`, section name EXACTLY
  `mcp_servers`):
  `[mcp_servers.promptbuster]\ncommand = "npx"\nargs = ["-y", "prompt-buster", "mcp"]`.
- One-shot for stage-3 review: `codex exec -m gpt-5.5-nano "<prompt>"`
  (final message → stdout; `--json` for JSONL events; exec default sandbox is
  read-only — good for a reviewer; add `--skip-git-repo-check`).

## R-4 OpenClaw (after_tool_call is observe-only — provider/MCP is the path)

- `after_tool_call` CANNOT modify results. The documented rewrite seam
  (`api.registerAgentToolResultMiddleware`) requires a manifest contract +
  operator enablement and is under-documented; plugin `registerTool` cannot
  shadow core tool names; external webFetchProvider resolution has an open
  bug (#74915). → **v1 path: disable native web tools + MCP guarded fetch.**
- Config: `tools.web.search.enabled: false`, `tools.web.fetch.enabled: false`
  (or `tools: {deny: ["web_search","web_fetch","browser"]}`);
  MCP: `{"mcp": {"servers": {"promptbuster": {"command": "npx", "args":
  ["-y", "prompt-buster", "mcp"]}}}}` — tools surface as `promptbuster__<tool>`.
- OpenClaw requires Node 22.19+/24+ for itself; strips NODE_OPTIONS etc. when
  spawning MCP servers (fine). Skills: `~/.openclaw/skills/` and
  `<workspace>/skills`. before_tool_call CAN block (plugin, v2 candidate).
- No plugin API to call the host LLM; stage-3 falls back to detected
  CLIs/APIs; `openclaw agent --agent <minimal-judge> --message ... --json`
  exists but is a full agent turn (documented, not default).

## R-5 Hermes (Python shim plugin — result replacement CONFIRMED)

- Hook `transform_tool_result` (Python plugin API): `cb(tool_name, arguments,
  result: str, task_id, **kwargs) -> str | None` — fires after tool returns,
  before the model sees it; return a string to REPLACE. `pre_tool_call` can
  block (`{"action": "block", "message": ...}`). Hook errors are swallowed →
  FAILS OPEN; the shim itself must implement fail-closed if configured.
- Plugin layout: `~/.hermes/plugins/prompt-buster/` with `plugin.yaml`
  (name/version/description) + `__init__.py` exporting `register(ctx)`;
  enable via config.yaml `plugins: {enabled: [prompt-buster]}`.
  Web tools to match: `web_search`, `web_extract`, `browser_snapshot`,
  `mcp_*`. `ctx.llm.complete(...)` exists (host-LLM review — v2 option).
- MCP: config.yaml `mcp_servers: {promptbuster: {command: "npx", args:
  ["-y","prompt-buster","mcp"]}}`; tools named `mcp_promptbuster_<tool>`.
- One-shot for review: `hermes -z -m <model> "<prompt>"` (pure stdout).
- Shell hooks exist but CANNOT replace results (block/context only) and need
  first-use consent (`hooks_auto_accept`/`HERMES_ACCEPT_HOOKS=1`).

## R-6 JS inference stack

- **transformers.js**: use `@huggingface/transformers@^4.2.0`. ModernBERT
  supported since 3.2.1. Local load: pass the ABSOLUTE model dir as
  `from_pretrained` path + `{subfolder: "onnx/onnx_fp16", dtype: "fp16",
  local_files_only: true, device: "cpu"}` → resolves
  `<dir>/onnx/onnx_fp16/model_fp16.onnx`. For the mixed variant:
  `{subfolder: "onnx/onnx_mixed", model_file_name: "model_mixed", dtype: "fp32"}`
  (model_file_name EXCLUDES dtype suffix + .onnx). Set
  `env.allowRemoteModels = false` for a hard offline guarantee.
  Tokenizer: needs BOTH `tokenizer.json` + `tokenizer_config.json` at the
  model dir ROOT (subfolder does not apply; special_tokens_map.json ignored)
  → downloader must copy them from `onnx/onnx_fp16/` to the root.
  `config.json` must exist at root (manifest has it). Pipeline
  `text-classification` handles fp16 logits internally — REQUIRED because
  Float16Array only exists in Node ≥24; raw ORT would hand back Uint16Array
  half-bit patterns on 18/20/22.
- fp16 on CPU EP: works via auto-inserted casts but is typically SLOWER than
  fp32 (no fp32 export exists in this repo; only fp16 + mixed). Acceptable:
  scans are seconds-scale; the daemon amortizes model load. transformers.js
  4.2.0 hard-pins onnxruntime-node@1.24.3 (~271 MB unpacked; postinstall may
  fetch CUDA EP binaries on Linux — skip flag `--onnxruntime-node-install=skip`).
  Prebuilt binaries: win32/darwin/linux x64+arm64, glibc only (no Alpine).
- **LightGBM walker semantics** (from LightGBM source — implement EXACTLY):
  - decision_type bits: bit0 categorical (this model: all 0), bit1
    default_left, bits2-3 missing_type (0 None, 1 Zero, 2 NaN); missing line
    absent → all zeros.
  - Numerical: `if (isnan(fval) && missing != NaN) fval = 0.0; if ((missing==Zero
    && |fval|<=1e-35) || (missing==NaN && isnan(fval))) → default_left ? left :
    right; else fval <= threshold ? left : right`.
  - Children ≥0 = internal node index; negative = leaf encoded as `~leafIndex`.
  - Raw score = Σ leaf_value over trees (shrinkage already baked in);
    p = 1/(1+exp(-sigmoid·raw)); sigmoid from header `objective=binary sigmoid:1`.
  - Our model: version=v4, 160 trees, num_cat=0 everywhere,
    max_feature_idx=12307, decision_type=2 (default_left, missing None).
  - No maintained pure-JS npm predictor exists (verified) — hand-roll.
- **HF downloads**: `https://huggingface.co/<owner>/<repo>/resolve/<revision>/<path>`,
  no auth for public repos, 302 → signed CDN URLs (follow redirects, keep query
  string). Pin sha256 of downloaded bytes (ETag format varies git-sha1/sha256).

## Design consequence: the daemon

Hooks are short-lived processes; wolf's model load (~seconds) per spawn is
unusable. Added component: `prompt-buster serve` — localhost-only HTTP daemon
(random port + bearer token in `~/.prompt-buster/daemon.json`, 0600), endpoint
`POST /scan` running the full pipeline with the wolf model warm; idle-exit
after `daemon.idleMinutes` (default 30). Short-lived entrypoints (hook, `scan`,
`fetch`) use the daemon when the chain includes wolf: probe → auto-spawn
detached → wait ≤2 s → on failure run in-process without wolf and record the
filter error (failMode applies). Long-lived entrypoints (MCP server, serve)
run the pipeline in-process directly.
