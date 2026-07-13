import { parseCommandArgs } from "../args.js";
import { emit, emitError, outputMode, EXIT } from "../output.js";
import { loadConfig } from "../config.js";
import { releaseQuarantine, denyQuarantine, QuarantineError } from "../engine/quarantine.js";

/** Handles both `release <id> [--note]` and `deny <id>`. */
export async function run(argv, { command } = {}) {
  const { flags, positionals } = parseCommandArgs(argv, { note: { type: "string" } });
  const id = positionals[0];
  const mode = outputMode(flags);
  if (!id) return emitError(`${command} <quarantine-id>`, { code: "usage", exitCode: EXIT.USAGE });

  const config = loadConfig();
  try {
    if (command === "deny") {
      const entry = denyQuarantine(id, { config, actor: "cli" });
      emit({ id, status: entry.status }, { mode, text: `denied ${id}` });
      return EXIT.OK;
    }
    const entry = releaseQuarantine(id, { note: flags.note || "", config, actor: "cli" });
    emit(
      { id, status: entry.status, note: entry.note, content: entry.content },
      { mode, text: `released ${id}${entry.note ? ` with note: ${entry.note}` : ""}` },
    );
    return EXIT.OK;
  } catch (error) {
    if (error instanceof QuarantineError) return emitError(error.message, { code: "quarantine_error", exitCode: EXIT.ERROR });
    throw error;
  }
}
