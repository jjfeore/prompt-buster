import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCommandArgs } from "../args.js";
import { emit, outputMode, EXIT } from "../output.js";
import { loadConfig } from "../config.js";
import { assetsDir } from "../paths.js";
import { check as regexCheck } from "../engine/filters/regex.js";
import { check as lightgbmCheck } from "../engine/filters/lightgbm.js";

/**
 * Smoke-level quality gate: run bundled attack/benign corpora through the
 * regex + lightgbm filters (the always-available ones — no wolf download) and
 * report catch-rate on attacks and false-positive rate on benign text.
 */
export async function run(argv) {
  const { flags } = parseCommandArgs(argv, { attack: { type: "boolean" }, benign: { type: "boolean" } });
  const mode = outputMode(flags);
  const config = loadConfig();
  const corpusDir = path.join(assetsDir(), "corpus");

  const runOne = async (text) => {
    const regex = await regexCheck(text, { config });
    if (regex.triggered) return { flagged: true, by: "regex" };
    const lgbm = await lightgbmCheck(text, { config: { filters: { lightgbm: { threshold: config.filters.lightgbm.threshold } } } });
    return { flagged: lgbm.triggered, by: lgbm.triggered ? "lightgbm" : "none", score: lgbm.score };
  };

  const report = {};
  if (!flags.benign) {
    const attacks = JSON.parse(readFileSync(path.join(corpusDir, "attacks.json"), "utf-8"));
    const results = await Promise.all(attacks.map(runOne));
    const caught = results.filter((r) => r.flagged).length;
    report.attacks = { total: attacks.length, caught, catchRate: caught / attacks.length, missed: attacks.filter((_, i) => !results[i].flagged) };
  }
  if (!flags.attack) {
    const benign = JSON.parse(readFileSync(path.join(corpusDir, "benign.json"), "utf-8"));
    const results = await Promise.all(benign.map(runOne));
    const flagged = results.filter((r) => r.flagged).length;
    report.benign = { total: benign.length, falsePositives: flagged, fpRate: flagged / benign.length, flagged: benign.filter((_, i) => results[i].flagged) };
  }

  emit(report, { mode, text: renderText(report) });
  return report.attacks && report.attacks.catchRate < 0.8 ? EXIT.ERROR : EXIT.OK;
}

function renderText(report) {
  const lines = [];
  if (report.attacks) {
    lines.push(`attacks : ${report.attacks.caught}/${report.attacks.total} caught (${(report.attacks.catchRate * 100).toFixed(0)}%)`);
    for (const m of report.attacks.missed) lines.push(`  MISSED: ${m.slice(0, 70)}`);
  }
  if (report.benign) {
    lines.push(`benign  : ${report.benign.falsePositives}/${report.benign.total} false positives (${(report.benign.fpRate * 100).toFixed(0)}%)`);
    for (const f of report.benign.flagged) lines.push(`  FP: ${f.slice(0, 70)}`);
  }
  return lines.join("\n");
}
