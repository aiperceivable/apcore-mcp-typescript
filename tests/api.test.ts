/**
 * Tests for the public API: toOpenaiTools() and serve()
 */

import { describe, it, expect, vi } from "vitest";
import { toOpenaiTools } from "../src/index.js";
import type { Registry, Executor, ModuleDescriptor } from "../src/types.js";

function createDescriptor(
  moduleId: string,
  description: string = "A test module",
): ModuleDescriptor {
  return {
    module_id: moduleId,
    description,
    input_schema: {
      type: "object",
      properties: {
        value: { type: "string" },
      },
      required: ["value"],
    },
    output_schema: {},
    annotations: {
      readonly: false,
      destructive: false,
      idempotent: true,
      requires_approval: false,
      open_world: true,
    },
  };
}

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

function createMockExecutor(
  registry: Registry,
): Executor {
  return {
    registry,
    call: vi.fn(),
    call_async: vi.fn().mockResolvedValue({ status: "ok" }),
  };
}

describe("toOpenaiTools()", () => {
  it("converts a registry with modules", () => {
    const registry = createMockRegistry({
      "image.resize": createDescriptor("image.resize", "Resize an image"),
      "text.summarize": createDescriptor("text.summarize", "Summarize text"),
    });

    const tools = toOpenaiTools(registry);

    expect(tools).toHaveLength(2);
    expect(tools[0].type).toBe("function");
    expect(tools[0].function.name).toBe("image-resize");
    expect(tools[0].function.description).toBe("Resize an image");
    expect(tools[1].function.name).toBe("text-summarize");
  });

  it("returns empty array for empty registry", () => {
    const registry = createMockRegistry({});
    const tools = toOpenaiTools(registry);
    expect(tools).toHaveLength(0);
  });

  it("supports embed_annotations option", () => {
    const registry = createMockRegistry({
      "test.module": createDescriptor("test.module"),
    });

    const tools = toOpenaiTools(registry, { embedAnnotations: true });

    expect(tools[0].function.description).toContain("[Annotations:");
  });

  it("supports strict mode option", () => {
    const registry = createMockRegistry({
      "test.module": createDescriptor("test.module"),
    });

    const tools = toOpenaiTools(registry, { strict: true });

    expect(tools[0].function.strict).toBe(true);
    expect(tools[0].function.parameters["additionalProperties"]).toBe(false);
  });

  it("supports prefix filtering", () => {
    const registry = createMockRegistry({
      "image.resize": createDescriptor("image.resize"),
      "text.summarize": createDescriptor("text.summarize"),
    });

    const tools = toOpenaiTools(registry, { prefix: "image." });

    expect(tools).toHaveLength(1);
    expect(tools[0].function.name).toBe("image-resize");
  });

  it("accepts an Executor and extracts registry", () => {
    const registry = createMockRegistry({
      "test.module": createDescriptor("test.module"),
    });
    const executor = createMockExecutor(registry);

    const tools = toOpenaiTools(executor);

    expect(tools).toHaveLength(1);
    expect(tools[0].function.name).toBe("test-module");
  });
});

describe("serve()", () => {
  it("throws for unknown transport type", async () => {
    const registry = createMockRegistry({});
    const executor = createMockExecutor(registry);

    await expect(
      // @ts-expect-error testing invalid transport
      import("../src/index.js").then((m) =>
        m.serve(executor, { transport: "invalid" }),
      ),
    ).rejects.toThrow("Unknown transport");
  });

  it("throws when passed a Registry without Executor", async () => {
    const registry = createMockRegistry({});

    const { serve } = await import("../src/index.js");

    await expect(serve(registry)).rejects.toThrow("Executor");
  });
});
