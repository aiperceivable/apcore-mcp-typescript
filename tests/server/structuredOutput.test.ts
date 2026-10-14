import { afterEach, describe, expect, it, vi } from "vitest";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolRequestSchema, CallToolResultSchema, ListToolsRequestSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { TransportManager } from "../../src/server/transport.js";
import type { AddressInfo } from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { MCPServerFactory } from "../../src/server/factory.js";
import { AsyncTaskBridge } from "../../src/server/async-task-bridge.js";
import { ExecutionRouter } from "../../src/server/router.js";
import { addStructuredOutput } from "../../src/server/structured-output.js";
import type { ModuleDescriptor } from "../../src/types.js";

const outputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  $defs: { token: { type: "string" } },
  properties: { token: { $ref: "#/$defs/token", "x-sensitive": true } },
  required: ["token"],
  additionalProperties: false,
};
const descriptor: ModuleDescriptor = {
  moduleId: "test.secret", description: "Secret output", inputSchema: { type: "object" },
  outputSchema, annotations: null,
};
const clients: Client[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map(client => client.close()));
  await Promise.all(servers.splice(0).map(server => server.close()));
});

async function connect(version: string, schema: Record<string, unknown> = outputSchema, value: Record<string, unknown> = { token: "private-token" }, external?: "before" | "connected", outputFormatter?: (result: Record<string, unknown> | Array<unknown>) => string) {
  const factory = new MCPServerFactory();
  const server = external ? new Server({ name: "external", version: "1" }, { capabilities: { tools: {} } }) : factory.createServer();
  servers.push(server);
  const registry = { list: () => [descriptor.moduleId], getDefinition: () => ({ ...descriptor, outputSchema: schema }), on: () => {} };
  const executor = { registry, call: vi.fn().mockResolvedValue(value) };
  const router = new ExecutionRouter(executor, { outputSchemaMap: { [descriptor.moduleId]: schema }, outputFormatter });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  if (external === "connected") await server.connect(serverTransport);
  factory.registerHandlers(server, factory.buildTools(registry), router);
  if (external !== "connected") await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "1" });
  clients.push(client);
  await client.connect(clientTransport);
  const initialized = await client.request({ method: "initialize", params: {
    protocolVersion: version, capabilities: {}, clientInfo: { name: "test", version: "1" },
  } }, (await import("@modelcontextprotocol/sdk/types.js")).InitializeResultSchema);
  expect(initialized.protocolVersion).toBe(version);
  return { client, executor, server };
}

