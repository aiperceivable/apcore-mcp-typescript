import { describe, it, expect } from "vitest";
import { MCP_NAMESPACE, MCP_ENV_PREFIX, MCP_DEFAULTS, registerMcpNamespace } from "../src/config.js";

describe("MCP Config Namespace", () => {
  it("should export correct namespace name", () => {
    expect(MCP_NAMESPACE).toBe("mcp");
  });

  it("should export correct env prefix", () => {
    expect(MCP_ENV_PREFIX).toBe("APCORE_MCP");
  });

  it("should have sensible defaults", () => {
    expect(MCP_DEFAULTS.transport).toBe("stdio");
    expect(MCP_DEFAULTS.host).toBe("127.0.0.1");
    expect(MCP_DEFAULTS.port).toBe(8000);
  });

  it("should register without throwing", () => {
    expect(() => registerMcpNamespace()).not.toThrow();
  });

  it("should be idempotent", () => {
    registerMcpNamespace();
    expect(() => registerMcpNamespace()).not.toThrow();
  });
});
