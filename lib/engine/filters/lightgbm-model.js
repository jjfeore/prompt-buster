/**
 * Minimal LightGBM Booster (text format) parser + predictor.
 *
 * Implements exactly the decision semantics from LightGBM's tree.h so scores
 * match the Python `lightgbm` runtime that trained the vendored model
 * (revision 2026-05-19-piguard-direct-booster). See .planning/RESEARCH.md R-6
 * for the source-level citations. Only numerical splits are supported; the
 * parser asserts num_cat == 0 (true for this model) rather than silently
 * mishandling categorical splits.
 */

const kZeroThreshold = 1e-35;

// missing_type enum: 0 None, 1 Zero, 2 NaN.
const MISSING_NONE = 0;
const MISSING_ZERO = 1;
const MISSING_NAN = 2;

export class LightGBMModel {
  constructor({ trees, maxFeatureIdx, sigmoid, objective }) {
    this.trees = trees;
    this.maxFeatureIdx = maxFeatureIdx;
    this.sigmoid = sigmoid;
    this.objective = objective;
  }

  /** Number of features the booster expects (maxFeatureIdx + 1). */
  get numFeatures() {
    return this.maxFeatureIdx + 1;
  }

  /** Raw margin = sum of leaf values across trees (shrinkage already baked in). */
  rawScore(features, numIteration = this.trees.length) {
    const limit = Math.min(numIteration ?? this.trees.length, this.trees.length);
    let sum = 0;
    for (let t = 0; t < limit; t += 1) {
      sum += leafValue(this.trees[t], features);
    }
    return sum;
  }

  /** Probability for a binary objective. */
  predict(features, numIteration) {
    const raw = this.rawScore(features, numIteration);
    if (this.objective === "binary") {
      return 1 / (1 + Math.exp(-this.sigmoid * raw));
    }
    return raw;
  }
}

/** Walk one tree and return its leaf value for the feature row. */
function leafValue(tree, features) {
  let node = 0;
  // Children >= 0 are internal node indices; negative encodes a leaf as ~leafIdx.
  while (node >= 0) {
    node = numericalDecision(tree, node, features[tree.splitFeature[node]]);
  }
  return tree.leafValue[~node];
}

function numericalDecision(tree, node, rawValue) {
  const decisionType = tree.decisionType[node];
  const defaultLeft = (decisionType & 2) > 0;
  const missingType = (decisionType >> 2) & 3;

  let fval = rawValue;
  const isNan = Number.isNaN(fval);
  if (isNan && missingType !== MISSING_NAN) {
    fval = 0.0;
  }
  if (
    (missingType === MISSING_ZERO && isZero(fval)) ||
    (missingType === MISSING_NAN && Number.isNaN(fval))
  ) {
    return defaultLeft ? tree.leftChild[node] : tree.rightChild[node];
  }
  return fval <= tree.threshold[node] ? tree.leftChild[node] : tree.rightChild[node];
}

function isZero(value) {
  return value >= -kZeroThreshold && value <= kZeroThreshold;
}

/**
 * Parse a LightGBM text model. Tolerant of the leading `tree` header block and
 * per-tree `Tree=N` sections; only the fields the predictor needs are read.
 */
export function parseLightGBMModel(text) {
  const lines = String(text).split(/\r?\n/);
  const header = {};
  const trees = [];

  let i = 0;
  // Header key=value lines until the first `Tree=`.
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith("Tree=")) break;
    const eq = line.indexOf("=");
    if (eq > 0) header[line.slice(0, eq)] = line.slice(eq + 1);
  }

  const maxFeatureIdx = parseInt(header.max_feature_idx, 10);
  const objectiveLine = header.objective || "";
  const objective = objectiveLine.startsWith("binary") ? "binary" : objectiveLine.split(" ")[0] || "";
  const sigmoid = parseSigmoid(objectiveLine);

  // Each Tree section is a block of key=value lines terminated by a blank line.
  while (i < lines.length) {
    if (!lines[i].startsWith("Tree=")) {
      i += 1;
      continue;
    }
    const block = {};
    i += 1;
    for (; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.trim() === "" || line.startsWith("Tree=")) break;
      const eq = line.indexOf("=");
      if (eq > 0) block[line.slice(0, eq)] = line.slice(eq + 1);
    }
    trees.push(parseTree(block));
  }

  if (!Number.isFinite(maxFeatureIdx)) throw new Error("LightGBM model missing max_feature_idx");
  if (trees.length === 0) throw new Error("LightGBM model contains no trees");

  return new LightGBMModel({ trees, maxFeatureIdx, sigmoid, objective });
}

function parseTree(block) {
  const numCat = parseInt(block.num_cat ?? "0", 10) || 0;
  if (numCat !== 0) {
    throw new Error("LightGBM model uses categorical splits (num_cat > 0), which this predictor does not support");
  }
  const splitFeature = intArray(block.split_feature);
  const threshold = floatArray(block.threshold);
  const leftChild = intArray(block.left_child);
  const rightChild = intArray(block.right_child);
  const leafValue = floatArray(block.leaf_value);
  const decisionType = block.decision_type ? intArray(block.decision_type) : new Int32Array(splitFeature.length);

  if (
    splitFeature.length !== threshold.length ||
    splitFeature.length !== leftChild.length ||
    splitFeature.length !== rightChild.length ||
    splitFeature.length !== decisionType.length
  ) {
    throw new Error("LightGBM tree has inconsistent internal-node array lengths");
  }
  return { splitFeature, threshold, leftChild, rightChild, leafValue, decisionType };
}

function parseSigmoid(objectiveLine) {
  const match = /sigmoid:([0-9eE.+-]+)/.exec(objectiveLine);
  const value = match ? parseFloat(match[1]) : 1.0;
  return Number.isFinite(value) && value > 0 ? value : 1.0;
}

function intArray(str) {
  if (!str) return new Int32Array(0);
  const parts = str.split(" ");
  const out = new Int32Array(parts.length);
  for (let k = 0; k < parts.length; k += 1) out[k] = parseInt(parts[k], 10);
  return out;
}

function floatArray(str) {
  if (!str) return new Float64Array(0);
  const parts = str.split(" ");
  const out = new Float64Array(parts.length);
  for (let k = 0; k < parts.length; k += 1) out[k] = parseFloat(parts[k]);
  return out;
}
