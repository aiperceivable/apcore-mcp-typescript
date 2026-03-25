/**
 * Launch MCP server with programmatic module wrapping — zero code intrusion demo.
 *
 * Uses the apcore-js `module()` factory to wrap plain business functions as
 * MCP tools without modifying myapp.ts. This is the TypeScript equivalent of
 * Python's binding.yaml approach.
 *
 * Usage:
 *     npx tsx examples/binding_demo/run.ts
 *
 * Then open http://127.0.0.1:8000/explorer/ in your browser.
 */

import { Type } from "@sinclair/typebox";
import { Registry, module } from "apcore-js";
import { serve } from "apcore-mcp";
import { convert_temperature, word_count } from "./myapp.js";

// 1. Create an empty registry
const registry = new Registry();

// 2. Wrap plain functions as apcore modules (myapp.ts stays untouched)
module({
  id: "convert_temperature",
  description: "Convert temperature between Celsius, Fahrenheit, and Kelvin",
  tags: ["math", "conversion"],
  version: "1.0.0",
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
  version: "1.0.0",
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

console.log(`Loaded ${registry.moduleIds.length} module(s) via module() factory`);

// 3. Launch MCP server with Explorer UI
serve(registry, {
  transport: "streamable-http",
  host: "127.0.0.1",
  port: 8000,
  explorer: true,
  allowExecute: true,
  explorerTitle: "APCore MCP Examples Explorer",
  explorerProjectName: "APCore MCP",
  explorerProjectUrl: "https://github.com/aiperceivable/apcore-mcp-typescript",
});
