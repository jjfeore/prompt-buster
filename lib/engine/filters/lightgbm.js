import { readFileSync } from "node:fs";
import path from "node:path";
import { packageRoot } from "../../paths.js";
import { overlappingTextChunks } from "../../chunks.js";
import { directFeatureDense, totalFeatureCount } from "./lightgbm-features.js";
import { parseLightGBMModel } from "./lightgbm-model.js";

/**
 * Stage-2b LightGBM prefilter — the low-resource classifier. Pure JS, no
 * native deps: vendored booster + hashed-ngram features, scored per chunk with
 * the max taken. Threshold is a single value (SPEC decision D-4).
 */

export const name = "lightgbm";

let cached = null;

export function loadModel({ modelDir } = {}) {
  if (cached && !modelDir) return cached;
  const dir = modelDir || path.join(packageRoot(), "models", "lightgbm");
  const metadata = JSON.parse(readFileSync(path.join(dir, "metadata.json"), "utf-8"));
  const config = metadata.direct_feature_config;
  const model = parseLightGBMModel(readFileSync(path.join(dir, "model.txt"), "utf-8"));

  const totalFeatures = totalFeatureCount(config);
  const expected = metadata.direct_feature_total_features || totalFeatures;
  if (expected !== totalFeatures) {
    throw new Error(`LightGBM feature count mismatch: metadata says ${expected}, features produce ${totalFeatures}`);
  }
  if (model.numFeatures !== totalFeatures) {
    throw new Error(`LightGBM booster expects ${model.numFeatures} features, metadata says ${totalFeatures}`);
  }

  const runner = {
    config,
    metadata,
    model,
    totalFeatures,
    bestIteration: metadata.best_iteration ?? model.trees.length,
    modelRevision: metadata.model_revision || "",
    score(text) {
      const row = directFeatureDense(text, config, totalFeatures);
      return model.predict(row, this.bestIteration);
    },
  };
  if (!modelDir) cached = runner;
  return runner;
}

export async function check(text, { config }) {
  const threshold = config?.filters?.lightgbm?.threshold ?? 0.86;
  let runner;
  try {
    runner = loadModel();
  } catch (error) {
    return { triggered: false, error: `lightgbm model load failed: ${error.message}` };
  }

  const maxChars = Math.max(1, Number(runner.config.max_chars) || 4096);
  let score = 0;
  for (const chunk of overlappingTextChunks(text, { maxChars })) {
    score = Math.max(score, runner.score(chunk.text));
  }

  return {
    triggered: score >= threshold,
    score,
    threshold,
    modelRevision: runner.modelRevision,
    findings:
      score >= threshold
        ? [
            {
              detectorId: "lightgbm_prompt_prefilter",
              detectorType: "ml_prompt_injection_prefilter",
              description: "A trained classifier scored this text as likely prompt injection or jailbreaking.",
              source: "lightgbm",
            },
          ]
        : [],
  };
}

/** Test hook: reset the process-cached model. */
export function _resetCache() {
  cached = null;
}
