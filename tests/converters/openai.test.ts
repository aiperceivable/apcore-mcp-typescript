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
        name: { type: "string" },
      },
      required: ["name"],
    },
    output_schema: overrides.output_schema ?? {
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
      module_id: "text.summarize",
      description: "Summarize text",
      input_schema: {
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
      module_id: "image.resize",
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
        requires_approval: false,
        open_world: false,
      },
    });

    const tool = converter.convertDescriptor(descriptor, {
      embedAnnotations: true,
    });

    expect(tool.function.description).toContain("[Annotations:");
    expect(tool.function.description).toContain("readonly=true");
    expect(tool.function.description).toContain("destructive=false");
    expect(tool.function.description).toContain("idempotent=true");
    expect(tool.function.description).toContain("requires_approval=false");
    expect(tool.function.description).toContain("open_world=false");
  });

  // TC-OPENAI-005
  it("does not embed annotations by default", () => {
    const descriptor = makeDescriptor({
      annotations: {
        readonly: true,
        destructive: false,
        idempotent: true,
        requires_approval: false,
        open_world: false,
      },
    });

    const tool = converter.convertDescriptor(descriptor);

    expect(tool.function.description).not.toContain("[Annotations:");
  });

  // TC-OPENAI-006
  it("applies strict mode: adds strict flag, additionalProperties false, all props required", () => {
    const descriptor = makeDescriptor({
      input_schema: {
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
      input_schema: {
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
      input_schema: {
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
      "mod.a": makeDescriptor({ module_id: "mod.a", description: "Module A" }),
      "mod.b": makeDescriptor({ module_id: "mod.b", description: "Module B" }),
      "mod.c": makeDescriptor({ module_id: "mod.c", description: "Module C" }),
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
      "mod.a": makeDescriptor({ module_id: "mod.a" }),
      "mod.b": makeDescriptor({ module_id: "mod.b" }),
    };

    // Override get_definition to return null for mod.b
    const registry = createMockRegistry(descriptors);
    const originalGetDef = registry.get_definition.bind(registry);
    registry.get_definition = (id: string) => {
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
      "image.resize": makeDescriptor({ module_id: "image.resize" }),
      "image.crop": makeDescriptor({ module_id: "image.crop" }),
      "text.summarize": makeDescriptor({ module_id: "text.summarize" }),
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
      get_definition: () => null,
      get: () => null,
      on: () => {},
    };

    converter.convertRegistry(registry, { tags: ["ml", "vision"] });

    expect(capturedTags).toEqual(["ml", "vision"]);
  });
});
