import { parseCommandArgs } from "../args.js";
import { emit, emitError, outputMode, EXIT } from "../output.js";
import { loadConfig } from "../config.js";
import { boundedFetch, FetchError } from "../http.js";
import { toScannableText } from "../engine/extract.js";
import { scanViaDaemonOrLocal } from "../engine/dispatch.js";
import { exitFor } from "./scan.js";

export async function run(argv) {
  const { flags, positionals } = parseCommandArgs(argv, {
    "raw-html": { type: "boolean" },
    harness: { type: "string" },
  });
  const url = positionals[0];
  const mode = outputMode(flags);
  if (!url) return emitError("fetch <url>", { code: "usage", exitCode: EXIT.USAGE });

  const config = loadConfig();
  let fetched;
  try {
    fetched = await boundedFetch(url, {
      timeoutMs: config.fetch.timeoutMs,
      maxRedirects: config.fetch.maxRedirects,
      maxBytes: config.scan.maxContentBytes,
      userAgent: config.fetch.userAgent || "prompt-buster",
    });
  } catch (error) {
    if (error instanceof FetchError) return emitError(error.message, { code: error.code, exitCode: EXIT.ERROR });
    throw error;
  }

  const text = toScannableText(fetched.body.text, fetched.contentType, {
    includeRawHtml: Boolean(flags["raw-html"]) || config.scan.includeRawHtml,
  });
  const result = await scanViaDaemonOrLocal({ text, source: { kind: "cli-fetch", url: fetched.url, harness: flags.harness || "" }, config });

  emit(result, { mode, text: result.allowed && result.content !== undefined ? result.content : result.message || `blocked: ${result.verdict}` });
  return exitFor(result);
}
