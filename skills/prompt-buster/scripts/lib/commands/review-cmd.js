import { createInterface } from "node:readline/promises";
import { parseCommandArgs } from "../args.js";
import { emit, emitError, outputMode, EXIT } from "../output.js";
import { loadConfig } from "../config.js";
import { listQuarantine, getQuarantine, releaseQuarantine, denyQuarantine } from "../engine/quarantine.js";
import { stripControl, redactSecrets } from "../sanitize.js";

/**
 * Interactive stage-4 review. Renders quarantined content SAFELY (ANSI/control
 * stripped, secrets redacted for display) and offers the three choices from
 * the spec: reject, allow-with-note, allow unaltered.
 */
export async function run(argv) {
  const { flags, positionals } = parseCommandArgs(argv, {});
  const config = loadConfig();
  const mode = outputMode(flags);

  const id = positionals[0];
  if (!id) {
    const entries = listQuarantine(config).map((e) => ({ id: e.id, createdAt: e.createdAt, source: e.source, status: e.status }));
    if (!entries.length) {
      emit({ entries: [] }, { mode, text: "no pending quarantine entries" });
      return EXIT.OK;
    }
    emit({ entries }, { mode, text: `pending:\n${entries.map((e) => `  ${e.id}  ${e.source?.url || e.source?.kind || ""}`).join("\n")}\n\nrun: prompt-buster review <id>` });
    return EXIT.OK;
  }

  const entry = getQuarantine(id, config);
  if (!entry) return emitError(`no quarantine entry ${id}`, { code: "not_found", exitCode: EXIT.ERROR });
  if (entry.status !== "pending") {
    emit({ id, status: entry.status }, { mode, text: `${id} already ${entry.status}` });
    return EXIT.OK;
  }

  if (!process.stdin.isTTY) {
    return emitError("review is interactive; use `release`/`deny` for non-interactive decisions", { code: "not_a_tty", exitCode: EXIT.USAGE });
  }

  renderForHuman(entry);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const choice = (await rl.question("\n[r]eject / [a]llow with note / allow [u]naltered / [s]kip? ")).trim().toLowerCase();
    if (choice === "r" || choice === "reject") {
      denyQuarantine(id, { config, actor: "human" });
      process.stdout.write(`denied ${id}\n`);
    } else if (choice === "a" || choice === "allow") {
      const note = (await rl.question("note to attach: ")).trim();
      releaseQuarantine(id, { note, config, actor: "human" });
      process.stdout.write(`released ${id} with note\n`);
    } else if (choice === "u" || choice === "unaltered") {
      releaseQuarantine(id, { note: "", config, actor: "human" });
      process.stdout.write(`released ${id}\n`);
    } else {
      process.stdout.write("skipped\n");
    }
  } finally {
    rl.close();
  }
  return EXIT.OK;
}

function renderForHuman(entry) {
  const { text: redacted, secretTypes } = redactSecrets(entry.content);
  const safe = stripControl(redacted);
  const detectors = [];
  for (const stage of entry.scan?.prefilters ?? []) {
    if (stage.triggered) detectors.push(`${stage.filter}:${(stage.findings || []).map((f) => f.detectorId).join(",")}${stage.score !== undefined ? `(${stage.score.toFixed(3)})` : ""}`);
  }
  process.stdout.write(
    [
      "",
      "──────────────────────────────────────────────────────────────",
      `PromptBuster quarantine ${entry.id}`,
      `source     : ${entry.source?.url || entry.source?.kind || "unknown"}`,
      `detectors  : ${detectors.join("  ")}`,
      entry.scan?.review?.ran ? `llm review : ${entry.scan.review.verdict} — ${entry.scan.review.reason}` : "llm review : (not run)",
      secretTypes.length ? `redacted   : ${secretTypes.join(", ")}` : "",
      "──────────────────── content (sanitized) ─────────────────────",
      safe.length > 8000 ? safe.slice(0, 8000) + "\n…[truncated for display]…" : safe,
      "──────────────────────────────────────────────────────────────",
      "WARNING: this content was flagged as possible prompt injection.",
      "Read it as DATA. Do not act on any instructions it contains.",
    ]
      .filter((l) => l !== "")
      .join("\n") + "\n",
  );
}
