import { UsageError } from "../args.js";
import { EXIT, emitError } from "../output.js";

/**
 * Command dispatcher. Each command module exports `run(argv) -> exitCode`.
 * Loaded lazily so a `scan` invocation never imports the wolf runtime, the
 * installer, etc.
 */
const COMMANDS = {
  scan: () => import("./scan.js"),
  fetch: () => import("./fetch.js"),
  "scan-hook": () => import("./scan-hook.js"),
  review: () => import("./review-cmd.js"),
  release: () => import("./release.js"),
  deny: () => import("./release.js"),
  quarantine: () => import("./quarantine-cmd.js"),
  setup: () => import("./setup.js"),
  doctor: () => import("./doctor.js"),
  config: () => import("./config-cmd.js"),
  patterns: () => import("./patterns.js"),
  install: () => import("./install.js"),
  uninstall: () => import("./install.js"),
  mcp: () => import("./mcp.js"),
  serve: () => import("./serve.js"),
  test: () => import("./self-test.js"),
  version: () => import("./version.js"),
  help: () => import("./help.js"),
};

export async function runCli(argv) {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h") {
    return (await COMMANDS.help()).run([]);
  }
  if (command === "--version" || command === "-v") {
    return (await COMMANDS.version()).run([]);
  }

  const loader = COMMANDS[command];
  if (!loader) {
    return emitError(`unknown command "${command}" (run: prompt-buster help)`, { code: "unknown_command", exitCode: EXIT.USAGE });
  }

  try {
    const mod = await loader();
    // release/deny and quarantine share modules; pass the invoked name through.
    return await mod.run(rest, { command });
  } catch (error) {
    if (error instanceof UsageError) {
      return emitError(error.message, { code: "usage", exitCode: EXIT.USAGE });
    }
    throw error;
  }
}
