#!/usr/bin/env node
import { runCli } from "../lib/commands/index.js";

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (Number.isFinite(nodeMajor) && nodeMajor < 18) {
  process.stderr.write(
    JSON.stringify({ error: { code: "unsupported_node", message: `prompt-buster requires Node >= 18 (found ${process.versions.node})` } }) + "\n",
  );
  process.exit(1);
}

runCli(process.argv.slice(2)).then(
  (code) => process.exit(code ?? 0),
  (error) => {
    process.stderr.write(JSON.stringify({ error: { code: "fatal", message: String(error?.stack || error?.message || error) } }) + "\n");
    process.exit(1);
  },
);
