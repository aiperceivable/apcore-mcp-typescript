import { describe, it, expect } from "vitest";
import { OpenAIConverter } from "../../src/converters/openai.js";
import type { ModuleDescriptor, Registry } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockRegistry(
  descriptors: Record<string, ModuleDescriptor>,
): Registry {
  return {
    list: (opts?: { tags?: string[] | null; prefix?: string | null }) => {
      let ids = Object.keys(descriptors);
      if (opts?.prefix) {
        ids = ids.filter((id) => id.startsWith(opts.prefix!));
      }
      return ids;
    },
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
        name: { type: "string" },
      },
      required: ["name"],
    },
    outputSchema: overrides.outputSchema ?? {
      type: "object",
      properties: {
        result: { type: "string" },
      },
    },
    annotations: overrides.annotations !== undefined
      ? overrides.annotations
      : null,
    tags: overrides.tags,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OpenAIConverter", () => {
  const converter = new OpenAIConverter();

  // TC-OPENAI-001
  it("converts a single descriptor to an OpenAI tool definition", () => {
    const descriptor = makeDescriptor({
      moduleId: "text.summarize",
      description: "Summarize text",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Input text" },
        },
        required: ["text"],
      },
    });

    const tool = converter.convertDescriptor(descriptor);

    expect(tool.type).toBe("function");
    expect(tool.function.name).toBe("text-summarize");
    expect(tool.function.description).toBe("Summarize text");
    expect(tool.function.parameters).toEqual(
      expect.objectContaining({
        type: "object",
        properties: expect.objectContaining({
          text: { type: "string", description: "Input text" },
        }),
      }),
    );
  });

  // TC-OPENAI-002
  it("converts an empty registry to an empty array", () => {
    const registry = createMockRegistry({});
    const tools = converter.convertRegistry(registry);

    expect(tools).toEqual([]);
  });

  // TC-OPENAI-003
  it("normalizes module IDs by replacing dots with dashes", () => {
    const descriptor = makeDescriptor({
      moduleId: "image.resize",
    });

    const tool = converter.convertDescriptor(descriptor);

    expect(tool.function.name).toBe("image-resize");
  });

  // TC-OPENAI-004
  it("embeds annotations in description when embedAnnotations is true", () => {
    const descriptor = makeDescriptor({
      annotations: {
        readonly: true,
        destructive: false,
        idempotent: true,
        requiresApproval: false,
        openWorld: false,
      },
    });

    const tool = converter.convertDescriptor(descriptor, {
      embedAnnotations: true,
    });

    expect(tool.function.description).toContain("[Annotations:");
    // Only non-default values should appear
    expect(tool.function.description).toContain("readonly=true");
    expect(tool.function.description).toContain("idempotent=true");
    expect(tool.function.description).toContain("open_world=false");
    // Default values should NOT appear
    expect(tool.function.description).not.toContain("destructive=false");
    expect(tool.function.description).not.toContain("requires_approval=false");
  });

  // TC-OPENAI-005
  it("does not embed annotations by default", () => {
    const descriptor = makeDescriptor({
      annotations: {
        readonly: true,
        destructive: false,
        idempotent: true,
        requiresApproval: false,
        openWorld: false,
      },
    });

    const tool = converter.convertDescriptor(descriptor);

    expect(tool.function.description).not.toContain("[Annotations:");
  });

  // TC-OPENAI-006
  it("applies strict mode: adds strict flag, additionalProperties false, all props required", () => {
    const descriptor = makeDescriptor({
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "integer" },
        },
        required: ["name", "age"],
      },
    });

    const tool = converter.convertDescriptor(descriptor, { strict: true });

    expect(tool.function.strict).toBe(true);
    expect(tool.function.parameters["additionalProperties"]).toBe(false);
    expect(tool.function.parameters["required"]).toEqual(
      expect.arrayContaining(["name", "age"]),
    );
  });

  // TC-OPENAI-007
  it("strict mode makes optional fields nullable with [type, 'null']", () => {
    const descriptor = makeDescriptor({
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          nickname: { type: "string" },
        },
        required: ["name"],
      },
    });

    const tool = converter.convertDescriptor(descriptor, { strict: true });

    const properties = tool.function.parameters["properties"] as Record<
      string,
      Record<string, unknown>
    >;

    // name was already required, so its type stays as-is
    expect(properties["name"]["type"]).toBe("string");

    // nickname was optional, so it becomes nullable
    expect(properties["nickname"]["type"]).toEqual(["string", "null"]);

    // All properties are now required
    expect(tool.function.parameters["required"]).toEqual(
      expect.arrayContaining(["name", "nickname"]),
    );
  });

  // TC-OPENAI-008
  it("strict mode removes default values", () => {
    const descriptor = makeDescriptor({
      inputSchema: {
        type: "object",
        properties: {
          count: { type: "integer", default: 10 },
        },
        required: ["count"],
      },
    });

    const tool = converter.convertDescriptor(descriptor, { strict: true });

    const properties = tool.function.parameters["properties"] as Record<
      string,
      Record<string, unknown>
    >;

    expect(properties["count"]["default"]).toBeUndefined();
  });

  // TC-OPENAI-009
  it("converts a registry with multiple modules", () => {
    const registry = createMockRegistry({
      "mod.a": makeDescriptor({ moduleId: "mod.a", description: "Module A" }),
      "mod.b": makeDescriptor({ moduleId: "mod.b", description: "Module B" }),
      "mod.c": makeDescriptor({ moduleId: "mod.c", description: "Module C" }),
    });

    const tools = converter.convertRegistry(registry);

    expect(tools).toHaveLength(3);
    const names = tools.map((t) => t.function.name);
    expect(names).toContain("mod-a");
    expect(names).toContain("mod-b");
    expect(names).toContain("mod-c");
  });

  // TC-OPENAI-010
  it("skips null definitions returned by the registry", () => {
    const descriptors: Record<string, ModuleDescriptor> = {
      "mod.a": makeDescriptor({ moduleId: "mod.a" }),
      "mod.b": makeDescriptor({ moduleId: "mod.b" }),
    };

    // Override getDefinition to return null for mod.b
    const registry = createMockRegistry(descriptors);
    const originalGetDef = registry.getDefinition.bind(registry);
    registry.getDefinition = (id: string) => {
      if (id === "mod.b") return null;
      return originalGetDef(id);
    };

    const tools = converter.convertRegistry(registry);

    expect(tools).toHaveLength(1);
    expect(tools[0].function.name).toBe("mod-a");
  });

  // TC-OPENAI-011
  it("filters modules by prefix", () => {
    const registry = createMockRegistry({
      "image.resize": makeDescriptor({ moduleId: "image.resize" }),
      "image.crop": makeDescriptor({ moduleId: "image.crop" }),
      "text.summarize": makeDescriptor({ moduleId: "text.summarize" }),
    });

    const tools = converter.convertRegistry(registry, { prefix: "image" });

    expect(tools).toHaveLength(2);
    const names = tools.map((t) => t.function.name);
    expect(names).toContain("image-resize");
    expect(names).toContain("image-crop");
    expect(names).not.toContain("text-summarize");
  });

  // TC-OPENAI-012
  it("passes tags filter to registry.list()", () => {
    let capturedTags: string[] | null | undefined;

    const registry: Registry = {
      list: (opts?: { tags?: string[] | null; prefix?: string | null }) => {
        capturedTags = opts?.tags;
        return [];
      },
      getDefinition: () => null,
      on: () => {},
    };

    converter.convertRegistry(registry, { tags: ["ml", "vision"] });

    expect(capturedTags).toEqual(["ml", "vision"]);
  });

  // ---------------------------------------------------------------------------
  // [OC-1] Strict-mode walker parity with Python+Rust
  // ---------------------------------------------------------------------------

  describe("OC-1: strict-mode walker parity", () => {
    it("promotes x-llm-description into description", () => {
      const descriptor = makeDescriptor({
        moduleId: "test.module",
        inputSchema: {
          type: "object",
          properties: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            ts: { type: "string", "x-llm-description": "agent-friendly hint" },
          },
          required: ["ts"],
        },
      });

      const tool = converter.convertDescriptor(descriptor, { strict: true });
      const params = tool.function.parameters as Record<string, unknown>;
      const props = params.properties as Record<string, Record<string, unknown>>;
      expect(props.ts.description).toBe("agent-friendly hint");
      expect(props.ts["x-llm-description"]).toBeUndefined();
    });

    it("strips all x-* extension keys after promotion", () => {
      const descriptor = makeDescriptor({
        moduleId: "test.module",
        inputSchema: {
          type: "object",
          properties: {
            ts: {
              type: "string",
              // eslint-disable-next-line @typescript-eslint/naming-convention
              "x-llm-description": "hint",
              // eslint-disable-next-line @typescript-eslint/naming-convention
              "x-internal-tag": "should-be-stripped",
            },
          },
          required: ["ts"],
        },
      });

      const tool = converter.convertDescriptor(descriptor, { strict: true });
      const params = tool.function.parameters as Record<string, unknown>;
      const props = params.properties as Record<string, Record<string, unknown>>;
      expect(Object.keys(props.ts).filter((k) => k.startsWith("x-"))).toEqual([]);
    });

    it("recurses into oneOf branches", () => {
      const descriptor = makeDescriptor({
        moduleId: "test.module",
        inputSchema: {
          type: "object",
          properties: {
            payload: {
              oneOf: [
                {
                  type: "object",
                  properties: { name: { type: "string" } },
                  required: ["name"],
                },
                {
                  type: "object",
                  properties: { code: { type: "integer" } },
                  required: ["code"],
                },
              ],
            },
          },
          required: ["payload"],
        },
      });

      const tool = converter.convertDescriptor(descriptor, { strict: true });
      const params = tool.function.parameters as Record<string, unknown>;
      const props = params.properties as Record<string, Record<string, unknown>>;
      const branches = (props.payload.oneOf as Array<Record<string, unknown>>);
      expect(branches[0].additionalProperties).toBe(false);
      expect(branches[1].additionalProperties).toBe(false);
    });

    it("recurses into $defs subschemas", () => {
      // The walker is exercised directly because the SchemaConverter inlines
      // $defs/refs before strict mode runs. The contract under test is that
      // when strict mode encounters $defs (e.g. caller-provided schemas that
      // still use them), it transforms each definition.
      const schema = {
        type: "object",
        $defs: {
          Address: {
            type: "object",
            properties: {
              street: { type: "string" },
              city: { type: "string" },
            },
            required: ["street"],
          },
        },
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
      };

      const transformed = converter._applyStrictMode(schema) as Record<string, unknown>;
      const defs = transformed.$defs as Record<string, Record<string, unknown>>;
      expect(defs.Address.additionalProperties).toBe(false);
      // Both nested properties become required (alphabetically sorted).
      expect(defs.Address.required).toEqual(["city", "street"]);
    });

    it("sorts property names alphabetically for cross-SDK output parity", () => {
      const descriptor = makeDescriptor({
        moduleId: "test.module",
        inputSchema: {
          type: "object",
          properties: {
            zeta: { type: "string" },
            alpha: { type: "string" },
            beta: { type: "string" },
          },
          required: [],
        },
      });

      const tool = converter.convertDescriptor(descriptor, { strict: true });
      const params = tool.function.parameters as Record<string, unknown>;
      expect(params.required).toEqual(["alpha", "beta", "zeta"]);
    });

    it("removes default values from properties", () => {
      const descriptor = makeDescriptor({
        moduleId: "test.module",
        inputSchema: {
          type: "object",
          properties: {
            count: { type: "integer", default: 10 },
          },
          required: [],
        },
      });

      const tool = converter.convertDescriptor(descriptor, { strict: true });
      const params = tool.function.parameters as Record<string, unknown>;
      const props = params.properties as Record<string, Record<string, unknown>>;
      expect(props.count.default).toBeUndefined();
    });
  });
});
