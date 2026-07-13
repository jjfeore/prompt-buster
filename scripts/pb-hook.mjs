#!/usr/bin/env node
// Claude Code PostToolUse hook entry. The plugin root IS the package, so this
// delegates straight into the scan-hook command. Kept thin on purpose.
import { run } from "../lib/commands/scan-hook.js";

run(["--harness", "claude"]).then(
  (code) => process.exit(code ?? 0),
  () => {
    // Never let a hook crash break the agent's tool flow.
    process.stdout.write("{}\n");
    process.exit(0);
  },
);
