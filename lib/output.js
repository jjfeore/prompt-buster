/**
 * Output contract: machine JSON by default when stdout is not a TTY (agents),
 * human-readable text on TTYs. Errors are JSON envelopes on stderr.
 *
 * Exit codes (stable, documented in README):
 *   0 ok | 1 error | 2 usage | 3 flagged/escalated | 4 blocked | 6 partial refusal
 */

export const EXIT = Object.freeze({
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  FLAGGED: 3,
  BLOCKED: 4,
  PARTIAL_REFUSAL: 6,
});

export function outputMode(flags = {}) {
  if (flags.output === "json" || flags.output === "text") return flags.output;
  return process.stdout.isTTY ? "text" : "json";
}

export function emit(payload, { mode = "json", text } = {}) {
  if (mode === "text" && typeof text === "string") {
    process.stdout.write(text.endsWith("\n") ? text : text + "\n");
    return;
  }
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
}

export function emitError(error, { code = "error", exitCode = EXIT.ERROR, hint } = {}) {
  const message = error instanceof Error ? error.message : String(error);
  const envelope = { error: { code, message } };
  if (hint) envelope.error.hint = hint;
  process.stderr.write(JSON.stringify(envelope) + "\n");
  return exitCode;
}

/** Warn on stderr without polluting the stdout contract. */
export function warn(message) {
  process.stderr.write(JSON.stringify({ warning: String(message) }) + "\n");
}
