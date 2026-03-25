/**
 * Launch MCP server with all example modules — class-based + programmatic.
 *
 * Usage (from the project root):
 *     npx tsx examples/run.ts
 *
 * Then open http://127.0.0.1:8000/explorer/ in your browser.
 */

import { Type } from "@sinclair/typebox";
import { Registry, module } from "apcore-js";
import { serve, JWTAuthenticator } from "apcore-mcp";
import { convert_temperature, word_count } from "./binding_demo/myapp.js";

// 1. Discover class-based modules from extensions/
const registry = new Registry({ extensionsDir: "./examples/extensions" });
const nClass = await registry.discover();

// 2. Wrap plain business functions as apcore modules (zero code intrusion)
module({
  id: "convert_temperature",
  description: "Convert temperature between Celsius, Fahrenheit, and Kelvin",
  tags: ["math", "conversion"],
  annotations: {
    readonly: true,
    destructive: false,
    idempotent: true,
    requiresApproval: false,
    openWorld: false,
    streaming: false,
  },
  inputSchema: Type.Object({
    value: Type.Number({ description: "Temperature value to convert" }),
    from_unit: Type.String({
      default: "celsius",
      description: "Source unit: celsius, fahrenheit, kelvin",
    }),
    to_unit: Type.String({
      default: "fahrenheit",
      description: "Target unit: celsius, fahrenheit, kelvin",
    }),
  }),
  outputSchema: Type.Object({
    input: Type.String({ description: "Input value and unit" }),
    output: Type.String({ description: "Converted value and unit" }),
    result: Type.Number({ description: "Numeric result" }),
  }),
  execute: (inputs) => convert_temperature(
    inputs.value as number,
    inputs.from_unit as string,
    inputs.to_unit as string,
  ),
  registry,
});

module({
  id: "word_count",
  description: "Count words, characters, and lines in a text string",
  tags: ["text", "utility"],
  annotations: {
    readonly: true,
    destructive: false,
    idempotent: true,
    requiresApproval: false,
    openWorld: false,
    streaming: false,
  },
  inputSchema: Type.Object({
    text: Type.String({ description: "Text to analyze" }),
  }),
  outputSchema: Type.Object({
    words: Type.Integer({ description: "Word count" }),
    characters: Type.Integer({ description: "Character count" }),
    lines: Type.Integer({ description: "Line count" }),
  }),
  execute: (inputs) => word_count(inputs.text as string),
  registry,
});

console.log(`Class-based modules: ${nClass}`);
console.log(`Programmatic modules: 2`);
console.log(`Total:               ${registry.moduleIds.length}`);

// 3. Optional JWT auth via JWT_SECRET env var
const jwtSecret = process.env.JWT_SECRET;
const authenticator = jwtSecret
  ? new JWTAuthenticator({ secret: jwtSecret })
  : undefined;

if (authenticator) {
  console.log("JWT authentication enabled (set Authorization: Bearer <token>)");
}

// 4. Launch MCP server with Explorer UI
serve(registry, {
  transport: "streamable-http",
  host: "127.0.0.1",
  port: 8000,
  explorer: true,
  allowExecute: true,
  authenticator,
  explorerTitle: "APCore MCP Examples Explorer",
  explorerProjectName: "APCore MCP",
  explorerProjectUrl: "https://github.com/aiperceivable/apcore-mcp-typescript",
});
