import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseCommandArgs } from "../args.js";
import { emit, outputMode } from "../output.js";
import { loadConfig } from "../config.js";
import { pbHome, runtimeDir, wolfModelDir, assetsDir } from "../paths.js";
import { readDaemonInfo, pingDaemon } from "../engine/daemon.js";
import { pkgVersion } from "./version.js";

export async function run(argv) {
  const { flags } = parseCommandArgs(argv, {});
  const config = loadConfig();

  const report = {
    version: pkgVersion(),
    node: process.versions.node,
    platform: `${process.platform}/${process.arch}`,
    home: pbHome(),
    filters: {
      regex: { available: true },
      lightgbm: lightgbmStatus(),
      wolf: await wolfStatus(config),
    },
    review: {
      provider: config.review.provider,
      claudeCli: await cliVersion("claude"),
      codexCli: await cliVersion("codex"),
      anthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
      openaiKey: Boolean(process.env.OPENAI_API_KEY),
    },
    daemon: { running: Boolean(readDaemonInfo()) && (await pingDaemon()), enabled: config.daemon.enabled },
    prefilters: { order: config.prefilters.order, mode: config.prefilters.mode, failMode: config.prefilters.failMode },
    escalation: config.escalation.mode,
    configSources: config._meta?.sources,
    warnings: config._meta?.warnings || [],
  };

  emit(report, { mode: outputMode(flags), text: renderText(report) });
  return 0;
}

function lightgbmStatus() {
  const model = path.join(assetsDir(), "models", "lightgbm", "model.txt");
  return { available: existsSync(model), model };
}

async function wolfStatus(config) {
  if (config.filters.wolf.mode === "http") {
    return { mode: "http", url: config.filters.wolf.http.url || "(unset)", available: Boolean(config.filters.wolf.http.url) };
  }
  const runtimeReady = existsSync(path.join(runtimeDir(), "node_modules", "@huggingface", "transformers"));
  const modelReady = existsSync(path.join(wolfModelDir(), "config.json"));
  return {
    mode: "local",
    runtimeInstalled: runtimeReady,
    modelDownloaded: modelReady,
    available: runtimeReady && modelReady,
    hint: runtimeReady && modelReady ? undefined : "run: prompt-buster setup wolf",
  };
}

function cliVersion(bin) {
  return new Promise((resolve) => {
    execFile(bin, ["--version"], { timeout: 5000, windowsHide: true }, (error, stdout) => {
      resolve(error ? false : String(stdout).trim().split("\n")[0]);
    });
  });
}

function renderText(report) {
  const lines = [
    `prompt-buster ${report.version}  (node ${report.node}, ${report.platform})`,
    `home: ${report.home}`,
    "",
    "filters:",
    `  regex     : ok`,
    `  lightgbm  : ${report.filters.lightgbm.available ? "ok (vendored)" : "MISSING model"}`,
    `  wolf      : ${report.filters.wolf.available ? "ok" : `not ready — ${report.filters.wolf.hint || "http url unset"}`}`,
    "",
    "review providers:",
    `  claude cli: ${report.review.claudeCli || "not found"}`,
    `  codex cli : ${report.review.codexCli || "not found"}`,
    `  ANTHROPIC_API_KEY: ${report.review.anthropicKey ? "set" : "unset"}`,
    `  OPENAI_API_KEY   : ${report.review.openaiKey ? "set" : "unset"}`,
    "",
    `daemon: ${report.daemon.running ? "running" : "not running"}`,
    `prefilters: [${report.prefilters.order.join(", ")}] mode=${report.prefilters.mode} failMode=${report.prefilters.failMode}`,
    `escalation: ${report.escalation}`,
  ];
  if (report.warnings.length) lines.push("", "warnings:", ...report.warnings.map((w) => `  ! ${w}`));
  return lines.join("\n");
}
