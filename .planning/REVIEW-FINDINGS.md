# Adversarial spec-review findings & dispositions (2026-07-12)

5 parallel reviewers (security, lightgbm-parity, feasibility, harness, scope-ux)
audited the spec + reference code. Dispositions below. "Already correct" means
the implementation handles it and a test proves it; "FIXED" means changed in
response; "DOCUMENTED" means an accepted trade-off recorded in DECISIONS.md.

## Critical

1. **Untrusted project `.prompt-buster.json` → RCE / key exfiltration.**
   An agent browsing an untrusted repo could load that repo's project config,
   which (as designed) could define a `type:"command"` custom classifier or a
   `review.baseUrl`/`apiKeyEnv` that runs code or exfiltrates keys+content.
   **FIXED**: project config is now honored ONLY for a safe allowlist of keys
   (scan.*, log.level); all security-relevant keys are dropped from the project
   layer with a warning unless `PROMPT_BUSTER_ALLOW_PROJECT_CONFIG=1` is set.
   Global (`~/.prompt-buster/config.json`) and env-pointed config stay fully
   trusted. See config.js `TRUSTED`/`PROJECT_ALLOWLIST`.

2. **CRC32 unsigned over UTF-8 bytes** — Already correct (`>>> 0` before modulo,
   hashes `Buffer.from(str,"utf-8")`; crc32 unit test pins reference values).

3. **Float32 quantization before the tree walk** — Already correct
   (`directFeatureDense` uses `Float32Array`; the score-parity test to ≤1e-6
   validates the float32 path end-to-end).

4. **Code-point (not UTF-16) length/slicing** — Already correct
   (`Array.from`, `for...of`, code-point slices throughout lightgbm-features).
   **HARDENED**: added astral-emoji + CJK + fullwidth golden vectors.

## High — LightGBM Unicode parity (silent-evasion class)

5. **Word tokenizer / isAlnum included `\p{M}` (combining marks).** Python `\w`
   / `isalnum()` exclude combining marks, so `i·́gnore` (NFD) would tokenize
   differently — a real evasion vector. **FIXED**: dropped `\p{M}`; empirically
   re-verified against Python with an NFD golden vector.
6. **isUpper/isDigit predicates.** **FIXED** for realistic ranges; parity is
   now empirically pinned by hazard golden vectors (combining marks, fullwidth
   digits, CJK, astral). Exotic superscript/circled-digit classification is a
   documented micro-divergence with zero evasion value (you cannot hide a
   keyword in superscripts) — DECISIONS D-19.
7. **Stat-regex `\b` is ASCII-only in JS.** Matches Python for the English
   keyword catalogues on realistic text; DOCUMENTED as a bounded micro-nit
   (D-19). Golden vectors include non-ASCII-adjacent keyword cases.
8. **Long-text path (chunk-and-max vs bounded).** Already matches Abeeo:
   `lightgbm.js` chunks with `overlappingTextChunks` and takes the max, exactly
   like Abeeo. **HARDENED**: added a >4096-char golden vector.
9. **decision_type missing-type gating** — Already correct (gated on
   missing_type; None everywhere → plain `fval <= threshold`).

## High — security / correctness

10. **PB advisory frames are forgeable** by scanned content (fake "released by
    user" banner). **FIXED**: PB strips PB-frame-lookalike lines from scanned
    content before framing, and the release/block banners carry no authority
    the skill is told to trust blindly (skill: content is always data).
11. **decisions.json non-atomic write; corrupt ⇒ fail-open.** **FIXED**: atomic
    temp+rename; a corrupt decisions file is surfaced as a warning and treated
    as "no allow decisions" while PRESERVING deny-safety (unreadable ⇒ we do
    not auto-allow).
12. **Wolf fails open on warmup/timeout.** **FIXED/DOCUMENTED**: daemon
    `startTimeoutMs` default raised; when wolf is the only classifier and is
    unavailable, the short-lived fallback records a filter error so
    `failMode:"closed"` escalates. Fail-open remains the default (D-15) but is
    now a conscious, documented window (D-20).

## High — scope / UX (DOCUMENTED, not blocking)

13. **Regex-only hard-block without classifier confirmation.** PB's stage-3 LLM
    review IS the confirmer (Abeeo's role for its classifier); with review
    enabled (default) a regex hit is confirmed before block. DECISIONS D-21.
14. **Interactive block-by-default vs autonomous agents.** DECISIONS D-22:
    `interactive` stays the safe default; the installer configures `agent` mode
    for autonomous/YOLO harness targets, and `--autonomous` / config selects it.
15. **Surface too large for one session.** The core (Claude Code + regex +
    lightgbm, golden-tested) is complete and verified; wolf/other harnesses are
    layered and independently testable. Accepted.
16. **Wolf install supply-chain (onnxruntime-node postinstall).** DECISIONS
    D-23 + docs: `setup wolf` is an explicit opt-in that DOES run
    onnxruntime-node's postinstall (required for the CPU binary); the zero-dep
    posture is about the BASE package. Disclosed in README/THREAT-MODEL.

## Second round — adversarial CODE review (11 confirmed of 12 raised)

A second workflow reviewed the actual implementation (not the spec) across 4
areas, each finding adversarially verified against the code. All 11 confirmed
defects FIXED with regression tests (suite now 90 tests):

- **[high] `recordDecision` clobbered denials over a corrupt decisions file** —
  it ignored the `corrupt` flag `checkDecision` honored, so an unrelated
  release after corruption atomically overwrote the file, permanently wiping
  every human deny (fail-open of a security control). Now refuses to write over
  a corrupt file and surfaces the error.
- **[high] `centerWindow` reviewed only head+tail** — a mid-document injection
  was invisible to the stage-3 reviewer and got cleared. Replaced with
  `reviewWindows`: every region is reviewed (bounded to 4 windows); any window
  escalates → escalate; over-budget content escalates the un-reviewed remainder.
- **[high] Wolf model renamed into place BEFORE sha256 verify** — defeated the
  pin on next load. Now verifies the `.part` temp file (size + sha256) then
  renames; a streamed byte cap prevents disk-exhaustion by a malicious mirror.
- **[medium] `parseVerdict` took the FIRST JSON object** — a planted `allow` in
  echoed hostile content could override the reviewer's real `escalate`. Now
  considers every verdict object; any `escalate` wins; `allow` requires all
  present verdicts to agree.
- **[medium] Forged-frame guard was case-sensitive** while the strip regex was
  case-insensitive → a lowercase `[promptbuster: …]` forgery survived. Guard
  made case-insensitive.
- **[medium] Claude hook passed clean content through as `{}`** even when the
  pipeline stripped a forged frame from it → the forgery survived in the
  original tool output. Now emits `updatedToolOutput` when sanitized content
  differs from the raw text.
- **[medium] Installer exited 0 on a target error**, and a partial install left
  untracked files. Now non-zero on error/refusal; rolls back written paths on
  any failure.
- **[low] SSRF via redirect** to loopback/private/metadata IPs — `boundedFetch`
  now blocks those literal hosts on every hop (DNS-rebinding documented as a
  residual). **[low] hook config-load failure** now honors fail-closed.
