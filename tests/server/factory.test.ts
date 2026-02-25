import { describe, it, expect, vi } from "vitest";
import { MCPServerFactory } from "../../src/server/factory.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
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
    getDefinition: (id: string) => descriptors[id] ?? null,
    on: () => {},
  };
}

function makeDescriptor(
  overrides: Partial<ModuleDescriptor> = {},
): ModuleDescriptor {
  return {
    moduleId: overrides.moduleId ?? "test.module",
    description: overrides.description ?? "A test module",
    inputSchema: overrides.inputSchema ?? {
      type: "object",
      properties: {
        input: { type: "string" },
      },
      required: ["input"],
    },
    outputSchema: overrides.outputSchema ?? {
      type: "object",
      properties: {
        output: { type: "string" },
      },
    },
    annotations: overrides.annotations !== undefined
      ? overrides.annotations
      : null,
    documentation: overrides.documentation !== undefined
      ? overrides.documentation
      : undefined,
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
      moduleId: "text.analyze",
      description: "Analyze text content",
      inputSchema: {
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
        requiresApproval: false,
        openWorld: false,
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
        requiresApproval: false,
        openWorld: true,
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
      "mod.a": makeDescriptor({ moduleId: "mod.a", description: "Module A" }),
      "mod.b": makeDescriptor({ moduleId: "mod.b", description: "Module B" }),
      "mod.c": makeDescriptor({ moduleId: "mod.c", description: "Module C" }),
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
      "mod.a": makeDescriptor({ moduleId: "mod.a" }),
    };

    // Create a registry where one module returns null
    const registry: Registry = {
      list: () => ["mod.a", "mod.missing"],
      getDefinition: (id: string) => descriptors[id] ?? null,
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
      getDefinition: (id: string) => {
        if (id === "mod.broken") {
          throw new Error("Descriptor retrieval failed");
        }
        return makeDescriptor({ moduleId: "mod.ok" });
      },
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
        moduleId: "test.handler",
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
          "trace-abc",
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
      // Success path: isError should not be set
      expect(callResult.isError).toBeUndefined();
    });

    it("throws error when router returns isError=true so MCP SDK sets isError", async () => {
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
          undefined,
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
          undefined,
        ]),
      };

      factory.registerHandlers(mockServer as any, tools, mockRouter as any);

      // Call with null arguments
      const callHandler = handlers.get(CallToolRequestSchema)!;
      await callHandler({
        params: { name: "test.module", arguments: null },
      });

      expect(mockRouter.handleCall).toHaveBeenCalledWith(
        "test.module",
        {},
        expect.objectContaining({ sendNotification: undefined, _meta: undefined }),
      );
    });
  });

  // TC-FACTORY-008
  it("buildTools with empty registry returns an empty array", () => {
    const registry = createMockRegistry({});

    const tools = factory.buildTools(registry);

    expect(tools).toEqual([]);
  });

  // TC-FACTORY-RESOURCES: registerResourceHandlers
  describe("registerResourceHandlers", () => {
    it("includes modules with documentation in resource list", async () => {
      const registry = createMockRegistry({
        "mod.documented": makeDescriptor({
          moduleId: "mod.documented",
          documentation: "Some docs",
        }),
      });

      const handlers = new Map<unknown, Function>();
      const mockServer = {
        setRequestHandler: (schema: unknown, handler: Function) => {
          handlers.set(schema, handler);
        },
      };

      factory.registerResourceHandlers(mockServer as any, registry);

      const listHandler = handlers.get(ListResourcesRequestSchema);
      expect(listHandler).toBeDefined();
      const listResult = await listHandler!({});
      expect(listResult.resources).toHaveLength(1);
      expect(listResult.resources[0].uri).toBe("docs://mod.documented");
      expect(listResult.resources[0].name).toBe("mod.documented documentation");
      expect(listResult.resources[0].mimeType).toBe("text/plain");
    });

    it("excludes modules with null documentation from resource list", async () => {
      const registry = createMockRegistry({
        "mod.nodocs": makeDescriptor({
          moduleId: "mod.nodocs",
          documentation: null,
        }),
      });

      const handlers = new Map<unknown, Function>();
      const mockServer = {
        setRequestHandler: (schema: unknown, handler: Function) => {
          handlers.set(schema, handler);
        },
      };

      factory.registerResourceHandlers(mockServer as any, registry);

      const listHandler = handlers.get(ListResourcesRequestSchema);
      expect(listHandler).toBeDefined();
      const listResult = await listHandler!({});
      expect(listResult.resources).toHaveLength(0);
    });

    it("excludes modules without documentation field from resource list", async () => {
      const registry = createMockRegistry({
        "mod.plain": makeDescriptor({
          moduleId: "mod.plain",
        }),
      });

      const handlers = new Map<unknown, Function>();
      const mockServer = {
        setRequestHandler: (schema: unknown, handler: Function) => {
          handlers.set(schema, handler);
        },
      };

      factory.registerResourceHandlers(mockServer as any, registry);

      const listHandler = handlers.get(ListResourcesRequestSchema);
      const listResult = await listHandler!({});
      expect(listResult.resources).toHaveLength(0);
    });

    it("returns documentation text for valid resource read", async () => {
      const registry = createMockRegistry({
        "mod.documented": makeDescriptor({
          moduleId: "mod.documented",
          documentation: "Some docs about this module",
        }),
      });

      const handlers = new Map<unknown, Function>();
      const mockServer = {
        setRequestHandler: (schema: unknown, handler: Function) => {
          handlers.set(schema, handler);
        },
      };

      factory.registerResourceHandlers(mockServer as any, registry);

      const readHandler = handlers.get(ReadResourceRequestSchema);
      expect(readHandler).toBeDefined();
      const readResult = await readHandler!({
        params: { uri: "docs://mod.documented" },
      });
      expect(readResult.contents).toHaveLength(1);
      expect(readResult.contents[0].uri).toBe("docs://mod.documented");
      expect(readResult.contents[0].text).toBe("Some docs about this module");
      expect(readResult.contents[0].mimeType).toBe("text/plain");
    });

    it("throws error for unknown module in resource read", async () => {
      const registry = createMockRegistry({});

      const handlers = new Map<unknown, Function>();
      const mockServer = {
        setRequestHandler: (schema: unknown, handler: Function) => {
          handlers.set(schema, handler);
        },
      };

      factory.registerResourceHandlers(mockServer as any, registry);

      const readHandler = handlers.get(ReadResourceRequestSchema)!;
      await expect(
        readHandler({
          params: { uri: "docs://mod.unknown" },
        }),
      ).rejects.toThrow("Resource not found: docs://mod.unknown");
    });
  });
});
