/**
 * D9-002: Config Bus deduplication — regression test.
 *
 * Verifies that both serve() and asyncServe() call Config.getInstance()
 * exactly once each (via loadConfigBusOverrides), not twice.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Executor, Registry } from "../src/types.js";

// ---------------------------------------------------------------------------
// Mocks — must be defined before vi.mock() hoisting resolves
// ---------------------------------------------------------------------------

vi.mock("../src/server/transport.js", () => ({
  TransportManager: vi.fn().mockImplementation(() => ({
    runStdio: vi.fn().mockResolvedValue(undefined),
    runStreamableHttp: vi.fn().mockResolvedValue(undefined),
    runSse: vi.fn().mockResolvedValue(undefined),
    buildStreamableHttpApp: vi.fn().mockResolvedValue({
      handler: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    }),
    setModuleCount: vi.fn(),
    setMetricsCollector: vi.fn(),
    setUsageCollector: vi.fn(),
    setAsyncTaskBridge: vi.fn(),
    setAuthenticator: vi.fn(),
    setRequireAuth: vi.fn(),
    setExemptPaths: vi.fn(),
    setExplorer: vi.fn(),
  })),
}));

vi.mock("../src/server/factory.js", () => ({
  MCPServerFactory: vi.fn().mockImplementation(() => ({
    createServer: vi.fn().mockReturnValue({}),
    buildTools: vi.fn().mockReturnValue([]),
    attachAsyncMetaTools: (tools: unknown[]) => tools,
    registerHandlers: vi.fn(),
    registerResourceHandlers: vi.fn(),
  })),
}));

const getInstanceSpy = vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(null) });

vi.mock("apcore-js", () => ({
  Config: {
    getInstance: (...args: unknown[]) => getInstanceSpy(...args),
  },
  buildStrategyFromConfig: vi.fn(),
  default: {
    Config: {
      getInstance: (...args: unknown[]) => getInstanceSpy(...args),
    },
    buildStrategyFromConfig: vi.fn(),
  },
}));

import { serve, asyncServe } from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRegistry(): Registry {
  return {
    list: vi.fn().mockReturnValue([]),
    getDefinition: vi.fn().mockReturnValue(null),
    on: vi.fn(),
  };
}

function makeExecutor(registry: Registry): Executor {
  return {
    registry,
    call: vi.fn().mockResolvedValue({ status: "ok" }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("D9-002: Config Bus deduplication", () => {
  beforeEach(() => {
    getInstanceSpy.mockClear();
    getInstanceSpy.mockReturnValue({ get: vi.fn().mockReturnValue(null) });
  });

  it("serve() calls Config.getInstance() exactly once via loadConfigBusOverrides", async () => {
    const registry = makeRegistry();
    const executor = makeExecutor(registry);
    await serve(executor, { transport: "stdio" });
    expect(getInstanceSpy).toHaveBeenCalledTimes(1);
  });

  it("asyncServe() calls Config.getInstance() exactly once via loadConfigBusOverrides", async () => {
    const registry = makeRegistry();
    const executor = makeExecutor(registry);
    const app = await asyncServe(executor, {});
    await app.close();
    expect(getInstanceSpy).toHaveBeenCalledTimes(1);
  });
});

describe("D9-002: Config Bus scalar key reads (transport/host/port)", () => {
  beforeEach(async () => {
    // Reset transport mock state per test.
    const { TransportManager } = await import("../src/server/transport.js");
    (TransportManager as unknown as { mockClear: () => void }).mockClear();
    getInstanceSpy.mockClear();
  });

  it("uses Config Bus mcp.port when caller does not pass port", async () => {
    // Stub Config.get to return port 9000 for mcp.port (matching the audit's
    // canonical example: APCORE_MCP_PORT=9000).
    getInstanceSpy.mockReturnValue({
      get: vi.fn((k: string) => {
        if (k === "mcp.port") return 9000;
        if (k === "mcp.transport") return "streamable-http";
        if (k === "mcp.host") return "0.0.0.0";
        return null;
      }),
    });
    const registry = makeRegistry();
    const executor = makeExecutor(registry);
    await serve(executor, {}); // no transport/host/port passed

    const { TransportManager } = await import("../src/server/transport.js");
    // The mock instance's runStreamableHttp should have been called with the
    // bus-resolved host+port.
    const lastInstance = (TransportManager as unknown as { mock: { results: Array<{ value: { runStreamableHttp: ReturnType<typeof vi.fn> } }> } }).mock.results.at(-1)?.value;
    expect(lastInstance?.runStreamableHttp).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ host: "0.0.0.0", port: 9000 }),
    );
  });

  it("caller-supplied port wins over Config Bus mcp.port", async () => {
    getInstanceSpy.mockReturnValue({
      get: vi.fn((k: string) => {
        if (k === "mcp.port") return 9000;
        if (k === "mcp.transport") return "streamable-http";
        return null;
      }),
    });
    const registry = makeRegistry();
    const executor = makeExecutor(registry);
    await serve(executor, { port: 7777 }); // caller wins

    const { TransportManager } = await import("../src/server/transport.js");
    const lastInstance = (TransportManager as unknown as { mock: { results: Array<{ value: { runStreamableHttp: ReturnType<typeof vi.fn> } }> } }).mock.results.at(-1)?.value;
    expect(lastInstance?.runStreamableHttp).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ port: 7777 }),
    );
  });
});
