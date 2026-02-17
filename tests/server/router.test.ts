import { describe, it, expect, vi } from "vitest";
import { ExecutionRouter } from "../../src/server/router.js";
import type { Executor } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockExecutor(
  result?: Record<string, unknown>,
  error?: Error,
): Executor {
  return {
    registry: {} as any,
    call: vi.fn(),
    call_async: error
      ? vi.fn().mockRejectedValue(error)
      : vi.fn().mockResolvedValue(result ?? {}),
  };
}

function makeModuleError(
  message: string,
  code: string,
  details: Record<string, unknown> | null = null,
): Error & { code: string; details: Record<string, unknown> | null } {
  const error = new Error(message) as Error & {
    code: string;
    details: Record<string, unknown> | null;
  };
  error.code = code;
  error.details = details;
  return error;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExecutionRouter", () => {
  // TC-ROUTER-001
  it("returns successful result with text content and is_error=false", async () => {
    const result = { summary: "Hello world", score: 0.95 };
    const executor = createMockExecutor(result);
    const router = new ExecutionRouter(executor);

    const [content, isError] = await router.handleCall("text.summarize", {
      text: "Hello world",
    });

    expect(isError).toBe(false);
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("text");
    expect(content[0].text).toBe(JSON.stringify(result));

    expect(executor.call_async).toHaveBeenCalledWith("text.summarize", {
      text: "Hello world",
    });
  });

  // TC-ROUTER-002
  it("returns error content for MODULE_NOT_FOUND error", async () => {
    const error = makeModuleError(
      "Module not found: test.module",
      "MODULE_NOT_FOUND",
    );
    const executor = createMockExecutor(undefined, error);
    const router = new ExecutionRouter(executor);

    const [content, isError] = await router.handleCall("test.module", {});

    expect(isError).toBe(true);
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("text");
    expect(content[0].text).toContain("Module not found");
  });

  // TC-ROUTER-003
  it("returns formatted error for SCHEMA_VALIDATION_ERROR", async () => {
    const error = makeModuleError(
      "Schema validation failed",
      "SCHEMA_VALIDATION_ERROR",
      {
        errors: [
          { field: "name", message: "is required" },
          { field: "age", message: "must be an integer" },
        ],
      },
    );
    const executor = createMockExecutor(undefined, error);
    const router = new ExecutionRouter(executor);

    const [content, isError] = await router.handleCall("test.module", {});

    expect(isError).toBe(true);
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("text");
    expect(content[0].text).toContain("Schema validation failed");
    expect(content[0].text).toContain("name");
    expect(content[0].text).toContain("is required");
  });

  // TC-ROUTER-004
  it("returns 'Access denied' for ACL_DENIED error", async () => {
    const error = makeModuleError(
      "ACL check failed for module",
      "ACL_DENIED",
    );
    const executor = createMockExecutor(undefined, error);
    const router = new ExecutionRouter(executor);

    const [content, isError] = await router.handleCall("test.module", {});

    expect(isError).toBe(true);
    expect(content).toHaveLength(1);
    expect(content[0].text).toBe("Access denied");
  });

  // TC-ROUTER-005
  it("returns 'Internal error occurred' for internal error codes", async () => {
    const error = makeModuleError(
      "Depth exceeded",
      "CALL_DEPTH_EXCEEDED",
    );
    const executor = createMockExecutor(undefined, error);
    const router = new ExecutionRouter(executor);

    const [content, isError] = await router.handleCall("test.module", {});

    expect(isError).toBe(true);
    expect(content).toHaveLength(1);
    expect(content[0].text).toBe("Internal error occurred");
  });

  // TC-ROUTER-006
  it("returns 'Internal error occurred' for unknown/unexpected errors", async () => {
    // A plain Error without code/details properties
    const error = new Error("Something unexpected happened");
    const executor = createMockExecutor(undefined, error);
    const router = new ExecutionRouter(executor);

    const [content, isError] = await router.handleCall("test.module", {});

    expect(isError).toBe(true);
    expect(content).toHaveLength(1);
    expect(content[0].text).toBe("Internal error occurred");
  });

  // TC-ROUTER-007
  it("passes empty arguments object to executor", async () => {
    const executor = createMockExecutor({ ok: true });
    const router = new ExecutionRouter(executor);

    const [content, isError] = await router.handleCall("test.module", {});

    expect(isError).toBe(false);
    expect(executor.call_async).toHaveBeenCalledWith("test.module", {});
  });
});
