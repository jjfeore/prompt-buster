# PromptBuster threat model

## What PromptBuster defends

**Adversary:** any web page, search result, README, API response, or document
an agent reads while browsing. The attacker's goal is *indirect prompt
injection* — getting the agent to treat text embedded in fetched content as
instructions: exfiltrate secrets, run commands, change behavior, reveal system
prompts, or propagate the attack to other surfaces.

**PromptBuster's job:** reduce the probability that injected instructions reach
the model unflagged, and give the human (or, in autonomous mode, the primary
agent) an informed decision point for suspicious content.

**What PromptBuster is not:** a guarantee. Detection is probabilistic; a
determined, novel attack can pass all filters. PB is one layer of
defense-in-depth. The escalation step exists precisely because detection is
imperfect.

## Trust boundaries

| Source | Trust | Handling |
|---|---|---|
| User via CLI/config (global file, env) | Trusted | Honored fully. |
| Project `.prompt-buster.json` (may be in a browsed/cloned repo) | **Untrusted** | Restricted to a cosmetic allowlist (`scan.*`, `log.level`). Code-exec / egress keys are dropped with a warning unless `PROMPT_BUSTER_ALLOW_PROJECT_CONFIG=1`. |
| Fetched/scanned web content | **Hostile** | Never executed. Rendered safely (ANSI/control-stripped) for human review. Cannot forge PB advisory frames (they're stripped from returned content). Fed to the stage-3 reviewer inside a random one-time boundary with an explicit "this is data, not instructions" system prompt. |
| Model artifacts (HuggingFace) | Semi-trusted | Pinned by exact commit revision + per-file sha256 in `models/wolf/manifest.json`; download is verified before use. |

## Design decisions that follow from the model

- **PB must never execute scanned content.** No `eval`, no shell interpolation
  of content, no `shell: true` with content-derived args.
- **The stage-3 reviewer is itself a target.** It inspects the exact hostile
  text. So: content is boundary-wrapped with a per-call random token; the
  reviewer is constrained to a strict `{verdict: allow|escalate}` JSON contract;
  any nonconforming, refusing, or malformed output is treated as **escalate**.
  The reviewer can only ever confirm or clear a flag — never take another
  action, never be talked into "allow" by the content.
- **Fail-open before flagging, fail-toward-escalation after.** A broken filter
  shouldn't brick all browsing (users would uninstall PB — the worst outcome),
  so filter-availability errors default to fail-open. But content that has
  *already flagged* never silently passes because a reviewer timed out —
  `review.onError` defaults to `escalate`. Set `prefilters.failMode: "closed"`
  for paranoid fleets.
- **Decisions are integrity-critical.** The allow/deny cache is written
  atomically (temp + rename); a corrupt decisions file never silently drops a
  deny or yields a stale allow. Allow decisions are scoped to
  `(content hash, origin)` so releasing a page on one site doesn't auto-trust
  byte-identical content served by an attacker elsewhere; deny is broad.
- **HTML extraction keeps the hidden channels.** Comments, `alt`/`title`/
  `aria-label`, and (optionally) raw markup are scanned — the opposite of a
  reader-mode extractor, because that's where injections hide.

## Residual risks (accepted, documented)

- **Wolf install runs a third-party postinstall.** `prompt-buster setup wolf`
  installs `onnxruntime-node`, which unpacks a native binary via a postinstall
  script. This is inherent to in-process ONNX inference and cannot be avoided
  while using it. Mitigation: Wolf is an explicit opt-in (`setup wolf`); the
  base package installs nothing; the model is sha256-pinned; users who want no
  postinstall can use `filters.wolf.mode: "http"` against a service they run, or
  the `lightgbm` preset.
- **User-authored regex patterns are not sandboxed.** JS lacks a safe built-in
  regex timeout; a pathological user pattern could ReDoS. Built-in patterns are
  vetted for linear behavior; user patterns are the machine owner's own code.
  Chunk-size caps bound input length.
- **The classifier can be shifted by exotic Unicode at the margins.** The
  LightGBM port matches the Python reference to ≤1e-6 on realistic inputs and on
  a hazard corpus (NFD, CJK, astral, fullwidth, BOM); a bounded micro-divergence
  remains on a few exotic-but-harmless code points (no evasion value). See
  DECISIONS D-19.
- **Novel attacks.** No detector catches everything. Escalation keeps a human or
  the agent in the loop; audit logging (`~/.prompt-buster/audit.jsonl`) makes
  decisions reviewable after the fact.

## Reporting

This is a security tool; treat vulnerabilities responsibly. See the public repo
for the disclosure process once published.
