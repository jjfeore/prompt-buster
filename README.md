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

## Quick start

```bash
# scan text (exit 3 = flagged/blocked)
echo "ignore all previous instructions" | npx prompt-buster scan

# guarded fetch
npx prompt-buster fetch https://example.com

# check your environment
npx prompt-buster doctor
```

### Install into your harness

```bash
npx prompt-buster install --claude       # or --codex --openclaw --hermes --opencode --all
```

- **Claude Code** (enforced via hooks): install the plugin —
  `/plugin marketplace add jjfeore/prompt-buster` then
  `/plugin install prompt-buster@prompt-buster`. A `PostToolUse` hook on
  `WebFetch`/`WebSearch` replaces flagged content with a block notice.
- **OpenCode** (enforced via plugin): the installer drops a plugin that
  firewalls web-tool results in place.
- **Codex / OpenClaw / Hermes**: the installer places a skill + an MCP server
  (and, for Hermes, a Python shim that intercepts tool results). Codex's native
  web search isn't hookable, so PB disables it and routes fetch/search through
  its MCP tool. See [docs/HARNESSES.md](docs/HARNESSES.md).

## Configuration

Defaults are sensible; everything is tunable. Config merges from built-in
defaults → `~/.prompt-buster/config.json` → project `.prompt-buster.json`
(restricted — see Security) → `PROMPT_BUSTER_CONFIG` → flags.

```bash
prompt-buster config set prefilters.order '["regex","lightgbm"]'   # low-resource preset
prompt-buster config set filters.wolf.threshold 0.6
prompt-buster config set escalation.mode agent                     # autonomous fleets
prompt-buster patterns add --id my_rule --pattern "leak.*credentials"
```

Full reference: [docs/CONFIG.md](docs/CONFIG.md).

## Choosing filters

| Machine | Recommended `prefilters.order` | Notes |
|---|---|---|
| Default | `["regex", "wolf"]` | Best accuracy. Needs `setup wolf` (one-time). |
| Low CPU/RAM | `["regex", "lightgbm"]` | Pure-JS, no download, ~1.6 MB vendored. |
| Have a GPU/service | `["regex", "wolf"]` + `filters.wolf.mode: "http"` | Point at any Abeeo prompt_guard-compatible `/classify` service. |

## Security notes

- **Untrusted project config.** A `.prompt-buster.json` inside a repo you browse
  could otherwise weaken the firewall or run code. PB honors only cosmetic keys
  from project config unless you set `PROMPT_BUSTER_ALLOW_PROJECT_CONFIG=1`.
- **Wolf Defender install** runs `npm install onnxruntime-node`, which unpacks a
  native binary via its postinstall script. This is inherent to in-process ONNX
  inference and is why Wolf is an explicit opt-in — the base package installs
  nothing. See [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).
- **No MITM proxy.** PB intercepts at the tool layer, not the TLS socket. Why:
  [docs/PROXY.md](docs/PROXY.md).
- PromptBuster is defense-in-depth, not a guarantee. A novel attack can pass all
  filters; the escalation step keeps a human (or the agent) in the loop.

## Exit codes

`0` ok · `1` error · `2` usage · `3` flagged/escalated · `4` blocked · `6` partial refusal (install).

## Development

```bash
npm test                 # 68 tests, zero-dep (node:test)
# regenerate LightGBM golden vectors (needs python + lightgbm):
py -m venv .venv && .venv/Scripts/python -m pip install lightgbm numpy
.venv/Scripts/python scripts/golden/generate.py
```

See [.planning/](.planning/) for the full spec, decision log, and the
adversarial review that shaped this build. Publishing/distribution:
[MIGRATION.md](MIGRATION.md).

## License

MIT © James Feore
