import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { MCPServerFactory } from "../../src/server/factory.js";
import { TransportManager } from "../../src/server/transport.js";

const server = new MCPServerFactory().createServer("cancellation-regression", "1");
server.setRequestHandler(CallToolRequestSchema, async (_request, extra) => {
  console.log("cooperative handler started");
  await new Promise<void>((resolve) => {
    if (extra.signal.aborted) resolve();
    else extra.signal.addEventListener("abort", () => { resolve(); }, { once: true });
  });
  console.log("cooperative handler aborted");
  return { content: [{ type: "text", text: "cancelled" }] };
});
await new TransportManager().runStdio(server);
process.stderr.write("transport cancellation finished\n");
