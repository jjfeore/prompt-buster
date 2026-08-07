import { emit, outputMode } from "../output.js";
import { VERSION } from "../version-info.js";

export function pkgVersion() {
  return VERSION;
}

export async function run(argv = []) {
  const mode = outputMode({ output: argv.includes("--output") ? argv[argv.indexOf("--output") + 1] : undefined });
  emit({ name: "prompt-buster", version: VERSION }, { mode, text: `prompt-buster ${VERSION}` });
  return 0;
}
