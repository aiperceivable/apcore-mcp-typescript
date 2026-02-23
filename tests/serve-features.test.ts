/**
 * Tests for serve() Features 1, 2, and 4:
 *   F1: tags/prefix filtering passed to buildTools
 *   F2: logLevel suppresses correct console methods
 *   F4: onStartup/onShutdown callback invocation order
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Registry, Executor, ModuleDescriptor } from "../src/types.js";

// ---------------------------------------------------------------------------
// Top-level mocks with controllable behavior
// ---------------------------------------------------------------------------

const mockRunStdio = vi.fn().mockResolvedValue(undefined);
const mockBuildTools = vi.fn().mockReturnValue([]);
const mockCreateServer = vi.fn().mockReturnValue({});
const mockRegisterHandlers = vi.fn();

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
    createServer: mockCreateServer,
    buildTools: mockBuildTools,
    registerHandlers: mockRegisterHandlers,
    registerResourceHandlers: vi.fn(),
  })),
}));

// Import serve after mocks are set up
import { serve } from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDescriptor(moduleId: string): ModuleDescriptor {
  return {
    moduleId,
    description: `Description for ${moduleId}`,
    inputSchema: { type: "object", properties: {} },
    outputSchema: {},
    annotations: {
      readonly: false,
      destructive: false,
      idempotent: true,
      requiresApproval: false,
      openWorld: false,
      streaming: false,
    },
  };
}

function createMockRegistry(
  descriptors: Record<string, ModuleDescriptor>,
): Registry {
  return {
    list: vi.fn((opts?: { tags?: string[] | null; prefix?: string | null }) => {
      let ids = Object.keys(descriptors);
      if (opts?.tags && opts.tags.length > 0) {
        ids = ids.filter((id) => {
          const desc = descriptors[id];
          return desc.tags?.some((t) => opts.tags!.includes(t));
        });
      }
      if (opts?.prefix) {
        ids = ids.filter((id) => id.startsWith(opts.prefix!));
      }
      return ids;
    }),
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
// Setup / Teardown
// ---------------------------------------------------------------------------

let originalDebug: typeof console.debug;
let originalInfo: typeof console.info;
let originalWarn: typeof console.warn;

beforeEach(() => {
  originalDebug = console.debug;
  originalInfo = console.info;
  originalWarn = console.warn;
  vi.clearAllMocks();
  mockRunStdio.mockResolvedValue(undefined);
  mockBuildTools.mockReturnValue([]);
  mockCreateServer.mockReturnValue({});
});

afterEach(() => {
  console.debug = originalDebug;
  console.info = originalInfo;
  console.warn = originalWarn;
});

// ---------------------------------------------------------------------------
// F1: tags/prefix filtering
// ---------------------------------------------------------------------------

describe("serve() tags/prefix filtering (F1)", () => {
  it("passes tags and prefix to factory.buildTools", async () => {
    const registry = createMockRegistry({
      "image.resize": createDescriptor("image.resize"),
      "text.summarize": createDescriptor("text.summarize"),
    });
    const executor = createMockExecutor(registry);

    await serve(executor, {
      transport: "stdio",
      tags: ["image"],
      prefix: "image.",
    });

    expect(mockBuildTools).toHaveBeenCalledTimes(1);
    const [passedRegistry, passedOptions] = mockBuildTools.mock.calls[0];
    expect(passedRegistry).toBe(registry);
    expect(passedOptions).toEqual({ tags: ["image"], prefix: "image." });
  });

  it("passes undefined tags/prefix when not specified", async () => {
    const registry = createMockRegistry({});
    const executor = createMockExecutor(registry);

    await serve(executor, { transport: "stdio" });

    expect(mockBuildTools).toHaveBeenCalledTimes(1);
    const [, passedOptions] = mockBuildTools.mock.calls[0];
    expect(passedOptions).toEqual({ tags: undefined, prefix: undefined });
  });
});

// ---------------------------------------------------------------------------
// F2: logLevel suppression
// ---------------------------------------------------------------------------

describe("serve() logLevel suppression (F2)", () => {
  it("logLevel=DEBUG suppresses nothing", async () => {
    const registry = createMockRegistry({});
    const executor = createMockExecutor(registry);

    let capturedDebug: typeof console.debug | undefined;
    let capturedInfo: typeof console.info | undefined;
    let capturedWarn: typeof console.warn | undefined;
    mockRunStdio.mockImplementation(async () => {
      capturedDebug = console.debug;
      capturedInfo = console.info;
      capturedWarn = console.warn;
    });

    await serve(executor, { transport: "stdio", logLevel: "DEBUG" });

    // During execution, nothing was suppressed
    expect(capturedDebug).toBe(originalDebug);
    expect(capturedInfo).toBe(originalInfo);
    expect(capturedWarn).toBe(originalWarn);
    // After serve() returns, console methods are restored
    expect(console.debug).toBe(originalDebug);
    expect(console.info).toBe(originalInfo);
    expect(console.warn).toBe(originalWarn);
  });

  it("logLevel=INFO suppresses console.debug", async () => {
    const registry = createMockRegistry({});
    const executor = createMockExecutor(registry);

    let capturedDebug: typeof console.debug | undefined;
    let capturedInfo: typeof console.info | undefined;
    let capturedWarn: typeof console.warn | undefined;
    mockRunStdio.mockImplementation(async () => {
      capturedDebug = console.debug;
      capturedInfo = console.info;
      capturedWarn = console.warn;
    });

    await serve(executor, { transport: "stdio", logLevel: "INFO" });

    // During execution, console.debug was suppressed
    expect(capturedDebug).not.toBe(originalDebug);
    expect(capturedInfo).toBe(originalInfo);
    expect(capturedWarn).toBe(originalWarn);
    // After serve() returns, console methods are restored
    expect(console.debug).toBe(originalDebug);
    expect(console.info).toBe(originalInfo);
    expect(console.warn).toBe(originalWarn);
  });

  it("logLevel=WARNING suppresses console.debug and console.info", async () => {
    const registry = createMockRegistry({});
    const executor = createMockExecutor(registry);

    let capturedDebug: typeof console.debug | undefined;
    let capturedInfo: typeof console.info | undefined;
    let capturedWarn: typeof console.warn | undefined;
    mockRunStdio.mockImplementation(async () => {
      capturedDebug = console.debug;
      capturedInfo = console.info;
      capturedWarn = console.warn;
    });

    await serve(executor, { transport: "stdio", logLevel: "WARNING" });

    // During execution, console.debug and console.info were suppressed
    expect(capturedDebug).not.toBe(originalDebug);
    expect(capturedInfo).not.toBe(originalInfo);
    expect(capturedWarn).toBe(originalWarn);
    // After serve() returns, console methods are restored
    expect(console.debug).toBe(originalDebug);
    expect(console.info).toBe(originalInfo);
    expect(console.warn).toBe(originalWarn);
  });

  it("logLevel=ERROR suppresses console.debug, console.info, and console.warn", async () => {
    const registry = createMockRegistry({});
    const executor = createMockExecutor(registry);

    let capturedDebug: typeof console.debug | undefined;
    let capturedInfo: typeof console.info | undefined;
    let capturedWarn: typeof console.warn | undefined;
    mockRunStdio.mockImplementation(async () => {
      capturedDebug = console.debug;
      capturedInfo = console.info;
      capturedWarn = console.warn;
    });

    await serve(executor, { transport: "stdio", logLevel: "ERROR" });

    // During execution, all three were suppressed
    expect(capturedDebug).not.toBe(originalDebug);
    expect(capturedInfo).not.toBe(originalInfo);
    expect(capturedWarn).not.toBe(originalWarn);
    // After serve() returns, console methods are restored
    expect(console.debug).toBe(originalDebug);
    expect(console.info).toBe(originalInfo);
    expect(console.warn).toBe(originalWarn);
  });

  it("no logLevel does not suppress any console methods", async () => {
    const registry = createMockRegistry({});
    const executor = createMockExecutor(registry);

    let capturedDebug: typeof console.debug | undefined;
    let capturedInfo: typeof console.info | undefined;
    let capturedWarn: typeof console.warn | undefined;
    mockRunStdio.mockImplementation(async () => {
      capturedDebug = console.debug;
      capturedInfo = console.info;
      capturedWarn = console.warn;
    });

    await serve(executor, { transport: "stdio" });

    // During execution, nothing was suppressed
    expect(capturedDebug).toBe(originalDebug);
    expect(capturedInfo).toBe(originalInfo);
    expect(capturedWarn).toBe(originalWarn);
    // After serve() returns, console methods are restored
    expect(console.debug).toBe(originalDebug);
    expect(console.info).toBe(originalInfo);
    expect(console.warn).toBe(originalWarn);
  });
});

// ---------------------------------------------------------------------------
// F4: onStartup/onShutdown lifecycle hooks
// ---------------------------------------------------------------------------

describe("serve() onStartup/onShutdown (F4)", () => {
  it("calls onStartup before transport runs and onShutdown after", async () => {
    const callOrder: string[] = [];

    mockRunStdio.mockImplementation(async () => {
      callOrder.push("transport");
    });

    const registry = createMockRegistry({});
    const executor = createMockExecutor(registry);

    const onStartup = vi.fn().mockImplementation(async () => {
      callOrder.push("startup");
    });
    const onShutdown = vi.fn().mockImplementation(async () => {
      callOrder.push("shutdown");
    });

    await serve(executor, {
      transport: "stdio",
      onStartup,
      onShutdown,
    });

    expect(onStartup).toHaveBeenCalledTimes(1);
    expect(onShutdown).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["startup", "transport", "shutdown"]);
  });

  it("calls onShutdown even when transport throws", async () => {
    mockRunStdio.mockRejectedValue(new Error("transport failed"));

    const registry = createMockRegistry({});
    const executor = createMockExecutor(registry);

    const onShutdown = vi.fn();

    await expect(
      serve(executor, {
        transport: "stdio",
        onShutdown,
      }),
    ).rejects.toThrow("transport failed");

    expect(onShutdown).toHaveBeenCalledTimes(1);
  });

  it("works without onStartup/onShutdown (backward compat)", async () => {
    const registry = createMockRegistry({});
    const executor = createMockExecutor(registry);

    // Should not throw
    await serve(executor, { transport: "stdio" });

    expect(mockRunStdio).toHaveBeenCalledTimes(1);
  });
});
