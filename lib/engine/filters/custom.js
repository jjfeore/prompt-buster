import { execFile } from "node:child_process";

/**
 * User-defined classifiers (SPEC §3-2d). Two transports:
 *  - http:    POST {text, ...} to an Abeeo /classify-compatible endpoint.
 *  - command: execFile (never shell), write {"text": "..."} to stdin,
 *             read {"score": 0..1, "label"?} from stdout.
 * A filter error surfaces as {triggered:false, error} so the pipeline applies
 * failMode rather than crashing.
 */

export function makeCustomFilter(spec, deps = {}) {
  const doFetch = deps.fetch || fetch;
  const runCommand = deps.runCommand || runCommandDefault;
  const threshold = typeof spec.threshold === "number" ? spec.threshold : 0.5;
  const timeoutMs = spec.timeoutMs || 3000;

  return {
    name: spec.name,
    async check(text) {
      try {
        const { score, label } = spec.type === "http"
          ? await callHttp(spec, text, timeoutMs, doFetch)
          : await callCommand(spec, text, timeoutMs, runCommand);
        const triggered = score >= threshold;
        return {
          triggered,
          score,
          threshold,
          findings: triggered
            ? [
                {
                  detectorId: `custom_${spec.name}`,
                  detectorType: "custom_classifier",
                  description: `Custom classifier "${spec.name}" scored this text above its threshold.`,
                  source: label || "custom",
                },
              ]
            : [],
        };
      } catch (error) {
        return { triggered: false, error: `custom filter "${spec.name}" failed: ${String(error?.message || error)}` };
      }
    },
  };
}

async function callHttp(spec, text, timeoutMs, doFetch) {
  const headers = { "content-type": "application/json" };
  if (spec.token) headers.authorization = `Bearer ${spec.token}`;
  const response = await doFetch(spec.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ text, surface: "prompt-buster", field: "content", regex_matches: [] }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`http ${response.status}`);
  const data = await response.json();
  return { score: normalizeScore(data), label: data.label || data.prediction || "" };
}

async function callCommand(spec, text, timeoutMs, runCommand) {
  const stdout = await runCommand(spec.command, spec.args || [], JSON.stringify({ text }), timeoutMs);
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error("classifier stdout was not JSON");
  }
  return { score: normalizeScore(data), label: data.label || "" };
}

function normalizeScore(data) {
  for (const key of ["injection_score", "score", "probability"]) {
    if (key in data) {
      const value = Number(data[key]);
      if (Number.isFinite(value)) return value;
    }
  }
  if (typeof data.is_injection === "boolean") return data.is_injection ? 1 : 0;
  throw new Error("classifier response had no score");
}

function runCommandDefault(command, args, stdin, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) return reject(error);
      resolve(String(stdout || ""));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
  });
}
