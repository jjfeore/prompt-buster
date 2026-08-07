import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { pbHome, ensureDir } from "../paths.js";

/**
 * Localhost-only scan daemon so short-lived entrypoints (hooks, `scan`,
 * `fetch`) don't pay the Wolf model load on every invocation. Binds
 * 127.0.0.1 on a random port; the port + a random bearer token live in
 * ~/.prompt-buster/daemon.json (0600). The daemon is a PERFORMANCE path only —
 * callers must always be able to fall back to in-process scanning.
 */

export function daemonInfoPath() {
  return path.join(pbHome(), "daemon.json");
}

export function readDaemonInfo() {
  const file = daemonInfoPath();
  if (!existsSync(file)) return null;
  try {
    const info = JSON.parse(readFileSync(file, "utf-8"));
    if (info && info.port && info.token) return info;
  } catch {
    // fall through
  }
  return null;
}

function tokensMatch(a, b) {
  const bufA = Buffer.from(String(a || ""));
  const bufB = Buffer.from(String(b || ""));
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** POST /scan to a running daemon. Returns the ScanResult or throws. */
export async function scanViaDaemon({ text, source, timeoutMs = 8000 }) {
  const info = readDaemonInfo();
  if (!info) throw new Error("daemon not running");
  const response = await fetch(`http://127.0.0.1:${info.port}/scan`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${info.token}` },
    body: JSON.stringify({ text, source }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`daemon responded ${response.status}`);
  return response.json();
}

export async function pingDaemon(timeoutMs = 1500) {
  const info = readDaemonInfo();
  if (!info) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${info.port}/healthz`, {
      headers: { authorization: `Bearer ${info.token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Start the daemon in-process (used by `prompt-buster serve`). Loads config
 * once, warms filters, and idle-exits after idleMinutes with no requests.
 */
export async function startDaemon({ idleMinutes = 30, loadConfig, scan } = {}) {
  const config = loadConfig();
  const token = randomBytes(24).toString("base64url");
  const idleMs = Math.max(1, idleMinutes) * 60 * 1000;
  let idleTimer;

  const server = createServer((req, res) => {
    resetIdle();
    const auth = req.headers.authorization || "";
    const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!tokensMatch(provided, token)) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.method === "POST" && req.url === "/scan") {
      collectBody(req, async (body) => {
        try {
          const { text, source } = JSON.parse(body || "{}");
          const result = await scan({ text: String(text || ""), source: source || {}, config });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (error) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: String(error?.message || error) }));
        }
      });
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => shutdown(), idleMs);
    idleTimer.unref?.();
  }
  function shutdown() {
    try {
      rmSync(daemonInfoPath(), { force: true });
    } catch {
      // ignore
    }
    server.close(() => process.exit(0));
  }

  await new Promise((resolve, reject) => {
    server.on("error", reject);
    // Port 0 => OS picks a free port; bind loopback only.
    server.listen(0, "127.0.0.1", resolve);
  });

  const port = server.address().port;
  ensureDir(pbHome());
  writeFileSync(daemonInfoPath(), JSON.stringify({ port, token, pid: process.pid, startedAt: new Date().toISOString() }, null, 2) + "\n", { mode: 0o600 });
  resetIdle();
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return { port, token, server };
}

function collectBody(req, done) {
  const chunks = [];
  let total = 0;
  req.on("data", (c) => {
    total += c.length;
    if (total > 8 * 1024 * 1024) {
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on("end", () => done(Buffer.concat(chunks).toString("utf-8")));
  req.on("error", () => done(""));
}
