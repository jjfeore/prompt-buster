import { readFileSync } from "node:fs";
import { parseCommandArgs } from "../args.js";
import { loadConfig } from "../config.js";
import { emit, emitError, outputMode, EXIT } from "../output.js";
import { scan } from "../engine/pipeline.js";
import { scanViaDaemonOrLocal } from "../engine/dispatch.js";

export async function run(argv) {
  const { flags } = parseCommandArgs(argv, {
    stdin: { type: "boolean" },
    file: { type: "string" },
    text: { type: "string" },
    "url-context": { type: "string" },
    harness: { type: "string" },
    "no-daemon": { type: "boolean" },
  });

  const text = await resolveInput(flags);
  if (text === null) {
    return emitError("provide input via --text, --file, or --stdin", { code: "no_input", exitCode: EXIT.USAGE });
  }

  const config = loadConfig();
  const source = { kind: "cli-scan", url: flags["url-context"] || "", harness: flags.harness || "" };
  const runner = flags["no-daemon"] ? (args) => scan(args) : scanViaDaemonOrLocal;
  const result = await runner({ text, source, config });

  emit(result, { mode: outputMode(flags), text: renderResult(result) });
  return exitFor(result);
}

async function resolveInput(flags) {
  if (typeof flags.text === "string") return flags.text;
  if (flags.file) return readFileSync(flags.file, "utf-8");
  if (flags.stdin || !process.stdin.isTTY) return readStdin();
  return null;
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    process.stdin.on("error", () => resolve(""));
  });
}

export function exitFor(result) {
  if (result.verdict === "blocked") return EXIT.BLOCKED;
  if (result.verdict === "escalated") return EXIT.FLAGGED;
  return EXIT.OK;
}

function renderResult(result) {
  const lines = [`verdict: ${result.verdict}`];
  for (const stage of result.stages.prefilters) {
    const detail = stage.triggered
      ? `TRIGGERED ${stage.findings ? stage.findings.map((f) => f.detectorId).join(",") : ""}${stage.score !== undefined ? ` score=${stage.score.toFixed(3)}` : ""}`
      : stage.error
        ? `error: ${stage.error}`
        : "clean";
    lines.push(`  ${stage.filter}: ${detail}`);
  }
  if (result.stages.review?.ran) lines.push(`  review(${result.stages.review.provider}): ${result.stages.review.verdict} — ${result.stages.review.reason}`);
  if (result.quarantineId) lines.push(`  quarantine: ${result.quarantineId}`);
  if (result.message) lines.push("", result.message);
  return lines.join("\n");
}
