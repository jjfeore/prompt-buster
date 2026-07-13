# PromptBuster architecture

One engine, many entry points. Every ingress route normalizes to
`scan({ text, source })` in `lib/engine/pipeline.js`; the harness integrations
are thin adapters over it.

## Layout

```
bin/prompt-buster.mjs          # CLI entry (Node version gate, dispatch)
lib/
  args.js  output.js  config.js  paths.js  http.js  sanitize.js  chunks.js
  engine/
    pipeline.js                # stages 2-4 orchestration; produces ScanResult
    quarantine.js              # quarantine store + allow/deny decision cache + audit
    review.js                  # stage-3 LLM review (5 providers, strict verdict)
    extract.js                 # HTML -> scannable text (keeps hidden channels)
    daemon.js / dispatch.js    # warm scan daemon + daemon-or-local routing
    filters/
      regex.js  regex-patterns.js        # deterministic catalogue + evasion
      lightgbm.js  lightgbm-model.js  lightgbm-features.js   # pure-JS classifier
      wolf.js                            # ModernBERT (local via transformers.js, or http)
      custom.js                          # user HTTP/command classifiers
  mcp/server.js                # zero-dep stdio JSON-RPC MCP server
  commands/                    # one module per CLI command
hooks/hooks.json  .mcp.json    # Claude Code plugin wiring
scripts/pb-hook.mjs            # Claude PostToolUse adapter
integrations/opencode/         # OpenCode JS plugin
integrations/hermes/           # Hermes Python shim plugin
skills/prompt-buster/          # agentskills.io skill + references
models/lightgbm/               # vendored booster (1.6MB) + metadata
models/wolf/manifest.json      # sha256-pinned HF artifact list (downloaded on setup)
```

## The pipeline (`scan`)

1. Empty / whitespace → clean.
2. **Decision cache** (`checkDecision`): a prior deny (broad) hard-blocks; a
   prior allow (scoped to hash+origin) releases. A corrupt cache fails safe.
3. **Pre-filters** in `prefilters.order`. Each filter returns
   `{triggered, score?, findings?, error?}`. `mode:"any"` short-circuits on the
   first trigger; `mode:"all"` runs everything. A filter `error` is governed by
   `failMode` (`open` skips it; `closed` treats it as a trigger).
4. **LLM review** (if enabled and a pre-filter fired): `allow` returns the
   content (flagged but cleared); anything else falls through.
5. **Escalation**: store a quarantine entry and return a mode-specific message
   (`interactive` → human review; `agent` → sanitized excerpt + `pb_release`
   affordance; `block` → hard block).

`ScanResult` carries `verdict` (`clean|flagged|escalated|blocked|released`),
`stages`, `content` (when allowed), `message` (when blocked), and
`quarantineId`.

## The daemon

Wolf's model load is seconds-scale, unusable per short-lived hook process. So
`prompt-buster serve` runs a loopback-only HTTP daemon (random port + bearer
token in `~/.prompt-buster/daemon.json`, 0600) that keeps the model warm and
idle-exits. Short-lived entry points (`scan`, `fetch`, the Claude hook) call
`scanViaDaemonOrLocal`: use the daemon when the chain includes local Wolf,
auto-spawn it if absent, and fall back to in-process scanning (with Wolf
recorded as unavailable → `failMode`) if the daemon can't be reached. The MCP
server and `serve` run the pipeline in-process directly.

## Extending it

- **A new filter**: add `lib/engine/filters/<name>.js` exporting
  `name` + `async check(text, {config})`, register it in `DEFAULT_FILTER_LOADERS`
  (pipeline.js), and add validation in `config.js`. Golden-test any classifier.
- **A new review provider**: add a case to `buildProvider` in `review.js`.
- **A new harness**: add an adapter (a hook script or plugin) that calls the CLI
  `scan`/`fetch` or the MCP server, and an installer branch. The engine doesn't
  change.
