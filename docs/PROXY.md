# Why PromptBuster intercepts at the tool layer, not the network

A natural first instinct for "route all agent traffic through a firewall" is a
**MITM HTTPS proxy**: install a local trusted CA, set `HTTP_PROXY`/`HTTPS_PROXY`,
decrypt every request, scan, re-encrypt. PromptBuster deliberately does **not**
do this in v1. Here's the reasoning.

## The problem a proxy would introduce is bigger than the one it closes

- **A local CA is a serious attack surface.** To decrypt TLS you install a root
  certificate the OS trusts for *all* traffic. If that CA's private key leaks,
  every TLS connection on the machine is forgeable. That's a larger, more
  permanent risk than indirect prompt injection.
- **It breaks the web.** Certificate pinning (common in APIs and native apps),
  HSTS, and mutual TLS all break or degrade behind a MITM proxy. Agents would
  hit confusing failures unrelated to security.
- **It needs elevated trust to install** (OS trust-store surgery, often
  `sudo`/admin), which is exactly the kind of step a security-conscious user is
  right to refuse.
- **Node's built-in `fetch` ignores `HTTP_PROXY` by default** anyway, so a proxy
  wouldn't even transparently capture the harnesses' own requests without
  per-harness configuration — the same per-harness work the tool-layer
  integration already does, but with more moving parts.

## Where the content actually enters the model

The thing PromptBuster protects is the **model's context** — and untrusted web
content enters it through the harness's *tools*: WebFetch, WebSearch, browser
tools, MCP fetchers. Every supported harness exposes a seam there:

- Claude Code / OpenCode: hooks that can rewrite tool output.
- Codex / OpenClaw: disable native web tools, route through PB's MCP server.
- Hermes: a `transform_tool_result` plugin hook.
- Anything: `pb_fetch`/`pb_scan` MCP tools, or the CLI.

Intercepting there scans exactly the bytes that would reach the model, with no
CA, no re-encryption, and no OS trust changes.

## If you still want socket-level interception

You can run PB's HTTP classifier mode behind your own proxy stack: point an
existing forward proxy's content-inspection hook at
`POST /classify` on a `prompt-buster serve`-style endpoint (or the Abeeo
prompt_guard service). PromptBuster stays the policy/scan engine; the transport
interception is yours to own, with its trade-offs made explicitly.

## Future (opt-in) design sketch

A future `prompt-buster proxy` could offer an **opt-in** local proxy for users
who accept the trade-offs, with: no CA by default (HTTP-only or explicit
per-domain allowlisting), clear warnings, and the same pipeline behind it. It
would be strictly additive — the tool-layer integration remains the default and
recommended path. Not in v1.
