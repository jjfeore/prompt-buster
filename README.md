# PromptBuster

**A local prompt-injection firewall for AI agents that browse the web.**

When an agent fetches a URL, runs a web search, or reads an external document,
that content is *untrusted* — it can contain text engineered to look like
instructions ("ignore all previous instructions", "reveal your system prompt",
hidden HTML comments, base64 payloads). PromptBuster sits between your agent's
web tools and the model's context and scans that content through a layered
pipeline before the agent ever acts on it.

- **Local-first.** Runs on your machine. No cloud service. The only network
  calls are the fetch it does for you, one-time model downloads, and any LLM
  review you configure.
- **Zero runtime dependencies** in the base package (regex + LightGBM work out
  of the box with no install). The heavier Wolf Defender classifier is an
  explicit opt-in.
- **Works across harnesses:** Claude Code, OpenCode, Codex, OpenClaw, Hermes,
  and anything that can run a shell command or an MCP server.

> Free and MIT-licensed. Built to be run by the people whose agents it protects.

## How it works

```
web content ─▶ ①ingress ─▶ ②pre-filters ─▶ ③LLM review ─▶ ④escalation ─▶ agent
                (hook/MCP/CLI)  (regex,        (optional,     (block, allow
                                 LightGBM,      confirms       with note, or
                                 Wolf, custom)  a flag)        release)
```

1. **Ingress** — traffic from the agent's web tools is routed through PB
   (harness hooks where possible, an MCP `pb_fetch`/`pb_scan` tool, or the CLI).
2. **Pre-filters** (configurable) — a fast, layered scan:
   - **regex** *(default on)* — a deterministic catalogue of injection patterns
     plus evasion decoding (base64/hex, character-spacing, typoglycemia).
   - **LightGBM** — a trained classifier, pure-JS, no download (the
     low-resource option).
   - **Wolf Defender** *(default on)* — a robust ModernBERT classifier
     (`prompt-buster setup wolf` to enable local inference, or point it at a
     service).
   - **custom** — your own HTTP or command classifier.
3. **LLM review** *(optional, default on)* — if a pre-filter fires, a
   lightweight model matched to your harness (e.g. Haiku on Claude,
   gpt-5.5-nano on Codex) reviews the content and either clears it or escalates.
   It can only ever *confirm or clear* a flag — never do anything else.
4. **Escalation** — flagged content is quarantined. You (or, in autonomous
   mode, the agent) choose: **reject**, **allow with a warning note**, or
   **allow unaltered**.

## Install

PromptBuster ships as an **agent skill** — one command, no npm account, no
global package:

```bash
npx skills@latest add jjfeore/prompt-buster -g
```

That works for Claude Code, Codex, OpenCode, Cursor, and the other agents the
[skills CLI](https://github.com/vercel-labs/skills) supports (`-g` = available
in every project; drop it for project-local). The scanning engine and the
LightGBM model ship **inside** the skill, so there is nothing else to fetch.

Then activate **enforced** interception (wires up hooks/MCP so untrusted content
can't reach the model unscanned — installing the skill alone is advisory):

```bash
node ~/.claude/skills/prompt-buster/scripts/pb.mjs install --claude
# or --codex --openclaw --hermes --opencode --all
```

Claude Code users can instead install the repo as a plugin, which wires the
`PostToolUse` hook and MCP server automatically:

```
/plugin marketplace add jjfeore/prompt-buster
/plugin install prompt-buster@prompt-buster
```

## Quick start

The CLI lives inside the skill. Substitute your install path (shown by the
install command); shell alias suggestion: `alias pb='node ~/.claude/skills/prompt-buster/scripts/pb.mjs'`.

```bash
pb doctor                                   # what's active, which filters are ready
pb fetch https://example.com                # guarded fetch
echo "ignore all previous instructions" | pb scan --stdin   # exit 3 = flagged
pb review <quarantine-id>                   # human review of blocked content
```

**Per-harness enforcement** (what `pb install` sets up):

- **Claude Code** — `PostToolUse` hook on `WebFetch`/`WebSearch` replaces
  flagged content with a block notice, plus the `pb_*` MCP tools.
- **OpenCode** — a plugin that firewalls web-tool results in place.
- **Codex** — its native web search isn't hookable, so PB disables it and routes
  fetch/search through the MCP server.
- **OpenClaw** — native web tools disabled, MCP guarded fetch registered.
- **Hermes** — a Python shim plugin intercepting tool results before the model.

See [docs/HARNESSES.md](docs/HARNESSES.md).

## Configuration

Defaults are sensible; everything is tunable. Config merges from built-in
defaults → `~/.prompt-buster/config.json` → project `.prompt-buster.json`
(restricted — see Security) → `PROMPT_BUSTER_CONFIG` → flags.

```bash
pb config set prefilters.order '["regex","lightgbm"]'   # low-resource preset
pb config set filters.wolf.threshold 0.6
pb config set escalation.mode agent                     # autonomous fleets
pb patterns add --id my_rule --pattern "leak.*credentials"
```

Full reference: [docs/CONFIG.md](docs/CONFIG.md).

## Choosing filters

| Machine | Recommended `prefilters.order` | Notes |
|---|---|---|
| Default | `["regex", "wolf"]` | Best accuracy. Needs `pb setup wolf` (one-time). |
| Low CPU/RAM | `["regex", "lightgbm"]` | Pure-JS, no download, ~1.6 MB vendored in the skill. |
| Have a GPU/service | `["regex", "wolf"]` + `filters.wolf.mode: "http"` | Point at any Abeeo prompt_guard-compatible `/classify` service. |

## Security notes

- **Untrusted project config.** A `.prompt-buster.json` inside a repo you browse
  could otherwise weaken the firewall or run code. PB honors only cosmetic keys
  from project config unless you set `PROMPT_BUSTER_ALLOW_PROJECT_CONFIG=1`.
- **Wolf Defender install** runs `npm install onnxruntime-node`, which unpacks a
  native binary via its postinstall script. This is inherent to in-process ONNX
  inference and is why Wolf is an explicit opt-in — the skill itself installs
  nothing. See [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).
- **No MITM proxy.** PB intercepts at the tool layer, not the TLS socket. Why:
  [docs/PROXY.md](docs/PROXY.md).
- PromptBuster is defense-in-depth, not a guarantee. A novel attack can pass all
  filters; the escalation step keeps a human (or the agent) in the loop.

## Exit codes

`0` ok · `1` error · `2` usage · `3` flagged/escalated · `4` blocked · `6` partial refusal (install).

## Development

```bash
npm test                 # 91 tests, zero-dep (node:test)
# regenerate LightGBM golden vectors (needs python + lightgbm):
py -m venv .venv && .venv/Scripts/python -m pip install lightgbm numpy
.venv/Scripts/python scripts/golden/generate.py
```

The distributed unit is `skills/prompt-buster/` — engine under `scripts/`,
model and corpus under `assets/`. The repo root holds only dev tooling
(`test/`, `scripts/`, `package.json`) and the Claude-plugin wrapper
(`.claude-plugin/`, `hooks/`, `.mcp.json`), none of which ships with the skill.

See [.planning/](.planning/) for the full spec, decision log, and the
adversarial review that shaped this build. Publishing/distribution:
[MIGRATION.md](MIGRATION.md).

## License

MIT © James Feore
