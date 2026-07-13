import { emit, outputMode } from "../output.js";

const HELP = `prompt-buster — local prompt-injection firewall for AI agents

USAGE
  prompt-buster <command> [options]

SCANNING
  scan [--stdin | --file <p> | --text <s>] [--url-context <u>] [--harness <h>]
                       Scan text; exit 3 if flagged/escalated, 4 if blocked.
  fetch <url> [--raw-html]
                       Guarded fetch: fetch -> extract -> scan -> emit or block.

QUARANTINE / ESCALATION
  review [id]          Interactively review a quarantined item (list if no id).
  release <id> [--note "<text>"]   Allow a quarantined item (agent/YOLO path).
  deny <id>            Reject a quarantined item.
  quarantine list | show <id> | clear

CONFIGURATION
  config get|set|unset|list|path [key] [value]
  patterns list | add | remove <id> | test <text>

SETUP / DIAGNOSTICS
  setup wolf [--dtype fp16|mixed]   Install the Wolf Defender runtime + model.
  setup lightgbm                    Verify the vendored LightGBM classifier.
  doctor               Report filters, providers, and versions.
  test [--attack|--benign]          Run the bundled corpus through the pipeline.

INTEGRATION
  install [--claude|--codex|--openclaw|--hermes|--opencode|--all] [--global|--project] [--force]
  uninstall [same targets]
  mcp                  Run the stdio MCP server (used by harness configs).
  serve [--idle-minutes n]          Run the localhost scan daemon.

GLOBAL
  --output json|text   Output format (defaults to json when not a TTY).
  --version, --help

Docs: https://github.com/jjfeore/prompt-buster`;

export async function run() {
  const mode = outputMode({});
  emit({ help: HELP }, { mode, text: HELP });
  return 0;
}
