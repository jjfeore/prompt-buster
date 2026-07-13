# Per-harness setup (verified 2026-07-12)

`prompt-buster install --<harness>` writes these for you. Manual steps below for
reference. Enforcement strength varies by what each harness exposes.

## Claude Code (enforced via hooks)

The repo is a Claude plugin. Install the marketplace + plugin:

```
/plugin marketplace add jjfeore/prompt-buster
/plugin install prompt-buster@prompt-buster
```

This activates a `PostToolUse` hook on `WebFetch|WebSearch` that replaces
flagged tool output with a block notice (`hookSpecificOutput.updatedToolOutput`),
and a bundled `pb` MCP server. To also cover an MCP browser tool, add a matcher
like `mcp__<server>__<tool>` in the plugin's `hooks/hooks.json`.

## OpenCode (enforced via plugin)

`prompt-buster install --opencode` writes a plugin file that mutates web-tool
output in place. Or add to `opencode.json`:

```jsonc
{ "plugin": ["prompt-buster@0.1.0"],
  "mcp": { "prompt-buster": { "type": "local",
    "command": ["npx", "-y", "prompt-buster", "mcp"], "enabled": true } } }
```

## Codex CLI (MCP + hook; disable native search)

Codex's native `web_search` is server-side and NOT interceptable by hooks. So:

```toml
# ~/.codex/config.toml
web_search = "disabled"
[mcp_servers.prompt-buster]
command = "npx"
args = ["-y", "prompt-buster", "mcp"]
```

Optionally add a `PostToolUse` hook matching `mcp__.*` that returns
`{"decision":"block","reason":"<notice>"}`. Codex requires you to trust new
hooks via `/hooks` before they run.

## OpenClaw (MCP; disable native web tools)

```jsonc
// openclaw.json
{ "tools": { "web": { "search": { "enabled": false }, "fetch": { "enabled": false } } },
  "mcp": { "servers": { "prompt-buster": {
    "command": "npx", "args": ["-y", "prompt-buster", "mcp"] } } } }
```

Skill installs to `~/.openclaw/skills/prompt-buster/`.

## Hermes (Python shim plugin — enforced)

`prompt-buster install --hermes` writes a Python plugin to
`~/.hermes/plugins/prompt-buster/` that registers `transform_tool_result` and
shells out to the CLI. Enable it:

```yaml
# ~/.hermes/config.yaml
plugins:
  enabled: [prompt-buster]
mcp_servers:
  prompt-buster: { command: "npx", args: ["-y", "prompt-buster", "mcp"] }
```

## Any other harness

`npx prompt-buster fetch <url>` / `... scan --stdin`, or register the stdio MCP
server (`npx prompt-buster mcp`). The skill in this directory teaches the agent
to prefer those paths.

> Integrations are thin adapters over one engine. If a harness changes its
> hook/MCP contract, only the adapter changes. This file records the versions
> the adapters were verified against; re-check on major harness upgrades.
