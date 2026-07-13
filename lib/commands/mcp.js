import { startMcpServer } from "../mcp/server.js";

export async function run() {
  startMcpServer();
  // Keep the process alive until stdin closes.
  await new Promise((resolve) => process.stdin.on("close", resolve));
  return 0;
}
