import { parseArgs } from "node:util";

export class UsageError extends Error {}

/**
 * Strict per-command flag parsing on top of util.parseArgs (Node 18.3+).
 * `spec` maps flag name -> { type: "string"|"boolean", short?, multiple?, default? }.
 */
export function parseCommandArgs(argv, spec, { allowPositionals = true } = {}) {
  const options = {
    output: { type: "string" },
    ...spec,
  };
  try {
    const { values, positionals } = parseArgs({ args: argv, options, allowPositionals, strict: true });
    if (values.output && values.output !== "json" && values.output !== "text") {
      throw new UsageError(`--output must be "json" or "text"`);
    }
    return { flags: values, positionals };
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError(error.message);
  }
}
