/**
 * Tests for resolveRegistry() and resolveExecutor() — exported helpers.
 *
 * resolveExecutor's apcore-js auto-creation path uses dynamic import(),
 * which is hard to mock in ESM test context. Instead, we:
 *  - Test resolveExecutor with an Executor (pass-through path) directly
 *  - Test resolveExecutor with a bare Registry (error path) directly
 *  - Test the apcore-js auto-creation path through serve() with vi.mock
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveRegistry,
  resolveExecutor,
} from "../src/index.js";
import type { Registry, Executor, ModuleDescriptor } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDescriptor(moduleId: string): ModuleDescriptor {
  return {
    moduleId,
    description: `Desc for ${moduleId}`,
    inputSchema: { type: "object", properties: {} },
    outputSchema: {},
    annotations: null,
  };
}

function createMockRegistry(
  descriptors: Record<string, ModuleDescriptor>,
): Registry {
  return {
    list: () => Object.keys(descriptors),
    getDefinition: (id: string) => descriptors[id] ?? null,
    on: vi.fn(),
  };
}

function createMockExecutor(registry: Registry): Executor {
  return {
    registry,
    call: vi.fn().mockResolvedValue({ status: "ok" }),
  };
}

// ---------------------------------------------------------------------------
// resolveRegistry
// ---------------------------------------------------------------------------

describe("resolveRegistry()", () => {
  it("returns Registry directly when given a Registry", () => {
    const registry = createMockRegistry({
      "test.module": createDescriptor("test.module"),
    });

    const result = resolveRegistry(registry);

    expect(result).toBe(registry);
  });

  it("extracts registry from Executor", () => {
    const registry = createMockRegistry({
      "test.module": createDescriptor("test.module"),
    });
    const executor = createMockExecutor(registry);

    const result = resolveRegistry(executor);

    expect(result).toBe(registry);
  });

  it("extracts registry from Executor with callAsync", () => {
    const registry = createMockRegistry({});
    const executor: Executor = {
      registry,
      call: vi.fn(),
      callAsync: vi.fn(),
    };

    const result = resolveRegistry(executor);

    expect(result).toBe(registry);
  });
});

// ---------------------------------------------------------------------------
// resolveExecutor — pass-through and error paths
// ---------------------------------------------------------------------------

describe("resolveExecutor()", () => {
  it("returns Executor directly when given an Executor with call()", async () => {
    const registry = createMockRegistry({});
    const executor = createMockExecutor(registry);

    const result = await resolveExecutor(executor);

    expect(result).toBe(executor);
  });

  it("returns Executor directly when given an Executor with callAsync()", async () => {
    const registry = createMockRegistry({});
    const executor: Executor = {
      registry,
      call: vi.fn(),
      callAsync: vi.fn(),
    };

    const result = await resolveExecutor(executor);

    expect(result).toBe(executor);
  });

  it("auto-creates Executor from bare Registry when apcore-js is installed", async () => {
    const registry = createMockRegistry({
      "test.module": createDescriptor("test.module"),
    });

    const executor = await resolveExecutor(registry);
    expect(executor).toBeDefined();
    expect(typeof executor.call === "function" || typeof executor.callAsync === "function").toBe(true);
  });

  it("preserves the original Executor reference (identity check)", async () => {
    const registry = createMockRegistry({});
    const executor = createMockExecutor(registry);

    const result1 = await resolveExecutor(executor);
    const result2 = await resolveExecutor(executor);

    expect(result1).toBe(result2);
    expect(result1).toBe(executor);
  });
});

// ---------------------------------------------------------------------------
// resolveExecutor — apcore-js auto-creation via serve()
// ---------------------------------------------------------------------------

const mockRunStdio = vi.fn().mockResolvedValue(undefined);
const mockBuildTools = vi.fn().mockReturnValue([]);

vi.mock("../src/server/transport.js", () => ({
  TransportManager: vi.fn().mockImplementation(() => ({
    runStdio: mockRunStdio,
    runStreamableHttp: vi.fn(),
    runSse: vi.fn(),
    setModuleCount: vi.fn(),
  })),
}));

vi.mock("../src/server/factory.js", () => ({
  MCPServerFactory: vi.fn().mockImplementation(() => ({
    createServer: vi.fn().mockReturnValue({}),
    buildTools: mockBuildTools,
    registerHandlers: vi.fn(),
    registerResourceHandlers: vi.fn(),
  })),
}));

// Re-import serve after mocks are set up
const { serve: serveWithMocks } = await import("../src/index.js");

describe("serve() with resolveExecutor integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunStdio.mockResolvedValue(undefined);
    mockBuildTools.mockReturnValue([]);
  });

  it("auto-resolves bare Registry through serve() when apcore-js is available", async () => {
    const registry = createMockRegistry({
      "test.module": createDescriptor("test.module"),
    });

    await serveWithMocks(registry, { transport: "stdio" });

    expect(mockRunStdio).toHaveBeenCalledTimes(1);
  });

  it("resolves Executor automatically and calls transport via serve()", async () => {
    const registry = createMockRegistry({
      "test.module": createDescriptor("test.module"),
    });
    const executor = createMockExecutor(registry);

    await serveWithMocks(executor, { transport: "stdio" });

    expect(mockRunStdio).toHaveBeenCalledTimes(1);
    expect(mockBuildTools).toHaveBeenCalledWith(registry, {
      tags: undefined,
      prefix: undefined,
    });
  });
});
