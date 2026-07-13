/**
 * OpenCode plugin: firewall web-tool results through PromptBuster.
 *
 * Registers `tool.execute.after` and mutates the tool output IN PLACE — the
 * mutated object is what the model sees (OpenCode passes it by reference).
 * Handles both built-in tool shape ({title, output}) and MCP tool shape
 * ({content: [{type:"text", text}]}). Blocks by throwing.
 *
 * Runtime note: OpenCode may run under Node or Bun; we shell out to the
 * prompt-buster CLI via node:child_process rather than relying on Bun's `$`.
 * Register in opencode.json:  { "plugin": ["prompt-buster/opencode"] }
 * or drop this file into .opencode/plugins/.
 */

import { execFile } from "node:child_process";

const WEB_TOOLS = new Set(["webfetch", "web_fetch", "websearch", "web_search", "fetch"]);

export const PromptBusterPlugin = async () => ({
  "tool.execute.after": async (input, output) => {
    if (!isWebTool(input?.tool)) return;

    const text = extractText(output);
    if (!text || !text.trim()) return;

    const result = await scan(text, { kind: "opencode", tool: input.tool });
    if (result === null) return; // scanner unavailable — fail open

    if (result.allowed && result.content !== undefined && !result.releaseNote) {
      return; // clean, leave untouched
    }
    const replacement =
      result.allowed && result.content !== undefined
        ? result.content
        : result.message || "PromptBuster blocked this content (possible prompt injection).";
    applyReplacement(output, replacement);
  },
});

export default PromptBusterPlugin;

function isWebTool(tool) {
  return typeof tool === "string" && WEB_TOOLS.has(tool.toLowerCase());
}

function extractText(output) {
  if (!output) return "";
  if (typeof output.output === "string") return output.output;
  if (Array.isArray(output.content)) {
    return output.content.map((c) => (typeof c?.text === "string" ? c.text : "")).join("\n");
  }
  return "";
}

function applyReplacement(output, replacement) {
  if (typeof output.output === "string") {
    output.output = replacement;
  }
  if (Array.isArray(output.content)) {
    let replaced = false;
    for (const part of output.content) {
      if (typeof part?.text === "string") {
        part.text = replaced ? "" : replacement;
        replaced = true;
      }
    }
    if (!replaced) output.content.push({ type: "text", text: replacement });
  }
}

function scan(text, source) {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [resolveCliPath(), "scan", "--stdin", "--harness", "opencode", "--output", "json"],
      { timeout: 45000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error && !stdout) return resolve(null); // fail open
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve(null);
        }
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(text);
  });
}

function resolveCliPath() {
  // This file lives at <pkg>/integrations/opencode/index.js.
  return new URL("../../bin/prompt-buster.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
}
