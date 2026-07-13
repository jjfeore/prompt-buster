# PromptBuster — Decision Log

James delegated all planning decisions ("go with your recommendations at each
of those decision points"). Every non-obvious call is recorded here with
rationale so it can be audited or reversed deliberately. Format: decision,
why, what was rejected.

---

**D-1. Language/runtime: Node ≥18 ESM, zero-runtime-dep core; ML runtimes on
demand.**
Why: npm/npx is the mandated distribution channel; the abeeo-agent-kit
conventions (zero deps, no postinstall, single bin) are proven and match the
security posture a *security tool* is judged by — its own supply chain. The
core (regex, lightgbm, pipeline, MCP, CLI, hooks) runs with stdlib only.
Rejected: Python core (breaks npx-first UX; two-language install for every
user); bundling onnxruntime-node as a hard dependency (~50 MB+ native binaries
forced on users who only want regex+lightgbm, and a postinstall-shaped
supply-chain surface).

**D-2. Wolf Defender runs in-process via on-demand runtime
(`~/.prompt-buster/runtime/`), not a Python sidecar.**
Why: one language, one install step (`prompt-buster setup wolf`), no Python
required on the machine; onnxruntime-node is the same ORT core the Abeeo
container uses. The Abeeo-compatible HTTP mode still exists, so anyone who
prefers the Python/container service (including Abeeo's own `prompt_guard`
image) can point PB at it — that IS the sidecar option, generalized.
Rejected: shipping a Python sidecar as the default (dependency hell PB can't
control); transformers.js-only (its standard repo layout expectations don't
match wolf-defender's `onnx/onnx_fp16/` subfolder; ORT-direct + transformers.js
tokenizer is the precise fit).

**D-3. Default filter chain `regex + wolf`; `regex + lightgbm` as the
documented low-resource preset; lightgbm default-OFF.**
Why: this is exactly what James specified. LightGBM stays fully supported and
vendored so switching is one config line with zero downloads.

**D-4. Single LightGBM threshold (default 0.86) instead of Abeeo's
trust-level tiers.**
Why: Abeeo's TL1/TL2/TL3 thresholds key off a platform-specific actor trust
model that has no analogue for "a web page my agent fetched" — untrusted is
the only trust level here. 0.86 is Abeeo's own
`supplemental_prefilter_threshold` for the vendored model revision.
Rejected: inventing a per-source trust scheme (config surface without data to
calibrate it).

**D-5. Interception happens at the tool layer (hooks/MCP/CLI), not the network
layer; no MITM proxy in v1.**
Why: a local CA + TLS re-encryption is a larger attack surface than prompt
injection (key theft, cert-pinning breakage, OS trust-store surgery under
`sudo`) and most harness traffic is TLS. Every listed harness exposes a
tool-layer seam (hooks or MCP or CLI) — that's where the content actually
enters the model context, which is the thing PB protects. docs/PROXY.md
records the reasoning and a future opt-in design.
Rejected: HTTP_PROXY env + MITM (the "route all traffic" reading of stage 1);
transparent OS-level interception (way out of scope for a free local tool).

**D-6. Escalation default is `interactive` with quarantine + sha256 allow/deny
TTLs; `agent` (YOLO) and `block` modes configurable.**
Why: maps 1:1 to James's stage-4 spec (reject / allow-with-note / allow).
TTL on releases prevents infinite re-prompting for the same page while keeping
the release decision reviewable and reversible.

**D-7. Vendor the LightGBM model (1.6 MB) inside the npm package; wolf
artifacts downloaded on demand with sha256 manifest pinning.**
Why: lightgbm-in-the-box gives a working ML filter with zero downloads on
low-resource machines (its whole purpose); 1.6 MB is acceptable tarball
weight. Wolf's 282 MB obviously can't ship in npm; the pinned-manifest
download copies Abeeo's proven `model_manifest.json` approach (exact revision
`fe396c64...`, per-file sha256).
NOTE for James: the vendored booster was trained inside Abeeo — confirm
you're comfortable publishing it under MIT in the public repo (MIGRATION.md
checklist item). If not, `prompt-buster setup lightgbm` becomes a download
step from a location you control, and the filter falls back to disabled.

