import { APCoreMCP } from "../../src/index.js";
const mcp = new APCoreMCP("tests/fixtures/stdio-extensions", { async: false });
await mcp.serve({ transport: "stdio" });
