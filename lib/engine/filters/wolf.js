import { createHash } from "node:crypto";
import { createWriteStream, existsSync, readFileSync, mkdirSync, renameSync, statSync, copyFileSync, rmSync } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { packageRoot, wolfModelDir, runtimeDir, ensureDir } from "../../paths.js";
import { overlappingTextChunks } from "../../chunks.js";

/**
 * Stage-2c Wolf Defender classifier (ModernBERT sequence classifier).
 *
 * Two modes:
 *  - "local": in-process inference via @huggingface/transformers, installed
 *    on demand into ~/.prompt-buster/runtime (NOT a package dependency). The
 *    model is loaded warm inside the daemon/MCP server; a per-scan cold load
 *    is avoided by the daemon dispatch.
 *  - "http": Abeeo prompt_guard-compatible /classify service.
 *
 * Injection score = softmax probability of LABEL_1, matching Abeeo's service.
 */

export const name = "wolf";

const HF_REPO = "patronus-studio/wolf-defender-prompt-injection-small";
const REQUEST_MAX_CHARS = 20000;

export async function check(text, { config }) {
  const wolf = config?.filters?.wolf || {};
  const threshold = wolf.threshold ?? 0.5;
  try {
    const score = wolf.mode === "http" ? await scoreViaHttp(text, wolf) : await scoreLocal(text, wolf);
    return {
      triggered: score >= threshold,
      score,
      threshold,
      findings:
        score >= threshold
          ? [
              {
                detectorId: "wolf_defender",
                detectorType: "ml_prompt_injection_classifier",
                description: "The Wolf Defender classifier scored this text as likely prompt injection.",
                source: "wolf",
              },
            ]
          : [],
    };
  } catch (error) {
    return { triggered: false, error: `wolf filter failed: ${String(error?.message || error)}` };
  }
}

// --- HTTP mode (Abeeo prompt_guard /classify) ---------------------------

async function scoreViaHttp(text, wolf) {
  const base = String(wolf.http?.url || "").replace(/\/$/, "");
  if (!base) throw new Error("filters.wolf.http.url is not set");
  const headers = { "content-type": "application/json" };
  if (wolf.http.token) headers.authorization = `Bearer ${wolf.http.token}`;

  let maxScore = 0;
  for (const chunk of overlappingTextChunks(text, { maxChars: REQUEST_MAX_CHARS })) {
    const response = await fetch(`${base}/classify`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: chunk.text, surface: "prompt-buster", field: "content", regex_matches: [] }),
      signal: AbortSignal.timeout(wolf.timeoutMs || 3000),
    });
    if (!response.ok) throw new Error(`prompt guard service responded ${response.status}`);
    const data = await response.json();
    const score = Number(data.injection_score ?? data.score ?? (data.is_injection ? 1 : 0));
    maxScore = Math.max(maxScore, Number.isFinite(score) ? score : 0);
  }
  return maxScore;
}

// --- Local mode (transformers.js) ---------------------------------------

let localRunner = null;

export async function scoreLocal(text, wolf) {
  const runner = await loadLocalRunner(wolf);
  let maxScore = 0;
  for (const chunk of overlappingTextChunks(text, { maxChars: REQUEST_MAX_CHARS })) {
    maxScore = Math.max(maxScore, await runner.score(chunk.text));
  }
  return maxScore;
}

async function loadLocalRunner(wolf) {
  if (localRunner) return localRunner;

  const runtime = runtimeDir();
  const transformersPath = path.join(runtime, "node_modules", "@huggingface", "transformers");
  if (!existsSync(transformersPath)) {
    throw new Error("wolf runtime not installed — run: prompt-buster setup wolf");
  }
  const modelDir = wolfModelDir();
  if (!existsSync(path.join(modelDir, "config.json"))) {
    throw new Error("wolf model not downloaded — run: prompt-buster setup wolf");
  }

  const requireRuntime = createRequire(path.join(runtime, "package.json"));
  const transformers = await import(pathToFileUrl(requireRuntime.resolve("@huggingface/transformers")));
  const { pipeline, env } = transformers;
  env.allowRemoteModels = false;
  env.allowLocalModels = true;

  const dtype = wolf.dtype === "mixed" ? "fp32" : "fp16";
  const subfolder = wolf.dtype === "mixed" ? "onnx/onnx_mixed" : "onnx/onnx_fp16";
  const modelFileName = wolf.dtype === "mixed" ? "model_mixed" : undefined;

  const classifier = await pipeline("text-classification", modelDir, {
    subfolder,
    dtype,
    model_file_name: modelFileName,
    local_files_only: true,
    device: "cpu",
  });

  localRunner = {
    classifier,
    async score(chunkText) {
      // topk 0 => all labels with scores; find LABEL_1 (injection).
      const out = await classifier(chunkText, { topk: 0 });
      const rows = Array.isArray(out[0]) ? out[0] : out;
      const injection = rows.find((r) => /1$/.test(r.label) || /inject/i.test(r.label));
      return injection ? Number(injection.score) : 0;
    },
  };
  return localRunner;
}

