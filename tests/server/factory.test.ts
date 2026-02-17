import { describe, it, expect, vi } from "vitest";
import { MCPServerFactory } from "../../src/server/factory.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ModuleDescriptor, Registry } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockRegistry(
  descriptors: Record<string, ModuleDescriptor>,
): Registry {
  return {
    list: (opts?: { tags?: string[] | null; prefix?: string | null }) =>
      Object.keys(descriptors),
    get_definition: (id: string) => descriptors[id] ?? null,
    get: (id: string) => descriptors[id] ?? null,
    on: () => {},
  };
}

function makeDescriptor(
  overrides: Partial<ModuleDescriptor> = {},
): ModuleDescriptor {
  return {
    module_id: overrides.module_id ?? "test.module",
    description: overrides.description ?? "A test module",
    input_schema: overrides.input_schema ?? {
      type: "object",
      properties: {
        input: { type: "string" },
      },
      required: ["input"],
    },
    output_schema: overrides.output_schema ?? {
      type: "object",
      properties: {
        output: { type: "string" },
      },
    },
    annotations: overrides.annotations !== undefined
      ? overrides.annotations
      : null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MCPServerFactory", () => {
  const factory = new MCPServerFactory();

  // TC-FACTORY-001
  it("createServer returns a Server with a connect method", () => {
    const server = factory.createServer("test-server", "1.0.0");

    expect(server).toBeDefined();
    expect(typeof server.connect).toBe("function");
  });

  // TC-FACTORY-002
  it("buildTool creates a correct Tool with name, description, inputSchema, and annotations", () => {
    const descriptor = makeDescriptor({
      module_id: "text.analyze",
      description: "Analyze text content",
      input_schema: {
        type: "object",
        properties: {
          text: { type: "string" },
        },
        required: ["text"],
      },
      annotations: {
        readonly: true,
        destructive: false,
        idempotent: true,
        requires_approval: false,
        open_world: false,
      },
    });

    const tool = factory.buildTool(descriptor);

    expect(tool.name).toBe("text.analyze");
    expect(tool.description).toBe("Analyze text content");
    expect(tool.inputSchema).toBeDefined();
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.annotations).toBeDefined();
  });

  // TC-FACTORY-003
  it("buildTool maps annotations correctly to MCP hint format", () => {
    const descriptor = makeDescriptor({
      annotations: {
        readonly: true,
        destructive: false,
        idempotent: true,
        requires_approval: false,
        open_world: true,
      },
    });

    const tool = factory.buildTool(descriptor);

    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  // TC-FACTORY-004
  it("buildTool with null annotations uses defaults", () => {
    const descriptor = makeDescriptor({ annotations: null });

    const tool = factory.buildTool(descriptor);

    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  // TC-FACTORY-005
  it("buildTools iterates registry and returns correct number of tools", () => {
    const registry = createMockRegistry({
      "mod.a": makeDescriptor({ module_id: "mod.a", description: "Module A" }),
      "mod.b": makeDescriptor({ module_id: "mod.b", description: "Module B" }),
      "mod.c": makeDescriptor({ module_id: "mod.c", description: "Module C" }),
    });

    const tools = factory.buildTools(registry);

    expect(tools).toHaveLength(3);
    const names = tools.map((t) => t.name);
    expect(names).toContain("mod.a");
    expect(names).toContain("mod.b");
    expect(names).toContain("mod.c");
  });

  // TC-FACTORY-006
  it("buildTools skips null definitions and logs a warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const descriptors: Record<string, ModuleDescriptor> = {
      "mod.a": makeDescriptor({ module_id: "mod.a" }),
    };

    // Create a registry where one module returns null
    const registry: Registry = {
      list: () => ["mod.a", "mod.missing"],
      get_definition: (id: string) => descriptors[id] ?? null,
      get: (id: string) => descriptors[id] ?? null,
      on: () => {},
    };

    const tools = factory.buildTools(registry);

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("mod.a");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("mod.missing"),
    );

    warnSpy.mockRestore();
  });

  // TC-FACTORY-007
  it("buildTools skips modules that throw errors and logs a warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const registry: Registry = {
      list: () => ["mod.ok", "mod.broken"],
      get_definition: (id: string) => {
        if (id === "mod.broken") {
          throw new Error("Descriptor retrieval failed");
        }
        return makeDescriptor({ module_id: "mod.ok" });
      },
      get: () => null,
      on: () => {},
    };

    const tools = factory.buildTools(registry);

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("mod.ok");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("mod.broken"),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Descriptor retrieval failed"),
    );

    warnSpy.mockRestore();
  });

  // TC-FACTORY-HANDLERS: registerHandlers registers list_tools and call_tool
  describe("registerHandlers", () => {
    it("registers handlers that return tools on list and route calls", async () => {
      const descriptor = makeDescriptor({
        module_id: "test.handler",
        description: "Handler test",
      });
      const tools = [factory.buildTool(descriptor)];

      // Create a mock server that captures handlers using a Map keyed by schema object
      const handlers = new Map<unknown, Function>();
      const mockServer = {
        setRequestHandler: (schema: unknown, handler: Function) => {
          handlers.set(schema, handler);
        },
      };

      // Create a mock router
      const mockRouter = {
        handleCall: vi.fn().mockResolvedValue([
          [{ type: "text", text: '{"result":"ok"}' }],
          false,
        ]),
      };

      factory.registerHandlers(mockServer as any, tools, mockRouter as any);

      // Test tools/list handler
      const listHandler = handlers.get(ListToolsRequestSchema);
      expect(listHandler).toBeDefined();
      const listResult = await listHandler!({});
      expect(listResult.tools).toHaveLength(1);
      expect(listResult.tools[0].name).toBe("test.handler");

      // Test tools/call handler - success path
      const callHandler = handlers.get(CallToolRequestSchema);
      expect(callHandler).toBeDefined();
      const callResult = await callHandler!({
        params: { name: "test.handler", arguments: { input: "hello" } },
      });
      expect(callResult.content).toEqual([
        { type: "text", text: '{"result":"ok"}' },
      ]);
      expect(callResult.isError).toBe(false);
    });

    it("throws error when router returns isError=true", async () => {
      const tools = [factory.buildTool(makeDescriptor())];

      const handlers = new Map<unknown, Function>();
      const mockServer = {
        setRequestHandler: (schema: unknown, handler: Function) => {
          handlers.set(schema, handler);
        },
      };

      const mockRouter = {
        handleCall: vi.fn().mockResolvedValue([
          [{ type: "text", text: "Module not found" }],
          true,
        ]),
      };

      factory.registerHandlers(mockServer as any, tools, mockRouter as any);

      const callHandler = handlers.get(CallToolRequestSchema)!;
      await expect(
        callHandler({
          params: { name: "bad.module", arguments: {} },
        }),
      ).rejects.toThrow("Module not found");
    });

    it("handles null arguments in tools/call", async () => {
      const tools = [factory.buildTool(makeDescriptor())];

      const handlers = new Map<unknown, Function>();
      const mockServer = {
        setRequestHandler: (schema: unknown, handler: Function) => {
          handlers.set(schema, handler);
        },
      };

      const mockRouter = {
        handleCall: vi.fn().mockResolvedValue([
          [{ type: "text", text: "{}" }],
          false,
        ]),
      };

      factory.registerHandlers(mockServer as any, tools, mockRouter as any);

      // Call with null arguments
      const callHandler = handlers.get(CallToolRequestSchema)!;
      await callHandler({
        params: { name: "test.module", arguments: null },
      });

      expect(mockRouter.handleCall).toHaveBeenCalledWith("test.module", {});
    });
  });

  // TC-FACTORY-008
  it("buildTools with empty registry returns an empty array", () => {
    const registry = createMockRegistry({});

    const tools = factory.buildTools(registry);

    expect(tools).toEqual([]);
  });
});