**D-8. Stage-3 default reviewer models: Haiku 4.5 for Claude surfaces
(Sonnet documented as the higher-accuracy option), gpt-5.5-nano for
Codex/OpenAI.**
Why: James said "lightweight reasoning model" and named Sonnet/gpt-5.5-nano
as examples; Haiku 4.5 is the current fast/cheap Anthropic tier and this is a
high-frequency, low-complexity classification call — but `review.model` is one
config key, and the Claude-harness docs explicitly show the Sonnet upgrade.
The verdict contract (allow|escalate only, strict JSON, nonconforming ⇒
escalate) makes the model choice low-stakes: a weak reviewer fails toward
escalation, never toward silent allow.

**D-9. Review stage defaults ON (`review.enabled: true`, `onError:
"escalate"`), auto-detecting a provider; silently skipped (straight to
stage 4) when no provider exists.**
Why: James: "optionally (configurably) routed to a lightweight reasoning
model." ON-by-default reduces escalation noise (the main reason users disable
security tools) while never being load-bearing for safety: with no provider,
flagged content still escalates.

**D-10. Names: npm package `prompt-buster`, bin `prompt-buster`, MCP tools
`pb_*`, config dir `~/.prompt-buster/`.**
Why: matches the repo James created; unscoped name probed unclaimed
2026-07-12; single bin per the GSD secondary-bin lesson; `pb_` is short and
collision-unlikely in tool namespaces. Scoped fallback documented.

**D-11. The repo root doubles as: npm package, Claude Code plugin, Hermes tap,
agentskills.io skill source (same recommended layout as HARNESS-FORMATS.md).**
Why: one artifact, five channels; proven by abeeo-agent-kit.

**D-12. Hand-rolled stdio MCP server (~200 lines) instead of
@modelcontextprotocol/sdk.**
Why: zero-dep constraint; the server needs exactly initialize/tools-list/
tools-call over newline-delimited JSON-RPC; the SDK would be PB's only
runtime dependency and its transitive tree lands in every npx run.
Rejected: SDK (heavier, slower npx cold-start, supply-chain surface).

**D-13. HTML→text extraction is hand-rolled and *deliberately includes*
comments, alt/title/aria attributes, and (optionally) raw markup.**
Why: hidden-text channels are primary injection carriers; a "clean article
extractor" (readability-style) would *hide attacks from the scanner*. This
inverts the usual extraction goal — worth a code comment and doc note.

**D-14. User-supplied regexes: compile-time validation + flag allowlist +
chunk-size caps, but no regex-engine sandboxing in v1.**
Why: JS lacks a safe built-in regex timeout; worker-thread isolation per
pattern is disproportionate for v1 (patterns are authored by the machine's
owner, who already runs arbitrary code). Documented in THREAT-MODEL.md;
built-in patterns are vetted for linear behavior.

**D-15. Failure default `failMode: "open"` for filter avail-errors (matching
Abeeo), `onError: "escalate"` for the review stage.**
Why: a broken classifier shouldn't brick all agent browsing (users would
uninstall PB — worst outcome), but content that already *flagged* must never
silently pass because a reviewer timed out. This asymmetry is deliberate:
fail-open before flagging, fail-toward-escalation after.

**D-16. Search interception = scanning search-tool *results* via hooks (Claude/
OpenCode) and `pb_scan` elsewhere; PB does not provide its own search tool.**
Why: search requires a provider/API key PB doesn't have; the injection risk
lives in result snippets/pages, which the hooks and pb_fetch already cover.

**D-17. Local commits during the build; NO push.**
Why: James asked for an overnight build in a fresh repo; commits create
reviewable checkpoints (and the model-handoff safety he asked for). Pushing
is outward-facing and reserved for him.

**D-18. Corpus for self-test is hand-authored, not copied from public attack
datasets.**
Why: licensing cleanliness in an MIT repo and no test dependency on external
downloads. It's a smoke gate, not a benchmark; MIGRATION.md notes real-eval
options (e.g. running the deepset/prompt-injections set locally) as follow-up.
