import { parseCommandArgs } from "../args.js";
import { loadConfig } from "../config.js";
import { startDaemon } from "../engine/daemon.js";
import { scan } from "../engine/pipeline.js";

export async function run(argv) {
  const { flags } = parseCommandArgs(argv, { "idle-minutes": { type: "string" } });
  const config = loadConfig();
  const idleMinutes = flags["idle-minutes"] ? Number(flags["idle-minutes"]) : config.daemon.idleMinutes;

  const { port } = await startDaemon({ idleMinutes, loadConfig, scan });
  process.stderr.write(JSON.stringify({ status: "listening", port, idleMinutes }) + "\n");

  // Keep the process alive; the daemon idle-exits on its own.
  await new Promise(() => {});
  return 0;
}
