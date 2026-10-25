import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { MCPServerFactory } from "../../src/server/factory.js";
import { TransportManager } from "../../src/server/transport.js";
const server = new MCPServerFactory().createServer("delayed-handler-regression", "1");
server.setRequestHandler(CallToolRequestSchema, async () => {
  console.log("delayed tool started");
  await new Promise((resolve) => setTimeout(resolve, 40));
  console.log("application console.log");
  return { content: [{ type: "text", text: '{"ok":true}' }] };
});
await new TransportManager().runStdio(server);
process.stderr.write("shutdown callback\n");
