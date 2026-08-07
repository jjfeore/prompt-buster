# Per-harness setup (verified 2026-07-12)

`pb install --<harness>` writes these for you and prints the exact snippet with
your real absolute paths. Manual reference below.

Throughout, `<pb>` means the absolute path to this skill's CLI:
`<skill-dir>/scripts/pb.mjs` — e.g. `~/.claude/skills/prompt-buster/scripts/pb.mjs`.
MCP registrations use `node <pb> mcp`.

## Claude Code (enforced via hooks)

Two options.

**A. Install the repo as a plugin** (wires hook + MCP automatically):
```
/plugin marketplace add jjfeore/prompt-buster
/plugin install prompt-buster@prompt-buster
```

**B. Skill install + `pb install --claude`**, which registers a `PostToolUse`
hook on `WebFetch|WebSearch` that replaces flagged tool output
(`hookSpecificOutput.updatedToolOutput`) and the `pb_*` MCP server.

To also cover an MCP browser tool, add a matcher like `mcp__<server>__<tool>`.

## OpenCode (enforced via plugin)

`pb install --opencode` writes a plugin file that mutates web-tool output in
place. MCP registration in `opencode.json` (note: `command` is a single array):

```jsonc
{ "mcp": { "prompt-buster": { "type": "local",
    "command": ["node", "<pb>", "mcp"], "enabled": true } } }
```

## Codex CLI (MCP + hook; disable native search)

Codex's native `web_search` is a server-side tool and is **not** interceptable
by hooks, so disable it and route through MCP:

```toml
# ~/.codex/config.toml
web_search = "disabled"
[mcp_servers.prompt-buster]
command = "node"
args = ["<pb>", "mcp"]
```

Optionally add a `PostToolUse` hook matching `mcp__.*` returning
`{"decision":"block","reason":"<notice>"}`. Codex requires you to trust new
hooks via `/hooks` before they run.

## OpenClaw (MCP; disable native web tools)

```jsonc
// openclaw.json
{ "tools": { "web": { "search": { "enabled": false }, "fetch": { "enabled": false } } },
  "mcp": { "servers": { "prompt-buster": {
    "command": "node", "args": ["<pb>", "mcp"] } } } }
```

## Hermes (Python shim — enforced)

`pb install --hermes` writes a Python plugin to
`~/.hermes/plugins/prompt-buster/` that registers `transform_tool_result` and
shells out to this CLI (the absolute path is baked in at install time). Enable:

```yaml
# ~/.hermes/config.yaml
plugins:
  enabled: [prompt-buster]
mcp_servers:
  prompt-buster: { command: "node", args: ["<pb>", "mcp"] }
```

## Any other harness

`node <pb> fetch <url>` / `node <pb> scan --stdin`, or register the stdio MCP
server (`node <pb> mcp`). This skill teaches the agent to prefer those paths.

> Integrations are thin adapters over one engine. If a harness changes its
> hook/MCP contract, only the adapter changes. This file records the versions
> the adapters were verified against; re-check on major harness upgrades.