describe("structured MCP results", () => {
  it("preserves exact descriptor output schema and skips async submission schemas", () => {
    const factory = new MCPServerFactory();
    const tool = factory.buildTool(descriptor);
    expect(tool.outputSchema).toEqual(outputSchema);
    expect(tool.outputSchema).not.toBe(outputSchema);
    expect(factory.buildTool({ ...descriptor, metadata: { async: true } }).outputSchema).toBeUndefined();
    expect(factory.buildTool({ ...descriptor, outputSchema: { type: "array" } }).outputSchema).toBeUndefined();
  });

  it.each(["before", "connected"] as const)("supports caller-supplied servers registered %s initialization", async phase => {
    const { client } = await connect("2025-06-18", outputSchema, { token: "private-token" }, phase);
    const listed = await client.request({ method: "tools/list" }, ListToolsResultSchema);
    expect(listed.tools[0].outputSchema).toEqual(outputSchema);
    const called = await client.request({ method: "tools/call", params: { name: descriptor.moduleId } }, CallToolResultSchema);
    expect(called.structuredContent).toEqual(JSON.parse((called.content[0] as { text: string }).text));
  });

  it.each([true, "True", " true ", "\tTRUE\n"])("uses the bridge's canonical async hint detector: %j", flag => {
    const asynchronous = { ...descriptor, metadata: { async: flag } };
    expect(AsyncTaskBridge.isAsyncModuleDescriptor(asynchronous)).toBe(true);
    expect(new MCPServerFactory().buildTool(asynchronous).outputSchema).toBeUndefined();
  });

  it.each(["2025-06-18", "2025-11-25"])("serves redacted, matching text and object for %s", async version => {
    const { client, executor } = await connect(version);
    const listed = await client.request({ method: "tools/list" }, ListToolsResultSchema);
    expect(listed.tools[0].outputSchema).toEqual(outputSchema);
    const result = await client.request({ method: "tools/call", params: { name: descriptor.moduleId, arguments: {} } }, CallToolResultSchema);
    expect(executor.call).toHaveBeenCalledOnce();
    expect(result.structuredContent).toEqual(JSON.parse((result.content[0] as { text: string }).text));
    expect(JSON.stringify(result)).not.toContain("private-token");
    expect(result.structuredContent).toHaveProperty("token");
  });

  it.each(["2025-03-26", "2024-11-05"])("retains legacy text-only responses for %s", async version => {
    const { client } = await connect(version);
    const listed = await client.request({ method: "tools/list" }, ListToolsResultSchema);
    expect(listed.tools[0].outputSchema).toBeUndefined();
    const result = await client.request({ method: "tools/call", params: { name: descriptor.moduleId, arguments: {}, _meta: { mcpProtocolVersion: "2025-06-18" } } }, CallToolResultSchema);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("private-token");
  });

  it("validates after redaction and returns a payload-free tool error", async () => {
    const schema = { ...outputSchema, properties: { token: { type: "string", const: "private-token", "x-sensitive": true } } };
    const { client } = await connect("2025-06-18", schema);
    const result = await client.request({ method: "tools/call", params: { name: descriptor.moduleId } }, CallToolResultSchema);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("private-token");
    expect(JSON.stringify(result)).not.toContain("***");
  });

  it.each([null, [1, 2], 42, "text"])("keeps scalar or array output text-only: %j", value => {
    const result = { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
    expect(addStructuredOutput(result)).toEqual(result);
  });

  it("leaves errors and custom text unchanged when no object schema is advertised", () => {
    const result = { content: [{ type: "text" as const, text: "custom,csv" }] };
    expect(addStructuredOutput(result)).toEqual(result);
    const error = { content: [{ type: "text" as const, text: "{}" }], isError: true };
    expect(addStructuredOutput(error).structuredContent).toBeUndefined();
  });

  it("refuses unrepresentable output when an object schema was advertised", () => {
    const tool = new MCPServerFactory().buildTool(descriptor);
    for (const content of [[], [{ type: "text" as const, text: "csv,text" }],
      [{ type: "text" as const, text: "[]" }],
      [{ type: "text" as const, text: "invalid-first" }, { type: "text" as const, text: '{"token":"***"}' }]]) {
      const result = addStructuredOutput({ content }, tool);
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("csv,text");
    }
  });

  it("preserves additional trace text and metadata while structuring the primary object", () => {
    const tool = new MCPServerFactory().buildTool(descriptor);
    const result = { content: [
      { type: "text" as const, text: '{"token":"***"}' },
      { type: "text" as const, text: "trace details" },
    ], _meta: { traceparent: "trace-parent" } };
    const structured = addStructuredOutput(result, tool);
    expect(structured.structuredContent).toEqual({ token: "***" });
    expect(structured.content).toEqual(result.content);
    expect(structured._meta).toEqual(result._meta);
  });

  it("enforces references and composition constraints from the advertised raw schema", () => {
    const factory = new MCPServerFactory();
    for (const schema of [
      { type: "object", $defs: { value: { type: "string", const: "allowed" } }, properties: { token: { $ref: "#/$defs/value" } }, required: ["token"] },
      { type: "object", allOf: [{ properties: { token: { type: "string" } } }, { properties: { token: { const: "allowed" } } }] },
      { type: "object", oneOf: [{ properties: { token: { type: "string" } } }, { properties: { token: { const: "***" } } }] },
      { type: "object", if: { properties: { token: { const: "***" } } }, then: { required: ["mandatory"] } },
    ]) {
      const tool = factory.buildTool({ ...descriptor, outputSchema: schema });
      expect(tool.outputSchema).toEqual(schema);
      const result = addStructuredOutput({ content: [{ type: "text", text: '{"token":"***"}' }] }, tool);
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("***");
    }
  });

  it.each(["2025-06-18", "2025-03-26"])("uses the negotiated SSE session protocol %s despite HTTP metadata", async version => {
    const factory = new MCPServerFactory();
    const server = factory.createServer();
    servers.push(server);
    const registry = { list: () => [descriptor.moduleId], getDefinition: () => descriptor, on: () => {} };
    const router = new ExecutionRouter({ registry, call: async () => ({ token: "private-token" }) },
      { outputSchemaMap: { [descriptor.moduleId]: outputSchema } });
    factory.registerHandlers(server, factory.buildTools(registry), router);
    const manager = new TransportManager();
    vi.spyOn(manager, "_validateHostPort").mockImplementation(() => {});
    await manager.runSse(server, { host: "127.0.0.1", port: 0 });
    const url = new URL(`http://127.0.0.1:${(manager.httpServer!.address() as AddressInfo).port}/sse`);
    const client = new Client({ name: "sse-test", version: "1" });
    const transport = new SSEClientTransport(url, { requestInit: { headers: { "MCP-Protocol-Version": "2025-03-26" } } });
    try {
      await client.connect(transport);
      await client.request({ method: "initialize", params: { protocolVersion: version, capabilities: {}, clientInfo: { name: "sse-test", version: "1" } } },
        (await import("@modelcontextprotocol/sdk/types.js")).InitializeResultSchema);
      const listed = await client.request({ method: "tools/list" }, ListToolsResultSchema);
      expect(listed.tools[0].outputSchema !== undefined).toBe(version === "2025-06-18");
      const called = await client.request({ method: "tools/call", params: { name: descriptor.moduleId, _meta: { mcpProtocolVersion: "2025-06-18" } } }, CallToolResultSchema);
      expect(called.structuredContent !== undefined).toBe(version === "2025-06-18");
      expect(JSON.stringify(called)).not.toContain("private-token");
    } finally {
      await client.close();
      await manager.close();
    }
  });

  it.each(['{"number":1e400}', '{"nested":{"values":[-1e400]}}'])("rejects nested nonfinite numeric projection: %s", text => {
    const result = { content: [{ type: "text" as const, text }], structuredContent: { stale: "private" } };
    expect(addStructuredOutput(result).structuredContent).toBeUndefined();
    expect(addStructuredOutput(result).content).toEqual(result.content);
    const error = addStructuredOutput(result, new MCPServerFactory().buildTool({ ...descriptor, outputSchema: { type: "object" } }));
    expect(error.isError).toBe(true);
    expect(error.structuredContent).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain("private");
  });

  it("keeps deeply nested JSON payloads from causing projection stack failures", () => {
    const text = '{"nested":'.repeat(20000) + '1' + '}'.repeat(20000);
    const result = { content: [{ type: "text" as const, text }] };
    expect(addStructuredOutput(result).structuredContent).toBeUndefined();
    expect(addStructuredOutput(result).content).toEqual(result.content);
    const tool = new MCPServerFactory().buildTool({ ...descriptor, outputSchema: { type: "object" } });
    expect(addStructuredOutput(result, tool).isError).toBe(true);
  });

  it("does not assume a modern protocol for servers initialized before registration", async () => {
    const factory = new MCPServerFactory();
    const server = new Server({ name: "initialized", version: "1" }, { capabilities: { tools: {} } });
    servers.push(server);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "initialized-test", version: "1" });
    clients.push(client);
    await client.connect(clientTransport);
    const router = { handleCall: async () => [[{ type: "text", text: '{"token":"***"}' }], false] };
    factory.registerHandlers(server, [factory.buildTool(descriptor)], router as unknown as ExecutionRouter);
    const listed = await client.request({ method: "tools/list" }, ListToolsResultSchema);
    expect(listed.tools[0].outputSchema).toBeUndefined();
    const called = await client.request({ method: "tools/call", params: { name: descriptor.moduleId } }, CallToolResultSchema);
    expect(called.structuredContent).toBeUndefined();
  });

  it.each([
    ["2025-06-18", "#/$defs/private"], ["2025-03-26", "#/$defs/private"],
    ["2025-06-18", "#private"], ["2025-03-26", "#private"],
    ["2025-06-18", "https://example.test/root.json#/$defs/private"],
    ["2025-03-26", "https://example.test/root.json#/$defs/private"],
  ])("redacts referenced sensitive values on the real wire for %s via %s", async (version, reference) => {
    const schema = { $id: "https://example.test/root.json", type: "object",
      $defs: { private: { $anchor: "private", type: "string", "x-sensitive": true } },
      properties: { value: { $ref: reference } }, required: ["value"], additionalProperties: false,
    };
    const { client, executor } = await connect(version, schema, { value: "reference-only-private-value" });
    const result = await client.request({ method: "tools/call", params: { name: descriptor.moduleId } }, CallToolResultSchema);
    expect(executor.call).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("reference-only-private-value");
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({ value: "***REDACTED***" });
    expect(result.structuredContent).toEqual(version === "2025-06-18" ? { value: "***REDACTED***" } : undefined);
  });

  it.each(["2025-06-18", "2025-03-26"])("redacts embedded-resource sensitive references on the %s wire", async version => {
    const schema = { $id: "https://example.test/root", type: "object", $defs: {
      child: { $id: "child", $anchor: "secret", type: "object", properties: { value: { type: "string", "x-sensitive": true } } },
    }, properties: { payload: { $ref: "child#secret" } } };
    const { client } = await connect(version, schema, { payload: { value: "embedded-private-value" } });
    const result = await client.request({ method: "tools/call", params: { name: descriptor.moduleId } }, CallToolResultSchema);
    expect(JSON.stringify(result)).not.toContain("embedded-private-value");
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({ payload: { value: "***REDACTED***" } });
    expect(result.structuredContent).toEqual(version === "2025-06-18" ? { payload: { value: "***REDACTED***" } } : undefined);
  });

  it.each(["2025-06-18", "2025-03-26"])("redacts referenced prefix-item secrets on the %s wire", async version => {
    const schema = { type: "object", $defs: { private: { type: "string", "x-sensitive": true } },
      properties: { values: { type: "array", prefixItems: [{ type: "string" }, { $ref: "#/$defs/private" }], items: false } },
    };
    const { client } = await connect(version, schema, { values: ["public", "positional-private-value"] });
    const result = await client.request({ method: "tools/call", params: { name: descriptor.moduleId } }, CallToolResultSchema);
    expect(JSON.stringify(result)).not.toContain("positional-private-value");
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({ values: ["public", "***REDACTED***"] });
  });

  it("fails payload-free when referenced sensitive redaction violates an advertised const", async () => {
    const schema = { type: "object", $defs: { private: { type: "string", "x-sensitive": true, const: "reference-only-private-value" } },
      properties: { value: { $ref: "#/$defs/private" } }, required: ["value"],
    };
    const { client } = await connect("2025-06-18", schema, { value: "reference-only-private-value" });
    const result = await client.request({ method: "tools/call", params: { name: descriptor.moduleId } }, CallToolResultSchema);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("reference-only-private-value");
  });

  it("preserves negotiated output after an SDK-rejected second connection", async () => {
    const { client, server, executor } = await connect("2025-06-18");
    const before = await client.request({ method: "tools/list" }, ListToolsResultSchema);
    expect(before.tools[0].outputSchema).toEqual(outputSchema);
    const [secondClient, secondServer] = InMemoryTransport.createLinkedPair();
    try {
      await expect(server.connect(secondServer)).rejects.toThrow("Already connected");
      const after = await client.request({ method: "tools/list" }, ListToolsResultSchema);
      expect(after.tools[0].outputSchema).toEqual(outputSchema);
      const called = await client.request({ method: "tools/call", params: { name: descriptor.moduleId } }, CallToolResultSchema);
      expect(called.structuredContent).toEqual(JSON.parse((called.content[0] as { text: string }).text));
      expect(executor.call).toHaveBeenCalledOnce();
    } finally {
      await secondClient.close();
      await secondServer.close();
    }
  });

  it("discards stale structured payloads on errors and non-object content", () => {
    for (const result of [
      { content: [{ type: "text" as const, text: "{}" }], isError: true, structuredContent: { stale: "private" } },
      { content: [{ type: "text" as const, text: "invalid" }], structuredContent: { stale: "private" } },
      { content: [{ type: "text" as const, text: "[]" }], structuredContent: { stale: "private" } },
    ]) {
      expect(addStructuredOutput(result).structuredContent).toBeUndefined();
      expect(JSON.stringify(addStructuredOutput(result))).not.toContain("private");
    }
  });

  it.each([false, true])("guards custom formatter numeric fidelity after governed redaction with advertised schema=%s", async advertised => {
    const text = '{"count":9007199254740993}';
    const formatter = vi.fn(() => text);
    const schema = { ...(advertised ? { type: "object" } : {}), properties: { token: { type: "string", "x-sensitive": true } } };
    const { client, executor } = await connect("2025-06-18", schema, { token: "private-token" }, undefined, formatter);
    const result = await client.request({ method: "tools/call", params: { name: descriptor.moduleId } }, CallToolResultSchema);
    expect(executor.call).toHaveBeenCalledOnce();
    expect(formatter).toHaveBeenCalledOnce();
    expect(JSON.stringify(formatter.mock.calls)).not.toContain("private-token");
    expect(result.structuredContent).toBeUndefined();
    if (advertised) {
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain("9007199254740993");
    } else {
      expect(result.isError).not.toBe(true);
      expect(result.content).toEqual([{ type: "text", text }]);
    }
  });

  it.each(['{"count":9007199254740993}', '{"nested":[18446744073709551617]}', '{"count":1.234567890123456789}'])("refuses lossy numeric projection: %s", text => {
    const content = [{ type: "text" as const, text }];
    const source = { content, structuredContent: { stale: "private" }, _meta: { private: "secret" } };
    expect(addStructuredOutput(source)).toEqual({ content, _meta: source._meta });
    const tool = new MCPServerFactory().buildTool({ ...descriptor, outputSchema: { type: "object" } });
    const rejected = addStructuredOutput(source, tool);
    expect(rejected.isError).toBe(true);
    expect(rejected.structuredContent).toBeUndefined();
    expect(JSON.stringify(rejected)).not.toContain("private");
    expect(JSON.stringify(rejected)).not.toContain("secret");
    expect(JSON.stringify(rejected)).not.toContain(text);
  });

  it.each(['{"count":9007199254740992}', '{"count":9007199254740994}', '{"count":1e3,"fraction":0.00010}', '{"count":-0,"zero":0e9999}', '{"string":"9007199254740993 and \\"quoted\\"", "count":3}', '{"count":1.7976931348623157e308}'])("preserves numerically equivalent JSON tokens: %s", text => {
    const tool = new MCPServerFactory().buildTool({ ...descriptor, outputSchema: { type: "object" } });
    const result = addStructuredOutput({ content: [{ type: "text", text }] }, tool);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(JSON.parse(text));
  });

  it("rejects mixed embedded dialects but leaves dialect declarations in literal data opaque", () => {
    const content = [{ type: "text" as const, text: '{"payload":{"count":100}}' }];
    for (const $schema of ["http://json-schema.org/draft-07/schema#", "https://json-schema.org/draft/2019-09/schema"]) {
      const tool = new MCPServerFactory().buildTool({ ...descriptor, outputSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", $id: "https://example.test/root",
        $defs: { child: { $id: "child", $schema, type: "object" } }, properties: { payload: { $ref: "child" } },
      } });
      expect(addStructuredOutput({ content }, tool).isError).toBe(true);
    }
    const tool = new MCPServerFactory().buildTool({ ...descriptor, outputSchema: {
      type: "object", default: { $schema: "http://json-schema.org/draft-07/schema#" },
      $defs: { child: { $schema: "https://json-schema.org/draft/2020-12/schema#", type: "object" } },
    } });
    expect(addStructuredOutput({ content }, tool).structuredContent).toEqual({ payload: { count: 100 } });
  });

  it("validates raw local references, siblings, anchors and self references", () => {
    const schemas = [
      { type: "object", $defs: { count: { type: "integer" } }, properties: { count: { $ref: "#/$defs/count", maximum: 5 } } },
      { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", $defs: { count: { $anchor: "count", type: "integer", maximum: 5 } }, properties: { count: { $ref: "#count" } } },
      { $id: "https://example.test/self.json", type: "object", $defs: { count: { type: "integer", maximum: 5 } }, properties: { count: { $ref: "https://example.test/self.json#/$defs/count" } } },
    ];
    for (const outputSchema of schemas) {
      const tool = new MCPServerFactory().buildTool({ ...descriptor, outputSchema });
      const valid = addStructuredOutput({ content: [{ type: "text", text: '{"count":3}' }] }, tool);
      expect(valid.structuredContent).toEqual({ count: 3 });
      const invalid = addStructuredOutput({ content: [{ type: "text", text: '{"count":100}' }] }, tool);
      expect(invalid.isError).toBe(true);
      expect(invalid.structuredContent).toBeUndefined();
    }
  });

  it("checks unresolved references in unused schema resources while preserving literal data", () => {
    const content = [{ type: "text" as const, text: '{"value":"public"}' }];
    const tool = new MCPServerFactory().buildTool({ ...descriptor, outputSchema: {
      type: "object", $defs: { unused: { $ref: "https://example.test/external.json" } },
      properties: { value: { type: "string" } },
    } });
    expect(addStructuredOutput({ content }, tool).isError).toBe(true);
    const literal = new MCPServerFactory().buildTool({ ...descriptor, outputSchema: {
      type: "object", default: { $ref: "https://example.test/external.json" },
      properties: { value: { type: "string" } },
    } });
    expect(addStructuredOutput({ content }, literal).structuredContent).toEqual({ value: "public" });
  });

  it("keeps unknown-vocabulary reference data opaque for the declared dialect", () => {
    const content = [{ type: "text" as const, text: '{"value":"public"}' }];
    for (const outputSchema of [
      { type: "object", definitions: { data: { $ref: "https://example.test/external.json" } } },
      { $schema: "http://json-schema.org/draft-07/schema#", type: "object", $defs: { data: { $ref: "https://example.test/external.json" } } },
    ]) {
      const tool = new MCPServerFactory().buildTool({ ...descriptor, outputSchema });
      expect(addStructuredOutput({ content }, tool).structuredContent).toEqual({ value: "public" });
    }
  });

  it("validates embedded local schema resources with independent identifier scopes", () => {
    const tool = new MCPServerFactory().buildTool({ ...descriptor, outputSchema: {
      $id: "https://example.test/root", type: "object", $defs: { child: {
        $id: "child", $anchor: "child", type: "object", properties: { value: { type: "integer", maximum: 5 } },
      } }, properties: { payload: { $ref: "child#child" } },
    } });
    expect(addStructuredOutput({ content: [{ type: "text", text: '{"payload":{"value":3}}' }] }, tool).structuredContent).toEqual({ payload: { value: 3 } });
    expect(addStructuredOutput({ content: [{ type: "text", text: '{"payload":{"value":100}}' }] }, tool).isError).toBe(true);
  });

  it("fails closed for external references, missing anchors and unsupported dialects", () => {
    for (const outputSchema of [
      { type: "object", properties: { count: { $ref: "https://example.test/external.json" } } },
      { type: "object", properties: { count: { $ref: "#missing" } } },
      { $schema: "https://example.test/unsupported-dialect", type: "object" },
    ]) {
      const tool = new MCPServerFactory().buildTool({ ...descriptor, outputSchema });
      const invalid = addStructuredOutput({ content: [{ type: "text", text: '{"count":"private"}' }], structuredContent: { stale: "private" } }, tool);
      expect(invalid.isError).toBe(true);
      expect(invalid.structuredContent).toBeUndefined();
      expect(JSON.stringify(invalid)).not.toContain("private");
    }
  });

  it("respects declared Draft2019-09 local reference and dependency assertions", () => {
    const tool = new MCPServerFactory().buildTool({ ...descriptor, outputSchema: {
      $schema: "https://json-schema.org/draft/2019-09/schema", type: "object", $defs: { count: { type: "integer" } },
      properties: { count: { $ref: "#/$defs/count", maximum: 5 } }, dependentRequired: { count: ["label"] },
    } });
    expect(addStructuredOutput({ content: [{ type: "text", text: '{"count":3,"label":"public"}' }] }, tool).structuredContent).toEqual({ count: 3, label: "public" });
    expect(addStructuredOutput({ content: [{ type: "text", text: '{"count":100,"label":"public"}' }] }, tool).isError).toBe(true);
    expect(addStructuredOutput({ content: [{ type: "text", text: '{"count":3}' }] }, tool).isError).toBe(true);
  });

  it("respects declared draft-07 reference siblings and leaves formats as annotations", () => {
    const tool = new MCPServerFactory().buildTool({ ...descriptor, outputSchema: {
      $schema: "http://json-schema.org/draft-07/schema#", type: "object",
      definitions: { value: { type: "integer" } }, properties: { count: { $ref: "#/definitions/value", maximum: 5 }, email: { type: "string", format: "email" } },
    } });
    const content = [{ type: "text" as const, text: '{"count":100,"email":"not-an-email"}' }];
    expect(addStructuredOutput({ content }, tool).structuredContent).toEqual({ count: 100, email: "not-an-email" });
    const modern = new MCPServerFactory().buildTool({ ...descriptor, outputSchema: { type: "object", properties: { email: { type: "string", format: "email" } } } });
    expect(addStructuredOutput({ content: [{ type: "text", text: '{"email":"not-an-email"}' }] }, modern).structuredContent).toEqual({ email: "not-an-email" });
  });

  it("keeps advertised schemas independent from nested registry descriptor mutations", () => {
    const schema = { type: "object", properties: { count: { type: "integer", maximum: 5 } } };
    const tool = new MCPServerFactory().buildTool({ ...descriptor, outputSchema: schema });
    schema.properties.count.maximum = 2;
    expect((tool.outputSchema!.properties!.count as { maximum: number }).maximum).toBe(5);
    expect(addStructuredOutput({ content: [{ type: "text", text: '{"count":3}' }] }, tool).structuredContent).toEqual({ count: 3 });
  });

  it("does not coerce, remove additional properties, or populate defaults", () => {
    const tool = new MCPServerFactory().buildTool({ ...descriptor, outputSchema: {
      type: "object", properties: { count: { type: "integer", default: 3 } }, required: ["count"], additionalProperties: false,
    } });
    for (const text of ['{"count":"3"}', '{"count":3,"extra":"private"}', '{}']) {
      const result = { content: [{ type: "text" as const, text }] };
      expect(addStructuredOutput(result, tool).isError).toBe(true);
      expect(result.content[0].text).toBe(text);
    }
  });

  it("refreshes cached validation after callers mutate an advertised schema", () => {
    const tool = new MCPServerFactory().buildTool({ ...descriptor, outputSchema: { type: "object", properties: { count: { type: "integer", maximum: 5 } } } });
    const content = [{ type: "text" as const, text: '{"count":3}' }];
    expect(addStructuredOutput({ content }, tool).structuredContent).toEqual({ count: 3 });
    (tool.outputSchema!.properties!.count as { maximum: number }).maximum = 2;
    expect(addStructuredOutput({ content }, tool).isError).toBe(true);
  });

  it("uses actual HTTP headers for alternating modern and legacy requests", async () => {
    const factory = new MCPServerFactory();
    const server = factory.createServer();
    servers.push(server);
    const registry = { list: () => [descriptor.moduleId], getDefinition: () => descriptor, on: () => {} };
    const router = new ExecutionRouter({ registry, call: async () => ({ token: "private-token" }) },
      { outputSchemaMap: { [descriptor.moduleId]: outputSchema } });
    factory.registerHandlers(server, factory.buildTools(registry), router);
    const manager = new TransportManager();
    vi.spyOn(manager, "_validateHostPort").mockImplementation(() => {});
    await manager.runStreamableHttp(server, { host: "127.0.0.1", port: 0 });
    const url = `http://127.0.0.1:${(manager.httpServer!.address() as AddressInfo).port}/mcp`;
    let sessionId: string | null = null;
    let id = 0;
    const post = async (method: string, params?: Record<string, unknown>, version?: string) => {
      const response = await fetch(url, { method: "POST", headers: {
        "Content-Type": "application/json", Accept: "application/json, text/event-stream",
        ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
        ...(version ? { "MCP-Protocol-Version": version } : {}),
      }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, ...(params ? { params } : {}) }) });
      sessionId = response.headers.get("mcp-session-id") ?? sessionId;
      const body = await response.text();
      const data = response.headers.get("content-type")?.includes("event-stream")
        ? body.split("\n").find(line => line.startsWith("data: "))?.slice(6) : body;
      return { status: response.status, payload: data ? JSON.parse(data) : {} };
    };
    try {
      const initialized = await post("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "http-test", version: "1" } });
      expect(initialized.payload.result.protocolVersion).toBe("2025-06-18");
      for (const version of ["2025-06-18", "2025-03-26", "2025-06-18", undefined]) {
        const listed = await post("tools/list", undefined, version);
        expect(listed.status).toBe(200);
        expect(listed.payload.result.tools[0].outputSchema !== undefined).toBe(version === "2025-06-18");
        const called = await post("tools/call", { name: descriptor.moduleId, _meta: { mcpProtocolVersion: "2025-06-18" } }, version);
        expect(called.status).toBe(200);
        expect(called.payload.result.structuredContent !== undefined).toBe(version === "2025-06-18");
        expect(JSON.stringify(called.payload)).not.toContain("private-token");
      }
      expect((await post("tools/list", undefined, "invalid-version")).status).toBe(400);
    } finally {
      await manager.close();
    }
  });

  it("uses each HTTP request header and ignores forged body metadata", async () => {
    const factory = new MCPServerFactory();
    const handlers = new Map<unknown, (...args: any[]) => Promise<any>>();
    const server = { setRequestHandler: (schema: unknown, handler: (...args: any[]) => Promise<any>) => handlers.set(schema, handler) };
    const tool = factory.buildTool(descriptor);
    const router = { handleCall: vi.fn().mockResolvedValue([[{ type: "text", text: '{"token":"***"}' }], false]) };
    factory.registerHandlers(server as unknown as Server, [tool], router as unknown as ExecutionRouter);
    const list = handlers.get(ListToolsRequestSchema)!;
    const call = handlers.get(CallToolRequestSchema)!;
    const request = { params: { name: descriptor.moduleId, _meta: { mcpProtocolVersion: "2025-06-18" } } };
    for (const version of ["2025-06-18", "2025-03-26", "2025-06-18", undefined]) {
      const extra = { requestInfo: { headers: { "mcp-protocol-version": version } } };
      expect((await list({}, extra)).tools[0].outputSchema !== undefined).toBe(version === "2025-06-18");
      expect((await call(request, extra)).structuredContent !== undefined).toBe(version === "2025-06-18");
    }
  });
});
