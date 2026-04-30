import { describe, it, expect } from "vitest";
import { McpErrorFormatter } from "../../src/adapters/mcp-error-formatter.js";

describe("McpErrorFormatter", () => {
  it("should return an object from format()", () => {
    const formatter = new McpErrorFormatter();
    const error = { code: "TEST_ERROR", message: "test error" };
    const result = formatter.format(error);
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("should handle ModuleError-like objects", () => {
    const formatter = new McpErrorFormatter();
    const error = {
      code: "MODULE_NOT_FOUND",
      message: "Module not found: test.module",
      details: { module_id: "test.module" },
    };
    const result = formatter.format(error);
    expect(result).toBeDefined();
    expect(result.isError).toBe(true);
  });

  it("should handle plain Error objects", () => {
    const formatter = new McpErrorFormatter();
    const error = new Error("unexpected failure");
    const result = formatter.format(error);
    expect(result).toBeDefined();
    expect(result.isError).toBe(true);
  });
});
