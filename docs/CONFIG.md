# PromptBuster configuration reference

Config is deep-merged from: built-in defaults → `~/.prompt-buster/config.json`
→ nearest project `.prompt-buster.json` → `PROMPT_BUSTER_CONFIG` (a file path)
→ per-invocation flags. Manage the global file with
`prompt-buster config get|set|unset|list|path <key> [json-value]`.

## Filters (stage 2)

```jsonc
{
  "prefilters": {
    "order": ["regex", "wolf"],   // enabled filters, in order.
                                   // low-resource preset: ["regex", "lightgbm"]
    "mode": "any",                 // "any" = first trigger wins; "all" = run all
    "failMode": "open",            // "open" = a broken filter is skipped;
                                   // "closed" = a broken filter escalates
    "minChars": 12                 // skip inputs shorter than this
  },
  "filters": {
    "regex":    { "disabled": [], "custom": [] },
    "lightgbm": { "threshold": 0.86 },
    "wolf":     { "mode": "local", "threshold": 0.5, "dtype": "fp16",
                  "http": { "url": "", "token": "" }, "timeoutMs": 3000 },
    "custom":   []
  }
}
```

- **regex** (default on): deterministic pattern catalogue + evasion decoding
  (base64/hex, character-spacing, typoglycemia). Customize:
  - `prompt-buster patterns list|add|remove <id>|test "<text>"`
  - `filters.regex.disabled`: built-in detector ids to turn off.
  - `filters.regex.custom`: `[{ id, type, description, pattern, flags }]`
    (flags limited to `imsu`). Also loadable from
    `~/.prompt-buster/patterns.d/*.json`.
- **lightgbm** (low-resource classifier, off by default): pure-JS, vendored, no
  download. Enable by putting `"lightgbm"` in `prefilters.order`. One
  `threshold` (0–1).
- **wolf** (robust classifier, default on): ModernBERT model.
  - `mode: "local"` needs `prompt-buster setup wolf` (installs an inference
    runtime + downloads the model, sha256-verified).
  - `mode: "http"` points at an Abeeo prompt_guard-compatible `/classify`
    service via `http.url` / `http.token` — no local model needed.
- **custom**: your own classifiers.
  - HTTP: `{ "name", "type": "http", "url", "token", "threshold", "timeoutMs" }`
    (Abeeo `/classify` request/response contract).
  - Command: `{ "name", "type": "command", "command", "args", "threshold" }`
    — receives `{"text": "..."}` on stdin, must print `{"score": 0..1}`.
  Add a custom filter's `name` to `prefilters.order` to activate it.

## LLM review (stage 3)

```jsonc
{ "review": { "enabled": true, "provider": "auto", "model": "",
              "timeoutMs": 30000, "maxChars": 24000, "onError": "escalate" } }
```

Runs only on flagged content, and only to potentially clear it. `provider`:
`auto` (detect claude/codex CLI or ANTHROPIC/OPENAI keys), `claude-cli`,
`codex-cli`, `anthropic-api`, `openai-api`, `openai-compatible` (set `baseUrl`,
`apiKeyEnv`), or `none`. Any malformed/refusing reviewer output escalates —
the reviewer can never do anything but clear or confirm the flag.

## Escalation (stage 4)

```jsonc
{ "escalation": { "mode": "interactive" },
  "quarantine": { "allowTtlHours": 24, "denyTtlHours": 720, "maxEntries": 500 } }
```

- `interactive` (default): blocked content is quarantined; the human runs
  `prompt-buster review <id>` to reject / allow-with-note / allow.
- `agent`: the primary agent gets a sanitized excerpt and may `pb_release`.
- `block`: hard block; only a human `prompt-buster release <id>` frees it.

Released content (by content hash) passes for `allowTtlHours`; denied content
stays blocked for `denyTtlHours`. Every decision is logged to
`~/.prompt-buster/audit.jsonl`.
