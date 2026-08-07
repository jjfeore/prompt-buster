import { parseCommandArgs, UsageError } from "../args.js";
import { emit, emitError, outputMode, EXIT } from "../output.js";
import { loadConfig } from "../config.js";
import { listQuarantine, getQuarantine, clearQuarantine } from "../engine/quarantine.js";
import { stripControl, redactSecrets } from "../sanitize.js";

export async function run(argv) {
  const { flags, positionals } = parseCommandArgs(argv, {});
  const [action, id] = positionals;
  const mode = outputMode(flags);
  const config = loadConfig();

  switch (action) {
    case "list":
    case undefined: {
      const entries = listQuarantine(config, { includeResolved: true }).map(summarize);
      emit({ entries }, { mode, text: renderList(entries) });
      return EXIT.OK;
    }
    case "show": {
      if (!id) throw new UsageError("quarantine show <id>");
      const entry = getQuarantine(id, config);
      if (!entry) return emitError(`no quarantine entry ${id}`, { code: "not_found", exitCode: EXIT.ERROR });
      const safe = { ...summarize(entry), content: stripControl(redactSecrets(entry.content).text) };
      emit(safe, { mode, text: `${safe.id} [${safe.status}]\n${safe.content}` });
      return EXIT.OK;
    }
    case "clear": {
      const removed = clearQuarantine(config);
      emit({ removed }, { mode, text: `cleared ${removed} quarantine entries` });
      return EXIT.OK;
    }
    default:
      throw new UsageError(`unknown quarantine action "${action}" (list|show|clear)`);
  }
}

function summarize(entry) {
  const detectors = [];
  for (const stage of entry.scan?.prefilters ?? []) {
    if (stage.triggered) detectors.push(...(stage.findings || []).map((f) => f.detectorId));
  }
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    status: entry.status,
    source: entry.source,
    detectors,
    contentSha256: entry.contentSha256,
    reviewVerdict: entry.scan?.review?.verdict,
  };
}

function renderList(entries) {
  if (!entries.length) return "no quarantine entries";
  return entries
    .map((e) => `${e.id} [${e.status}] ${e.createdAt} ${e.source?.url || e.source?.kind || ""} — ${e.detectors.join(",")}`)
    .join("\n");
}