// --- Model download (sha256-pinned) -------------------------------------

export function loadManifest() {
  const manifestPath = path.join(packageRoot(), "models", "wolf", "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  if (manifest.schema_version !== 1) throw new Error("unsupported wolf manifest schema");
  if (!/^[0-9a-f]{40}$/.test(String(manifest.revision))) throw new Error("wolf manifest revision must be a 40-char commit sha");
  return manifest;
}

export async function downloadModel({ onProgress } = {}) {
  const manifest = loadManifest();
  const dir = ensureDir(wolfModelDir());

  for (const artifact of manifest.files) {
    const rel = artifact.path;
    if (rel.startsWith("/") || rel.split(/[\\/]/).includes("..")) throw new Error(`unsafe manifest path: ${rel}`);
    const dest = path.join(dir, rel);
    if (existsSync(dest) && statSync(dest).size === artifact.size_bytes && sha256File(dest) === artifact.sha256.toLowerCase()) {
      onProgress?.({ file: rel, status: "cached" });
      continue;
    }
    onProgress?.({ file: rel, status: "downloading", bytes: artifact.size_bytes });
    mkdirSync(path.dirname(dest), { recursive: true });
    const url = `https://huggingface.co/${HF_REPO}/resolve/${manifest.revision}/${encodePath(rel)}`;
    const tmp = `${dest}.part`;
    // Stream to a temp file with a hard byte cap (a malicious mirror must not
    // exhaust disk before the size check), then verify size + sha256 on the
    // temp file, and only rename into place AFTER both checks pass. Unverified
    // bytes never occupy the canonical path.
    try {
      await downloadTo(url, tmp, artifact.size_bytes);
      const actualSize = statSync(tmp).size;
      if (actualSize !== artifact.size_bytes) throw new Error(`size mismatch for ${rel}: expected ${artifact.size_bytes}, got ${actualSize}`);
      const actualHash = sha256File(tmp);
      if (actualHash !== artifact.sha256.toLowerCase()) throw new Error(`sha256 mismatch for ${rel}: expected ${artifact.sha256}, got ${actualHash}`);
      renameSync(tmp, dest);
    } catch (error) {
      try {
        rmSync(tmp, { force: true });
      } catch {
        // best-effort cleanup
      }
      throw error;
    }
    onProgress?.({ file: rel, status: "verified" });
  }

  // transformers.js reads tokenizer.json + tokenizer_config.json from the model
  // ROOT (subfolder only applies to ONNX weights). Copy them up if needed.
  for (const name of ["tokenizer.json", "tokenizer_config.json", "special_tokens_map.json"]) {
    const src = path.join(dir, "onnx", "onnx_fp16", name);
    const rootDest = path.join(dir, name);
    if (existsSync(src) && !existsSync(rootDest)) copyFileSync(src, rootDest);
  }
  return { dir, revision: manifest.revision, files: manifest.files.map((f) => f.path) };
}

async function downloadTo(url, tmpPath, expectedBytes) {
  const response = await fetch(url, { redirect: "follow", headers: { "User-Agent": "prompt-buster" } });
  if (!response.ok) throw new Error(`download failed ${response.status} for ${url}`);
  // Abort the stream if it exceeds a small multiple of the pinned size.
  const cap = Math.max(1024, Math.ceil((expectedBytes || 0) * 1.5) + 1024 * 1024);
  let written = 0;
  const guard = new Transform({
    transform(chunk, _enc, cb) {
      written += chunk.length;
      if (written > cap) {
        cb(new Error(`download exceeded expected size cap (${cap} bytes) — refusing`));
        return;
      }
      cb(null, chunk);
    },
  });
  await streamPipeline(Readable.fromWeb(response.body), guard, createWriteStream(tmpPath));
}

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function encodePath(rel) {
  return rel.split("/").map(encodeURIComponent).join("/");
}

function pathToFileUrl(p) {
  const resolved = path.resolve(p).replace(/\\/g, "/");
  return `file://${resolved.startsWith("/") ? "" : "/"}${resolved}`;
}

export function _reset() {
  localRunner = null;
}
