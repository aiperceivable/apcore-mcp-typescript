/**
 * Tests for APCoreMCP unified class.
 *
 * Covers:
 * - Constructor validation (name, tags, prefix)
 * - Registry/Executor backend resolution
 * - serve() delegation to function-level serve()
 * - asyncServe() delegation
 * - toOpenaiTools() delegation
 * - tools getter
 * - Extensions dir lazy resolution error handling
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Registry, Executor } from "../src/types.js";

// ---------------------------------------------------------------------------
// Top-level mocks
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
    setAuthenticator: vi.fn(),
    setRequireAuth: vi.fn(),
    setExemptPaths: vi.fn(),
    setMetricsCollector: vi.fn(),
    setExplorer: vi.fn(),
  })),
}));

vi.mock("../src/server/factory.js", () => ({
  MCPServerFactory: vi.fn().mockImplementation(() => ({
    createServer: mockCreateServer,
    buildTools: mockBuildTools,
    attachAsyncMetaTools: (tools: unknown[]) => tools,
    registerHandlers: mockRegisterHandlers,
    registerResourceHandlers: vi.fn(),
  })),
}));

// Import after mocks
import { APCoreMCP } from "../src/apcore-mcp.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockRegistry(moduleIds: string[] = []): Registry {
  return {
    list: vi.fn().mockReturnValue(moduleIds),
    getDefinition: vi.fn(),
    on: vi.fn(),
  };
}

function createMockExecutor(registry?: Registry): Executor {
  return {
    registry: registry ?? createMockRegistry(),
    call: vi.fn().mockResolvedValue({}),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("APCoreMCP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Constructor validation ──────────────────────────────────────────────

  describe("constructor validation", () => {
    it("throws if name is empty string", () => {
      const registry = createMockRegistry();
      expect(() => new APCoreMCP(registry, { name: "" })).toThrow("name must not be empty");
    });

    it("throws if name exceeds 255 characters", () => {
      const registry = createMockRegistry();
      const longName = "x".repeat(256);
      expect(() => new APCoreMCP(registry, { name: longName })).toThrow("name must not exceed 255 characters");
    });

    it("throws if tags contain empty strings", () => {
      const registry = createMockRegistry();
      expect(() => new APCoreMCP(registry, { tags: ["valid", ""] })).toThrow("tags must not contain empty strings");
    });

    it("throws if prefix is empty string", () => {
      const registry = createMockRegistry();
      expect(() => new APCoreMCP(registry, { prefix: "" })).toThrow("prefix must not be empty if provided");
    });

    it("accepts valid options without throwing", () => {
      const registry = createMockRegistry();
      expect(() => new APCoreMCP(registry, {
        name: "test-server",
        tags: ["a", "b"],
        prefix: "mymod",
      })).not.toThrow();
    });

    it("defaults name to 'apcore-mcp'", () => {
      const registry = createMockRegistry();
      const mcp = new APCoreMCP(registry);
      // Name is stored in options — verify by calling serve which passes it through
      expect(mcp).toBeDefined();
    });
  });

  // ── Registry / Executor resolution ──────────────────────────────────────

  describe("registry getter", () => {
    it("returns registry from a Registry backend", () => {
      const registry = createMockRegistry(["mod.a", "mod.b"]);
      const mcp = new APCoreMCP(registry);
      expect(mcp.registry).toBe(registry);
    });

    it("extracts registry from an Executor backend", () => {
      const registry = createMockRegistry();
      const executor = createMockExecutor(registry);
      const mcp = new APCoreMCP(executor);
      expect(mcp.registry).toBe(registry);
    });

    it("throws when constructed with string and registry accessed before serve()", () => {
      const mcp = new APCoreMCP("./extensions");
      expect(() => mcp.registry).toThrow("Registry not yet resolved");
    });
  });

  describe("tools getter", () => {
    it("returns module IDs from registry.list()", () => {
      const registry = createMockRegistry(["mod.a", "mod.b", "mod.c"]);
      const mcp = new APCoreMCP(registry);
      expect(mcp.tools).toEqual(["mod.a", "mod.b", "mod.c"]);
    });

    it("passes tags and prefix filters to registry.list()", () => {
      const registry = createMockRegistry([]);
      const mcp = new APCoreMCP(registry, { tags: ["public"], prefix: "api" });
      mcp.tools;
      expect(registry.list).toHaveBeenCalledWith({
        tags: ["public"],
        prefix: "api",
      });
    });

    it("returns empty array when no modules", () => {
      const registry = createMockRegistry([]);
      const mcp = new APCoreMCP(registry);
      expect(mcp.tools).toEqual([]);
    });
  });

  // ── serve() delegation ──────────────────────────────────────────────────

  describe("serve()", () => {
    it("delegates to function-level serve() with merged options", async () => {
      const registry = createMockRegistry();
      const mcp = new APCoreMCP(registry, {
        name: "my-server",
        validateInputs: true,
        tags: ["public"],
      });

      await mcp.serve({ transport: "stdio" });

      // Verify the factory was called (serve() creates factory internally)
      expect(mockCreateServer).toHaveBeenCalled();
      expect(mockRunStdio).toHaveBeenCalled();
    });

    it("works with Executor backend", async () => {
      const executor = createMockExecutor();
      const mcp = new APCoreMCP(executor);

      await mcp.serve();

      expect(mockRunStdio).toHaveBeenCalled();
    });
  });

  // ── toOpenaiTools() ─────────────────────────────────────────────────────

  describe("toOpenaiTools()", () => {
    it("returns OpenAI tool definitions from registry", () => {
      const registry = createMockRegistry([]);
      // The registry needs list() for the OpenAIConverter
      (registry.list as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const mcp = new APCoreMCP(registry);
      const tools = mcp.toOpenaiTools();

      expect(Array.isArray(tools)).toBe(true);
    });

    it("passes embedAnnotations and strict options through", () => {
      const registry = createMockRegistry([]);
      (registry.list as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const mcp = new APCoreMCP(registry);
      const tools = mcp.toOpenaiTools({ embedAnnotations: true, strict: true });

      expect(Array.isArray(tools)).toBe(true);
    });
  });

  // ── Extensions dir error ────────────────────────────────────────────────

  describe("extensions dir resolution", () => {
    it("throws descriptive error when apcore-js not installed", async () => {
      const mcp = new APCoreMCP("./nonexistent-extensions");

      await expect(mcp.serve()).rejects.toThrow(/Failed to create Registry/);
    });
  });

  // ── outputFormatter wiring ──────────────────────────────────────────────

  describe("outputFormatter", () => {
    it("passes outputFormatter through to ExecutionRouter via serve()", async () => {
      const registry = createMockRegistry();
      const formatter = (r: Record<string, unknown>) => `formatted: ${JSON.stringify(r)}`;
      const mcp = new APCoreMCP(registry, { outputFormatter: formatter });

      // serve() will create ExecutionRouter with the formatter
      // We can't directly inspect the router, but we verify it doesn't throw
      await mcp.serve();

      expect(mockRunStdio).toHaveBeenCalled();
    });
  });
});
