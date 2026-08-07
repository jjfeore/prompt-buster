import { execFile } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseCommandArgs, UsageError } from "../args.js";
import { emit, emitError, outputMode, EXIT } from "../output.js";
import { saveGlobalConfigValue } from "../config.js";
import { runtimeDir, ensureDir } from "../paths.js";
import { downloadModel } from "../engine/filters/wolf.js";
import { loadModel } from "../engine/filters/lightgbm.js";

const RUNTIME_DEPS = {
  // Pin transformers.js; it hard-pins its own onnxruntime-node.
  "@huggingface/transformers": "^4.2.0",
};

export async function run(argv) {
  const { flags, positionals } = parseCommandArgs(argv, {
    dtype: { type: "string" },
    yes: { type: "boolean" },
  });
  const target = positionals[0];
  const mode = outputMode(flags);

  if (target === "lightgbm") return setupLightgbm(mode);
  if (target === "wolf") return setupWolf(flags, mode);
  throw new UsageError("setup <wolf|lightgbm>");
}

function setupLightgbm(mode) {
  try {
    const runner = loadModel();
    emit(
      { filter: "lightgbm", status: "ready", modelRevision: runner.modelRevision, trees: runner.model.trees.length },
      { mode, text: `lightgbm ready (vendored, ${runner.model.trees.length} trees, rev ${runner.modelRevision})` },
    );
    return EXIT.OK;
  } catch (error) {
    return emitError(`lightgbm not ready: ${error.message}`, { code: "lightgbm_error", exitCode: EXIT.ERROR });
  }
}

async function setupWolf(flags, mode) {
  const dtype = flags.dtype || "fp16";
  if (dtype !== "fp16" && dtype !== "mixed") throw new UsageError("--dtype must be fp16 or mixed");
  const steps = [];

  // 1. Install the runtime deps into ~/.prompt-buster/runtime (private install).
  const runtime = ensureDir(runtimeDir());
  const pkgPath = path.join(runtime, "package.json");
  if (!existsSync(pkgPath)) {
    writeFileSync(pkgPath, JSON.stringify({ name: "prompt-buster-runtime", private: true, dependencies: RUNTIME_DEPS }, null, 2) + "\n");
  }
  if (!existsSync(path.join(runtime, "node_modules", "@huggingface", "transformers"))) {
    if (mode === "text") process.stderr.write("installing wolf runtime (this pulls onnxruntime-node, ~270MB)…\n");
    await npmInstall(runtime);
    steps.push("runtime installed");
  } else {
    steps.push("runtime present");
  }

  // 2. Download + verify model artifacts.
  const progress = (p) => {
    if (mode === "text") process.stderr.write(`  ${p.status}: ${p.file}\n`);
  };
  const result = await downloadModel({ onProgress: progress });
  steps.push(`model verified (rev ${result.revision})`);

  // 3. Persist dtype choice.
  saveGlobalConfigValue("filters.wolf.dtype", dtype);

  emit({ filter: "wolf", status: "ready", dtype, steps, modelDir: result.dir }, { mode, text: `wolf ready (dtype ${dtype}).\n${steps.map((s) => `  ✓ ${s}`).join("\n")}` });
  return EXIT.OK;
}

function npmInstall(cwd) {
  return new Promise((resolve, reject) => {
    // Skip the onnxruntime-node CUDA download for a leaner install.
    const args = ["install", "--no-audit", "--no-fund", "--omit=dev", "--onnxruntime-node-install=skip"];
    const cmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = execFile(cmd, args, { cwd, timeout: 600000, windowsHide: true, shell: process.platform === "win32" }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`npm install failed: ${String(stderr || error.message).slice(0, 500)}`));
      resolve(String(stdout || ""));
    });
    child.on("error", reject);
  });
}
