import { readFileSync } from "node:fs";
import path from "node:path";
import { packageRoot } from "../paths.js";
import { emit, outputMode } from "../output.js";

export function pkgVersion() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(packageRoot(), "package.json"), "utf-8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export async function run() {
  const version = pkgVersion();
  emit({ name: "prompt-buster", version }, { mode: outputMode({}), text: `prompt-buster ${version}` });
  return 0;
}
