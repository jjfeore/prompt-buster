import { spawn } from "node:child_process";
import path from "node:path";
import { scan } from "./pipeline.js";
import { pingDaemon, scanViaDaemon, readDaemonInfo } from "./daemon.js";
import { cliEntryPath } from "../paths.js";

/**
 * Choose between the warm daemon and in-process scanning. The daemon only
 * matters when the chain includes the local Wolf filter (heavy model load);
 * for everything else in-process is both correct and fast. The daemon path is
 * best-effort: any failure falls back to in-process so a scan never fails just
 * because the daemon is unavailable.
 */
export async function scanViaDaemonOrLocal({ text, source, config }) {
  if (!needsDaemon(config)) {
    return scan({ text, source, config });
  }

  if (await ensureDaemon(config)) {
    try {
      return await scanViaDaemon({ text, source });
    } catch {
      // fall through to in-process
    }
  }

  // In-process fallback: we don't pay Wolf's cold model load in a short-lived
  // process, so present Wolf as unavailable and let failMode govern the
  // outcome (open => continue with the other filters; closed => escalate).
  const wolfUnavailable = {
    check: async () => ({ triggered: false, error: "wolf unavailable: daemon could not be started for this short-lived scan" }),
  };
  return scan({ text, source, config, filters: { wolf: wolfUnavailable } });
}

function needsDaemon(config) {
  if (config?.daemon?.enabled === false) return false;
  const chain = config?.prefilters?.order || [];
  const wolfLocal = config?.filters?.wolf?.mode !== "http";
  return chain.includes("wolf") && wolfLocal;
}

async function ensureDaemon(config) {
  if (readDaemonInfo() && (await pingDaemon())) return true;
  return spawnDaemon(config);
}

async function spawnDaemon(config) {
  const startTimeout = config?.daemon?.startTimeoutMs ?? 2000;
  const bin = cliEntryPath();
  try {
    const child = spawn(process.execPath, [bin, "serve"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch {
    return false;
  }
  // Poll for readiness up to startTimeout.
  const deadline = Date.now() + startTimeout;
  while (Date.now() < deadline) {
    if (await pingDaemon(500)) return true;
    await delay(150);
  }
  return false;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// re-export for callers that want raw in-process scanning
export { scan };
export const _internal = { needsDaemon };
