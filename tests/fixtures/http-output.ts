import assert from "node:assert/strict";
import { createServer, type AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { TransportManager } from "../../src/server/transport.js";
import { withStdioOutput } from "../../src/server/stdio-output.js";

const mode = process.argv[2];
assert(mode === "streamable-http" || mode === "sse");
const originalWrite = process.stdout.write;
const reservation = createServer();
await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = (reservation.address() as AddressInfo).port;
await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));

const manager = new TransportManager();
const server = new Server({ name: "http-output", version: "1" }, { capabilities: { tools: {} } });
const client = new Client({ name: "http-output-test", version: "1" });
let started!: () => void;
const handlerStarted = new Promise<void>((resolve) => { started = resolve; });
let finish!: () => void;
const finishHandler = new Promise<void>((resolve) => { finish = resolve; });
server.setRequestHandler(CallToolRequestSchema, async () => {
  console.log(`${mode}: handler before lease`);
  started();
  await finishHandler;
  console.log(`${mode}: handler after lease`);
  return { content: [{ type: "text", text: `${mode}: real response` }] };
});
const timeout = setTimeout(() => {
  console.error(`${mode}: live transport did not finish`);
  process.exit(1);
}, 20_000);
try {
  if (mode === "sse") await manager.runSse(server, { host: "127.0.0.1", port });
  else await manager.runStreamableHttp(server, { host: "127.0.0.1", port });
  assert(manager.httpServer?.listening);
  const url = new URL(`http://127.0.0.1:${port}/${mode === "sse" ? "sse" : "mcp"}`);
  await client.connect(mode === "sse" ? new SSEClientTransport(url) : new StreamableHTTPClientTransport(url));
  const response = client.request({ method: "tools/call", params: { name: "http_output", arguments: {} } }, CallToolResultSchema);
  void response.catch(() => {});
  await handlerStarted;
  // This continuation is independent of the HTTP handler's async context.
  // An HTTP listener must not reserve stdout, even while a request is active.
  assert.equal(process.stdout.write, originalWrite);
  await withStdioOutput(async (lease) => {
    lease.claimTransport()();
    await lease.drain();
  });
  assert(manager.httpServer?.listening);
  assert.equal(process.stdout.write, originalWrite);
  console.log(`${mode}: independent stdio lease acquired`);
  finish();
  assert.deepEqual((await response).content, [{ type: "text", text: `${mode}: real response` }]);
  console.log(`${mode}: real response verified`);
} finally {
  finish();
  await client.close();
  await manager.close();
  await server.close();
  clearTimeout(timeout);
}
